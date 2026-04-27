import { useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { useTensorflowModel } from "react-native-fast-tflite";
import { useResizer } from "react-native-vision-camera-resizer";
import { COCO_LABELS } from "../cocoLabels";
import type { UseDetectorResult } from "./types";
import { createYoloXNanoDetector } from "./yoloxNanoDetector";

export function useDetectorYoloXNanoPoop(
  useShitSpotterModel: boolean,
): UseDetectorResult {
  // Define model assets statically for require() to work
  const modelAsset = useShitSpotterModel
    ? require("../../assets/shitspotter-custom-v5-epoch_115_float32.tflite")
    : require("../../assets/yolox_nano_poop_cropped_only_best_float32.tflite");
  const inputSize = useShitSpotterModel ? 640 : 416;

  const resizerState = useResizer({
    width: inputSize,
    height: inputSize,
    channelOrder: "rgb",
    dataType: "float32",
    scaleMode: "cover",
    pixelLayout: "interleaved",
  });

  const loadStartTime = useMemo(() => {
    const time = Date.now();
    console.log(
      `[ModelLoader] 🚀 useDetectorYoloXNanoPoop hook initialized at ${time}`,
    );
    return time;
  }, []);

  // Try GPU first, fallback to CPU on error
  const [useFallback, setUseFallback] = useState(false);

  const gpuModelHook = useTensorflowModel(
    modelAsset,
    Platform.OS === "ios" ? "core-ml" : "android-gpu",
  );

  const cpuModelHook = useTensorflowModel(modelAsset);

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
    const delegateType = useFallback
      ? "CPU"
      : Platform.OS === "ios"
        ? "CoreML"
        : "GPU";
    console.log(
      `[ModelLoader] 📊 Model state changed to: ${modelHook.state} (${delegateType}, ${elapsed}ms elapsed)`,
    );
  }, [modelHook.state, loadStartTime, useFallback]);

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
      `[PoopDetector] Creating poop detector - 1 class, ${inputSize}x${inputSize} input`,
    );
    return createYoloXNanoDetector(modelHook.model, resizerState.resizer, {
      size: inputSize,
      confThr: 0.4,
      numClasses: 1,
    });
  }, [inputSize, loadStartTime, modelHook, resizerState]);

  return {
    detect,
    meta: { labels: COCO_LABELS },
    ready: modelHook.state === "loaded" && resizerState.state === "ready",
  };
}
