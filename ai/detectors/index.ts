import { UseDetectorResult } from './types'
import { useDetectorYoloXNanoPoop } from './useDetectorPoopYoloXNano'

export const DETECTOR_NAMES = [
    'shitspotter',
    'poop-yolox-nano',
] as const
export type DetectorName = (typeof DETECTOR_NAMES)[number]

export function useDetector(name: DetectorName, resizeFn: Function): UseDetectorResult {
    switch (name) {
        case 'poop-yolox-nano': return useDetectorYoloXNanoPoop(resizeFn, false)
        case 'shitspotter': return useDetectorYoloXNanoPoop(resizeFn, true)
        default: return { detect: null, meta: null, ready: false }
    }
}
