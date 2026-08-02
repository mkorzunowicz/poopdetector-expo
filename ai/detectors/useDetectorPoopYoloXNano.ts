import { useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { useResizer } from "react-native-vision-camera-resizer";
import { useCachedTensorflowModel } from "../tfliteModelCache";
import { COCO_LABELS } from "../cocoLabels";
import type { UseDetectorResult } from "./types";
import { createYoloXNanoDetector } from "./yoloxNanoDetector";

/**
 * Which nano export to load -- the two differ ONLY in expected input range.
 *
 *   true  -> poop_nano_416_range255_float32.tflite   expects [0, 255]
 *   false -> poop_nano_416_float32.tflite            expects [0, 1]
 *
 * WHY THIS SWITCH EXISTS
 *
 * patches/disabled/react-native-vision-camera-resizer+5.1.1.patch.obsolete
 * multiplied the resizer output by 255 inside the Metal and Vulkan kernels.
 * Those are NATIVE shaders: deleting the patch file stops it being re-applied on
 * the next `npm install`, but an already-compiled app keeps the patched shader
 * until a full native rebuild. Metro hot-reloads new JS and even a new .tflite
 * asset over the dev server -- but it can never hot-reload a shader.
 *
 * So a JS-only reload leaves a [0, 1] model being fed [0, 255]. That saturates
 * every activation: objectness pins near 1.0, boxes cluster at the frame edges
 * with high confidence, and the actual object is ignored. Confident garbage.
 *
 * TRUE  = run against a still-patched native build, no rebuild needed.
 * FALSE = after rebuilding natively without the patch. That is the cleaner end
 *         state: one less native patch to carry across upgrades.
 *
 * Verified equivalent on a real tile -- 0-1 model with [0,1] input and 0-255
 * model with [0,255] input both give max score 0.9001 and 7 boxes above 0.5.
 *
 * DEFAULT IS FALSE because the shaders in node_modules were checked on
 * 2026-07-28 and the x255 patch is NOT applied:
 *     Vulkan  writeFloat32Color(gid, ordered);
 *     Metal   output[index] = ordered[channelIndex];
 * so a native rebuild from this tree yields [0, 1]. Flip to true only if the
 * self-check below reports [0,255].
 *
 * DON'T GUESS -- the detector prints a "[YoloX] SELF-CHECK" block on its first
 * frame reporting the observed input range AND whether the loaded model is a
 * new- or old-contract export. Read that, then set this accordingly.
 */
const NATIVE_BUILD_STILL_HAS_X255_PATCH = false;

/** Which model this detector instance should load. */
export type PoopModelVariant =
  | "nano-416"
  | "s-1024"
  | "s-1024-v3"
  | "shitspotter";

/**
 * Model registry. `require()` must stay static for metro to bundle the asset, so
 * every variant is required unconditionally here and only the reference is picked.
 *
 * confThr differs per model because the score distributions differ; see the
 * operating-point tables in the YOLOX repo's README-custom.md.
 */
const MODELS: Record<
  PoopModelVariant,
  { asset: number; size: number; confThr: number; note: string }
> = {
  "nano-416": {
    asset: NATIVE_BUILD_STILL_HAS_X255_PATCH
      ? require("../../assets/poop_nano_416_range255_float32.tflite")
      : require("../../assets/poop_nano_416_float32.tflite"),
    size: 416,
    confThr: 0.4,
    note: "live-camera model, 2026-07 retrain, AP 50.6 on tiled val",
  },
  "s-1024": {
    // yolox-s trained natively at 1024 on the MULTI-SCALE tile set. Roughly 60x
    // the compute of the nano per frame (68.9 vs 1.11 GFLOPs), so expect a few
    // FPS at best -- it is here for A/B comparison, not as a live default.
    // It is also 0-1 input ONLY: there is no range255 variant, so if
    // NATIVE_BUILD_STILL_HAS_X255_PATCH is true this one will saturate. The
    // SELF-CHECK log in yoloxNanoDetector.ts will say so on the first frame.
    asset: require("../../assets/poop_s1024_ms_float32.tflite"),
    size: 1024,
    confThr: 0.5,
    note: "multi-scale 1024 model, much better on small/distant objects",
  },
  "s-1024-v3": {
    // THE BEST MODEL MEASURED. yolox-s @1024, v3 run epoch 100, dynamic-range
    // INT8. Scored on `benchmark_shared` -- 2258 images (482 poop, 776 clean
    // outdoor, 1000 indoor COCO) that no model in the comparison trained on:
    //
    //   nano-original    F1 0.471   prec 0.387   indoor false alarms 39.2%
    //   shitspotter-v5   F1 0.711   prec 0.656   indoor false alarms  7.4%
    //   s-1024 (v1)      F1 0.811   prec 0.921   indoor false alarms  1.5%
    //   s-1024-v3        F1 0.902   prec 0.933   indoor false alarms  0.1%
    //
    // int8dr = int8 weights, float activations: 9 MB instead of 34, 1.91x faster
    // than its own float32 export, and score correlation 0.999 with it. Input and
    // output remain float32, so the decode contract is unchanged.
    //
    // Trained on the merged 2020-2025 corpus with 4000 out-of-domain COCO
    // negatives, which is what removed the false positives on indoor objects.
    // Those negatives also pushed scores DOWN, hence confThr 0.5 rather than the
    // 0.6 the v1 model wanted.
    asset: require("../../assets/poop_s1024_v3_ep100_int8dr.tflite"),
    size: 1024,
    confThr: 0.5,
    note: "v3 ep100 int8dr -- best measured: F1 0.902, indoor FP 0.1%",
  },
  shitspotter: {
    // OLD-CONTRACT export (raw grid offsets, pre-sigmoid scores, [0,255] input).
    // yoloxNanoDetector.ts implements the NEW contract only, so this variant
    // WILL mis-detect until it is re-exported through tools/yolox_to_tflite.py
    // or given its own decoder.
    asset: require("../../assets/shitspotter-custom-v5-epoch_115_float32.tflite"),
    size: 640,
    confThr: 0.4,
    note: "Erotemic's model -- OLD CONTRACT, currently mis-decoded",
  },
};

export function useDetectorYoloXNanoPoop(
  variant: PoopModelVariant,
  preferGpu: boolean = true,
): UseDetectorResult {
  const model = MODELS[variant] ?? MODELS["nano-416"];
  const modelAsset = model.asset;
  const inputSize = model.size;

  // channelOrder MUST be "bgr", not "rgb".
  //
  // YOLOX's preproc() never calls cvtColor -- it takes cv2.imread output (which
  // is BGR) and only transposes HWC->CHW. So the network was trained, validated
  // and exported entirely in BGR. Measured on one real tile through
  // poop_s_640_float32.tflite:
  //
  //     RGB input -> max obj*cls 0.0245, 0 detections above 0.7
  //     BGR input -> max obj*cls 0.8662, 8 detections above 0.7
  //
  // A 35x difference. Feeding RGB does not degrade detection gracefully, it
  // removes it: at any sane threshold the model sees nothing at all.
  const resizerState = useResizer({
    width: inputSize,
    height: inputSize,
    channelOrder: "bgr",
    dataType: "float32",
    scaleMode: "cover",
    pixelLayout: "interleaved",
  });

  // Resets whenever the requested config actually changes (model or GPU/CPU
  // preference) -- this hook's OWN component instance stays mounted across a
  // Det: CPU/GPU toggle flip (only preferGpu re-renders), so an empty
  // dependency array here would freeze this at first mount and every
  // "elapsed" log below would measure time-since-app-launch instead of
  // time-since-this-load-actually-started.
  const loadStartTime = useMemo(() => {
    const time = Date.now();
    console.log(
      `[ModelLoader] 🚀 useDetectorYoloXNanoPoop hook (re)initialized at ${time} ` +
        `(variant=${variant} @${model.size}, preferGpu=${preferGpu}) -- ${model.note}`,
    );
    return time;
  }, [variant, model.size, model.note, preferGpu]);

  // Try GPU first, fallback to CPU on error. Both load through the shared
  // model cache (ai/tfliteModelCache.ts) so the photo-detail screen (media.tsx),
  // which requests the same asset with delegates=[], reuses this CPU instance
  // instead of re-loading the model from scratch.
  const [useFallback, setUseFallback] = useState(false);

  // preferGpu=false (camera screen's Det: CPU/GPU toggle) makes this request
  // delegates=[] too -- same cache key as cpuModelHook below, so it's a cache
  // hit rather than a second load, and GPU is never attempted at all.
  const gpuModelHook = useCachedTensorflowModel(
    modelAsset,
    preferGpu ? (Platform.OS === "ios" ? ["core-ml"] : ["android-gpu"]) : [],
  );

  const cpuModelHook = useCachedTensorflowModel(modelAsset, []);

  // Check if GPU failed and trigger CPU fallback
  useEffect(() => {
    if (gpuModelHook.state === "error" && !useFallback) {
      console.log(
        "[ModelLoader] ⚠️ GPU delegate failed, falling back to CPU...",
      );
      setUseFallback(true);
    }
  }, [gpuModelHook.state, useFallback]);

  // Use whichever model is active - prefer GPU if loaded, fallback to CPU if GPU fails
  const modelHook =
    useFallback && cpuModelHook.state === "loaded"
      ? cpuModelHook
      : gpuModelHook;

  // Track state changes
  useEffect(() => {
    const elapsed = Date.now() - loadStartTime;
    const delegateType =
      useFallback || !preferGpu
        ? "CPU"
        : Platform.OS === "ios"
          ? "CoreML"
          : "GPU";
    console.log(
      `[ModelLoader] 📊 Model state changed to: ${modelHook.state} (${delegateType}, ${elapsed}ms elapsed)`,
    );
  }, [modelHook.state, loadStartTime, useFallback, preferGpu]);

  useEffect(() => {
    if (resizerState.state === "error") {
      console.error(
        "[PoopDetector] Failed to create resizer:",
        resizerState.error,
      );
    }
  }, [resizerState]);

  const detect = useMemo(() => {
    const currentTime = Date.now();
    const elapsed = currentTime - loadStartTime;
    console.log(
      `[ModelLoader] 🔄 detect useMemo triggered - state: ${modelHook.state} (${elapsed}ms since init)`,
    );

    if (modelHook.state !== "loaded" || resizerState.state !== "ready")
      return null;

    console.log(`[ModelLoader] ✅ Model fully ready in ${elapsed}ms total`);
    console.log(
      `[PoopDetector] Creating poop detector - 1 class, ${inputSize}x${inputSize} ` +
        `input, conf ${model.confThr} (${variant})`,
    );
    return createYoloXNanoDetector(modelHook.model, resizerState.resizer, {
      size: inputSize,
      confThr: model.confThr,
      numClasses: 1,
    });
  }, [inputSize, model.confThr, variant, loadStartTime, modelHook, resizerState]);

  return {
    detect,
    meta: { labels: COCO_LABELS },
    ready: modelHook.state === "loaded" && resizerState.state === "ready",
  };
}
