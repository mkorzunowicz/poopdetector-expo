import { useMemo } from 'react'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { COCO_LABELS } from '../cocoLabels'
import { createEfficientDetDetector } from './efficientDetDetector'
import { type UseDetectorResult } from './types'
// import React from 'react'

export function useDetectorEffDet(resizeFn: any): UseDetectorResult {
  const modelHook = useTensorflowModel(
    require('../../assets/efficientdet_f32.tflite'), 

    // Platform.OS === 'ios' ? 'core-ml' : 'android-gpu' 
  )

  const detect = useMemo(() => {
    if (modelHook.state !== 'loaded') return null

    return createEfficientDetDetector(modelHook.model, resizeFn, {
      size: 320, confThr: 0.4, dataType: 'float32'
    })
  }, [modelHook.state, resizeFn])

  return {
    detect,
    meta: { labels: COCO_LABELS },
    ready: modelHook.state === 'loaded',
  }
}
