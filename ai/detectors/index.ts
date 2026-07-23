import { UseDetectorResult } from "./types";
import { useDetectorYoloXNanoPoop } from "./useDetectorPoopYoloXNano";

export const DETECTOR_NAMES = ["shitspotter", "poop-yolox-nano"] as const;
export type DetectorName = (typeof DETECTOR_NAMES)[number];

export function useDetector(
  name: DetectorName,
  preferGpu: boolean = true,
): UseDetectorResult {
  switch (name) {
    case "poop-yolox-nano":
      return useDetectorYoloXNanoPoop(false, preferGpu);
    case "shitspotter":
      return useDetectorYoloXNanoPoop(true, preferGpu);
    default:
      return { detect: null, meta: null, ready: false };
  }
}
