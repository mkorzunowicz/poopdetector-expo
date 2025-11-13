import { UseDetectorResult } from './types'
import { useDetectorEffDet } from './useDetectorEffDet'
import { useDetectorYoloXNanoPoop } from './useDetectorPoopYoloXNano'
import { useDetectorYolov8 } from './useDetectorYolov8'
import { useDetectorYoloXMedium } from './useDetectorYoloxMedium'
import { useDetectorYoloNano } from './useDetectorYoloxTiny'

export const DETECTOR_NAMES = [
    'efficientdet',
    'yolox-tiny',
    'yolox-medium',
    'poop-yolox-nano',
    'yolov8',
] as const
export type DetectorName = (typeof DETECTOR_NAMES)[number]

export function useDetector(name: DetectorName, resizeFn: Function): UseDetectorResult {
    switch (name) {
        case 'yolox-tiny': return useDetectorYoloNano(resizeFn)
        case 'efficientdet': return useDetectorEffDet(resizeFn)
        case 'poop-yolox-nano': return useDetectorYoloXNanoPoop(resizeFn)
        case 'yolov8': return useDetectorYolov8(resizeFn)
        case 'yolox-medium': return useDetectorYoloXMedium(resizeFn)
        default: return { detect: null, meta: null, ready: false }
    }
}
