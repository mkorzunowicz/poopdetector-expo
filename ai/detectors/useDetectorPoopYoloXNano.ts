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
  | "nano-fp32"
  | "nano-fp16"
  | "nano-int8dr"
  | "nano-int8"
  | "s-1024"
  | "s-1024-v3"
  | "s-1024-v3-fp16"
  | "s-1024-v3-fp32"
  | "nano-original"
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
  {
    /** used when no delegate-specific asset is given */
    asset: number;
    /** optional: preferred build when a GPU/CoreML delegate is requested */
    assetGpu?: number;
    /** optional: preferred build on the CPU path */
    assetCpu?: number;
    size: number;
    confThr: number;
    note: string;
    /** false = 2024-era export: raw grid offsets and [0,255] input. Omitted
     *  means true (produced by tools/yolox_to_tflite.py). Only the photo path
     *  reads this -- the live worklet decoder implements the new contract only. */
    newContract?: boolean;
  }
> = {
  "nano-416": {
    // The live default -- precision now follows the delegate:
    //   GPU -> fp32   (52ms/frame, hits the 10 FPS cap)
    //   CPU -> int8dr (158ms vs 237ms for fp32, and 1.1 MB vs 3.5 MB)
    // `asset` stays as the fallback for the x255-patched-build case, which only
    // exists as a float32 export.
    assetGpu: require("../../assets/poop_nano_416_v2_float32.tflite"),
    assetCpu: require("../../assets/poop_nano_416_v2_int8dr.tflite"),
    asset: NATIVE_BUILD_STILL_HAS_X255_PATCH
      ? require("../../assets/poop_nano_416_range255_float32.tflite")
      : require("../../assets/poop_nano_416_float32.tflite"),
    size: 416,
    confThr: 0.4,
    note: "live-camera model, 2026-07 retrain, AP 50.6 on tiled val",
  },
  // ---- nano @416, same weights, four precisions ------------------------- //
  // Here to measure DELEGATE x PRECISION on real devices. Nano is the right
  // vehicle: accuracy is identical across the first three, so any difference in
  // frame time is the runtime, not the model. Desktop CPU baseline, 8 threads
  // (tools/bench_quant.py, 240 images):
  //
  //   float32   3.5 MB   30.4 ms   1.00x   F1 0.514
  //   float16   1.8 MB   29.6 ms   1.03x   F1 0.509
  //   int8dr    1.1 MB   41.8 ms   0.73x   F1 0.520   <- SLOWER than float32
  //   int8      1.2 MB   20.8 ms   1.46x   F1 0.000   <- broken, speed only
  //
  // int8dr being slower here is not a mistake: quantize/dequantize overhead is
  // roughly per-op and fixed, while the compute saving scales with model size.
  // At the nano's 1.11 GFLOPs the overhead wins; at s@1024's 68.9 GFLOPs int8dr
  // is 1.91x FASTER. Quantization is not universally a win -- measure per model.
  //
  // Field observation on device: float32 is fast on CoreML while int8 is very
  // slow, because CoreML/GPU execute float natively and must dequantize (or fall
  // back to CPU) for int8. So the best precision depends on the DELEGATE too.
  "nano-fp32": {
    asset: require("../../assets/poop_nano_416_v2_float32.tflite"),
    size: 416,
    confThr: 0.4,
    note: "nano fp32 -- baseline; fastest on CoreML/GPU",
  },
  "nano-fp16": {
    asset: require("../../assets/poop_nano_416_v2_float16.tflite"),
    size: 416,
    confThr: 0.4,
    note: "nano fp16 -- half the file, GPUs compute fp16 natively",
  },
  "nano-int8dr": {
    asset: require("../../assets/poop_nano_416_v2_int8dr.tflite"),
    size: 416,
    confThr: 0.4,
    note: "nano int8 dynamic-range -- 1.1 MB; slower than fp32 on desktop CPU",
  },
  "nano-int8": {
    // SPEED MEASUREMENT ONLY -- this model does not detect anything.
    // --decode puts pixel coords (0..1024) and probabilities (0..1) in one output
    // tensor; per-tensor int8 picks a single scale and every probability
    // collapses to the same value. Measured F1 0.000. Kept so the delegate's
    // int8 throughput can be timed; do not judge detections from it.
    asset: require("../../assets/poop_nano_416_v2_int8.tflite"),
    size: 416,
    confThr: 0.4,
    note: "nano full-int8 -- TIMING ONLY, detects nothing (F1 0.000)",
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
    // Same delegate-aware choice. On-device Android CPU: int8dr ~1320ms vs
    // ~2110ms for fp32/fp16. Either way this is a verification model, not a live
    // one -- 1.3s per frame is fine for a one-shot check, not for a viewfinder.
    assetGpu: require("../../assets/poop_s1024_v3_ep100_float32.tflite"),
    assetCpu: require("../../assets/poop_s1024_v3_ep100_int8dr.tflite"),
    asset: require("../../assets/poop_s1024_v3_ep100_int8dr.tflite"),
    size: 1024,
    confThr: 0.5,
    note: "v3 ep100 -- best measured: F1 0.902, indoor FP 0.1%",
  },
  // Same v3 ep100 weights at the other two precisions, so DELEGATE x PRECISION
  // can be compared on the model that will actually ship. Desktop CPU baseline,
  // 8 threads, 240 images -- all three are behaviourally identical:
  //
  //   float32   34.4 MB   182.9 ms   1.00x   F1 0.819   drift -
  //   float16   17.2 MB   181.6 ms   1.01x   F1 0.819   drift 0.0001  corr 1.000
  //   int8dr     9.0 MB    92.6 ms   1.97x   F1 0.819   drift 0.0065  corr 0.999
  //
  // On CPU int8dr wins outright at this model size. On CoreML/GPU the field test
  // showed the reverse -- float runs natively there and int8 must be dequantized
  // or falls back to CPU. fp16 is the one to try on the accelerated path: GPUs
  // compute fp16 natively, so it should match fp32's speed at half the file size
  // and half the load time.
  "s-1024-v3-fp16": {
    asset: require("../../assets/poop_s1024_v3_ep100_float16.tflite"),
    size: 1024,
    confThr: 0.5,
    note: "v3 ep100 fp16 -- 17 MB, expected best on CoreML/GPU",
  },
  "s-1024-v3-fp32": {
    asset: require("../../assets/poop_s1024_v3_ep100_float32.tflite"),
    size: 1024,
    confThr: 0.5,
    note: "v3 ep100 fp32 -- 34 MB, the reference precision",
  },
  shitspotter: {
    // OLD-CONTRACT export (raw grid offsets, pre-sigmoid scores, [0,255] input).
    // yoloxNanoDetector.ts implements the NEW contract only, so this variant
    // WILL mis-detect until it is re-exported through tools/yolox_to_tflite.py
    // or given its own decoder.
    asset: require("../../assets/shitspotter-custom-v5-epoch_115_float32.tflite"),
    size: 640,
    confThr: 0.4,
    newContract: false,
    note: "Erotemic's model -- OLD CONTRACT, currently mis-decoded",
  },
  "nano-original": {
    // The 2024 model that used to be hardcoded in app/media.tsx, kept selectable
    // so the photo path can still be compared against what it used to run.
    // Weakest model measured on benchmark_shared: F1 0.471, precision 0.387,
    // and it fires on 39.2% of indoor photos. Old contract.
    asset: require("../../assets/yolox_nano_poop_cropped_only_best_float32.tflite"),
    size: 416,
    confThr: 0.4,
    newContract: false,
    note: "2024 original -- OLD CONTRACT, F1 0.471, 39% indoor false alarms",
  },
};

