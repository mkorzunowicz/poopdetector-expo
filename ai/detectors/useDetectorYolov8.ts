import { useMemo } from 'react'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { COCO_LABELS } from '../cocoLabels'
import type { UseDetectorResult } from './types'
import { createYolov8Detector } from './yolov8Detector'

export function useDetectorYolov8(resizeFn: any): UseDetectorResult {
  const modelHook = useTensorflowModel(
    require('../../assets/yolov8.tflite'),
    // { url: 'https://github.com/mkorzunowicz/tflite_models/raw/refs/heads/main/efficientdet_f32.tflite'},

    'android-gpu'
  )

  const detect = useMemo(() => {
    if (modelHook.state !== 'loaded') return null
    return createYolov8Detector(modelHook.model, resizeFn, {
      confThr: 0.5, nmsThr: 0.35
    })
  }, [modelHook.state, resizeFn])

  return {
    detect,
    meta: { labels: COCO_LABELS },
    ready: modelHook.state === 'loaded',
  }
}
