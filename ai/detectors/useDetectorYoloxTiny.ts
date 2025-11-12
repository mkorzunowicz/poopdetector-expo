import { useMemo } from 'react'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { COCO_LABELS } from '../cocoLabels'
import type { UseDetectorResult } from './types'
import { createYoloXNanoDetector } from './yoloxNanoDetector'

export function useDetectorYoloNano(resizeFn: any): UseDetectorResult {
  const modelHook = useTensorflowModel(
    require('../../assets/yolox_tiny_float32.tflite'),
    // 'android-gpu'
  )

  const detect = useMemo(() => {
    if (modelHook.state !== 'loaded') return null
    return createYoloXNanoDetector(modelHook.model, resizeFn, {
      size: 416, confThr: 0.5
    })
  }, [modelHook.state, resizeFn])

  return {
    detect,
    meta: { labels: COCO_LABELS },
    ready: modelHook.state === 'loaded',
  }
}