export function useDetectorYoloXNanoPoop(
  variant: PoopModelVariant,
  preferGpu: boolean = true,
): UseDetectorResult {
  const model = MODELS[variant] ?? MODELS["nano-416"];
  const inputSize = model.size;

  // PRECISION FOLLOWS THE DELEGATE. Measured on-device (Pixel-class Android,
  // nano @416, mean over ~50 frames each):
  //
  //             CPU      GPU
  //   fp32     237ms     52ms
  //   fp16     282ms      -      slowest on CPU: dequantized to fp32 to compute
  //   int8dr   158ms      -      fastest on CPU
  //
  // GPU fp32 is 3x faster than the best CPU option and saturates the 10 FPS cap,
  // at the cost of a ~3.7s one-time delegate compile. On CPU the ordering
  // reverses and int8dr wins, because ARM has dedicated int8 dot-product
  // instructions. Shipping one precision for both paths therefore leaves roughly
  // a third of the performance on the table whichever one is picked.
  //
  // NOTE this inverts the DESKTOP benchmark, where int8dr measured 0.73x (i.e.
  // slower) on the same nano. x86 XNNPACK gets no equivalent int8 speedup, so
  // the quantize/dequantize overhead dominates there. Desktop numbers do not
  // predict mobile for quantization -- always confirm on device.
  const modelAsset =
    (preferGpu ? model.assetGpu : model.assetCpu) ?? model.asset;

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

    // The loaded model must actually BE the one this variant asked for.
    //
    // `inputSize` comes from the variant and updates the instant the user picks
    // a different model, but `modelHook.model` keeps serving the PREVIOUS cached
    // model until the new asset finishes loading -- around 2s for the 34 MB
    // s@1024 export. In that window the detector was being built for 1024x1024
    // while holding a 416x416 model, and the frame processor fed it 1024-sized
    // tensors. Observed in a device log as a "1024x1024 input" detector printing
    // `images[1,416,416,3]`, followed by an impossibly fast 77ms frame.
    //
    // It self-corrected once the load completed, so it never showed up as a
    // crash -- just a couple of frames of nonsense. Gate on the real shape.
    const modelInput = modelHook.model.inputs?.[0];
    const modelSize = modelInput?.shape?.[1];
    if (typeof modelSize === "number" && modelSize !== inputSize) {
      console.log(
        `[ModelLoader] ⏳ stale model still cached (${modelSize}px) while ${variant} ` +
          `wants ${inputSize}px -- waiting for the right one`,
      );
      return null;
    }

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

/**
 * Resolve a variant to the concrete asset + contract, for callers that are NOT
 * the live frame processor -- currently app/media.tsx.
 *
 * Exists so the photo screen and the camera screen cannot drift apart. Before
 * this, media.tsx hardcoded `yolox_nano_poop_cropped_only_best_float32.tflite`
 * and decoded it with its own copy of the maths, so the detector picker on the
 * camera screen had no effect whatsoever on what ran after the shutter -- and
 * that hardcoded model is the weakest one measured (F1 0.471 vs 0.902 for v3,
 * 39.2% false alarms on indoor photos vs 0.1%).
 */
export function resolvePoopModel(
  variant: PoopModelVariant,
  preferGpu: boolean,
): {
  asset: number;
  size: number;
  confThr: number;
  note: string;
  /** true for exports produced by tools/yolox_to_tflite.py (decoded boxes,
   *  [0,1] input); false for the 2024-era exports and shitspotter's. */
  newContract: boolean;
} {
  const model = MODELS[variant] ?? MODELS["nano-416"];
  const asset =
    (preferGpu ? model.assetGpu : model.assetCpu) ?? model.asset;
  return {
    asset,
    size: model.size,
    confThr: model.confThr,
    note: model.note,
    newContract: model.newContract !== false,
  };
}
