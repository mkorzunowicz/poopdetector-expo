import { UseDetectorResult } from "./types";
import {
  useDetectorYoloXNanoPoop,
  type PoopModelVariant,
} from "./useDetectorPoopYoloXNano";

/**
 * Selectable detectors, shown as the list on the camera screen.
 *
 * Scored on `benchmark_shared` -- 2258 images (482 poop, 776 clean outdoor, 1000
 * indoor COCO) that none of these models trained on, each at its best mode:
 *
 *   detector              F1     prec    recall   indoor false alarms
 *   nano-original       0.471   0.387    0.602        39.2%
 *   shitspotter         0.711   0.656    0.776         7.4%
 *   poop-yolox-s1024    0.811   0.921    0.724         1.5%
 *   poop-yolox-s1024-v3 0.902   0.933    0.873         0.1%   <- best
 *
 *   poop-yolox-nano     416px nano, the live default. ~1.1 GFLOPs/frame, so it is
 *                       the only one that keeps a real frame rate -- but it is
 *                       the weakest model here by a wide margin.
 *   poop-yolox-s1024    1024px yolox-s on the multi-scale tile set (v1).
 *   poop-yolox-s1024-v3 v3 epoch 100, int8dr. Best measured. ~9 MB and 1.9x
 *                       faster than the v1 float32 export, but still ~62x the
 *                       nano's compute per frame, so expect a few FPS.
 *   shitspotter         Erotemic's model. OLD-CONTRACT export (raw grid offsets,
 *                       [0,255] input) decoded with the new-contract decoder, so
 *                       it WILL mis-detect until re-exported.
 */
export const DETECTOR_NAMES = [
  "shitspotter",
  "poop-yolox-nano",
  "poop-yolox-s1024",
  "poop-yolox-s1024-v3",
  // Same nano weights at four precisions -- for measuring DELEGATE x PRECISION
  // on device. Accuracy is identical across the first three, so any frame-time
  // difference is the runtime rather than the model. nano-int8 detects NOTHING
  // (full-int8 breaks the decoded output tensor); it is here to time int8
  // throughput only.
  "nano-fp32",
  "nano-fp16",
  "nano-int8dr",
  "nano-int8-TIMING-ONLY",
  // Same for the v3 model that will actually ship -- s1024-v3 above IS the
  // int8dr build, these are its fp16 and fp32 siblings.
  "s1024-v3-fp16",
  "s1024-v3-fp32",
] as const;
export type DetectorName = (typeof DETECTOR_NAMES)[number];

const VARIANT_BY_NAME: Record<DetectorName, PoopModelVariant> = {
  "poop-yolox-nano": "nano-416",
  "poop-yolox-s1024": "s-1024",
  "poop-yolox-s1024-v3": "s-1024-v3",
  shitspotter: "shitspotter",
  "nano-fp32": "nano-fp32",
  "nano-fp16": "nano-fp16",
  "nano-int8dr": "nano-int8dr",
  "nano-int8-TIMING-ONLY": "nano-int8",
  "s1024-v3-fp16": "s-1024-v3-fp16",
  "s1024-v3-fp32": "s-1024-v3-fp32",
};

export function useDetector(
  name: DetectorName,
  preferGpu: boolean = true,
): UseDetectorResult {
  // Single hook call with a variant argument -- NOT a switch over several hooks.
  // Calling a different hook per branch would violate the rules of hooks the
  // moment the user changes the selection at runtime, which is exactly what the
  // picker on the camera screen does.
  return useDetectorYoloXNanoPoop(VARIANT_BY_NAME[name] ?? "nano-416", preferGpu);
}
