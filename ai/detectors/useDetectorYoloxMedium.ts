import { useMemo } from "react";
import { useTensorflowModel } from "react-native-fast-tflite";
import { COCO_LABELS } from "../cocoLabels";
import type { UseDetectorResult } from "./types";
import { createYoloXMediumDetector } from "./yoloxMediumDetector";

export function useDetectorYoloXMedium(resizeFn: any): UseDetectorResult {
  const modelHook = useTensorflowModel(
    require("../../assets/yolox.tflite"),
    [],
    // 'android-gpu'
  );

  const detect = useMemo(() => {
    if (modelHook.state !== "loaded") return null;
    return createYoloXMediumDetector(modelHook.model, resizeFn, {
      confThr: 0.5, //,numClasses:1
    });
  }, [modelHook.state, resizeFn]);

  return {
    detect,
    meta: { labels: COCO_LABELS },
    ready: modelHook.state === "loaded",
  };
}
