import { useEffect, useMemo, useState } from 'react'
import { Platform } from 'react-native'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { COCO_LABELS } from '../cocoLabels'
import type { UseDetectorResult } from './types'
import { createYoloXNanoDetector } from './yoloxNanoDetector'

export function useDetectorYoloXNanoPoop(resizeFn: any): UseDetectorResult {
  const useShitSpotterModel = false;
  const modelPath = useShitSpotterModel
    ? '../../assets/shitspotter-custom-v5-epoch_115_float32.tflite'
    : '../../assets/yolox_nano_poop_cropped_only_best_float32.tflite';
    
  const loadStartTime = useMemo(() => {
    const time = Date.now();
    console.log(`[ModelLoader] 🚀 useDetectorYoloXNanoPoop hook initialized at ${time}`);
    return time;
  }, []);
  
  // Try GPU first, fallback to CPU on error
  const [useFallback, setUseFallback] = useState(false);
  
  const gpuModelHook = useTensorflowModel(
    require(modelPath),
    Platform.OS === 'ios' ? 'core-ml' : 'android-gpu'
  );
  
  const cpuModelHook = useTensorflowModel(
    useFallback ? require(modelPath) : null
  );
  
  // Check if GPU failed and trigger CPU fallback
  useEffect(() => {
    if (gpuModelHook.state === 'error' && !useFallback) {
      console.log('[ModelLoader] ⚠️ GPU delegate failed, falling back to CPU...');
      setUseFallback(true);
    }
  }, [gpuModelHook.state, useFallback]);
  
  // Use whichever model is active
  const modelHook = useFallback ? cpuModelHook : gpuModelHook;

  // Track state changes
  useEffect(() => {
    const elapsed = Date.now() - loadStartTime;
    const delegateType = useFallback ? 'CPU' : (Platform.OS === 'ios' ? 'CoreML' : 'GPU');
    console.log(`[ModelLoader] 📊 Model state changed to: ${modelHook.state} (${delegateType}, ${elapsed}ms elapsed)`);
  }, [modelHook.state, loadStartTime, useFallback]);

  const detect = useMemo(() => {
    const currentTime = Date.now();
    const elapsed = currentTime - loadStartTime;
    console.log(`[ModelLoader] 🔄 detect useMemo triggered - state: ${modelHook.state} (${elapsed}ms since init)`)
    
    if (modelHook.state !== 'loaded') return null
    
    console.log(`[ModelLoader] ✅ Model fully ready in ${elapsed}ms total`);
    console.log(`[PoopDetector] Creating poop detector - 1 class, 416x416 input`)
    return createYoloXNanoDetector(modelHook.model, resizeFn, {
      size: useShitSpotterModel ? 640 : 416, confThr: 0.4, numClasses: 1
    })
  }, [modelHook.state, resizeFn, loadStartTime])

  return {
    detect,
    meta: { labels: COCO_LABELS },
    ready: modelHook.state === 'loaded',
  }
}
