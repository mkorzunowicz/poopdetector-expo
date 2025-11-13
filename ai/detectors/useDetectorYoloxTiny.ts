import { useMemo } from 'react'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { COCO_LABELS } from '../cocoLabels'
import type { UseDetectorResult } from './types'
import { createYoloXNanoDetector } from './yoloxNanoDetector'

export function useDetectorYoloNano(resizeFn: Function): UseDetectorResult {
  const modelHook = useTensorflowModel(
    require('../../assets/yolox_tiny_float32.tflite'),
    'android-gpu'
  )

  const detect = useMemo(() => {
    console.log(`[YoloXTiny] Model state: ${modelHook.state}`)
    if (modelHook.state !== 'loaded') return null
    console.log(`[YoloXTiny] Creating detector with size: 416, confThr: 0.3, nmsThr: 0.4`)
    return createYoloXNanoDetector(modelHook.model, resizeFn, {
      size: 416, 
      confThr: 0.3,   // Moderate confidence threshold (30%)
      nmsThr: 0.4     // Moderate NMS threshold
    })
  }, [modelHook.state, resizeFn])

  return {
    detect,
    meta: { labels: COCO_LABELS },
    ready: modelHook.state === 'loaded',
  }
}
