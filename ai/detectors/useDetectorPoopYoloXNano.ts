import { useMemo } from 'react'
import { Platform } from 'react-native'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { COCO_LABELS } from '../cocoLabels'
import type { UseDetectorResult } from './types'
import { createYoloXNanoDetector } from './yoloxNanoDetector'

export function useDetectorYoloXNanoPoop(resizeFn: any): UseDetectorResult {
  const modelHook = useTensorflowModel(
    require('../../assets/yolox_nano_poop_cropped_only_best_float32.tflite'),
    
    Platform.OS === 'ios' ? 'core-ml' : 'android-gpu' 
  )

  const detect = useMemo(() => {
    console.log(`[PoopDetector] Model state: ${modelHook.state}`)
    if (modelHook.state !== 'loaded') return null
    console.log(`[PoopDetector] Creating poop detector - 1 class, 416x416 input`)
    return createYoloXNanoDetector(modelHook.model, resizeFn, {
      size: 416, confThr: 0.4, numClasses: 1
    })
  }, [modelHook.state, resizeFn])

  return {
    detect,
    meta: { labels: COCO_LABELS },
    ready: modelHook.state === 'loaded',
  }
}
