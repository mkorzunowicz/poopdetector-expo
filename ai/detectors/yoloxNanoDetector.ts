'use worklet'

import { Frame } from "react-native-vision-camera"
import { Detection, modelToString } from "./types"

/* ───────────────────── private helpers ──────────────────────── */

const NUM_BBOX_FIELDS = 5
const STRIDES = [8, 16, 32] as const

interface GridCoordinate {
  x: number;
  y: number;
  stride: number;
}

/* grid cache (per net-size) */
const _gridCache: Record<number, GridCoordinate[]> = {}

// Generate grid coordinates matching C# implementation
function _generateGridCoordinatesWithStrides(strides: readonly number[], height: number, width: number): GridCoordinate[] {
  'worklet'
  const coords: GridCoordinate[] = []
  
  for (const stride of strides) {
    const gridHeight = Math.floor(height / stride)
    const gridWidth = Math.floor(width / stride)
    
    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        coords.push({ x, y, stride })
      }
    }
  }
  
  return coords
}

// Calculate intersection area (matches C# CalcInterArea)
function _calcInterArea(a: Detection, b: Detection): number {
  'worklet'
  const x = Math.max(a.x1, b.x1)
  const y = Math.max(a.y1, b.y1)
  const w = Math.min(a.x2, b.x2) - x
  const h = Math.min(a.y2, b.y2) - y

  // No intersection if width or height is negative
  if (w < 0 || h < 0) return 0
  return w * h
}

// Calculate union area (matches C# CalcUnionArea)
function _calcUnionArea(a: Detection, b: Detection): number {
  'worklet'
  const x = Math.min(a.x1, b.x1)
  const y = Math.min(a.y1, b.y1)
  const w = Math.max(a.x2, b.x2) - x
  const h = Math.max(a.y2, b.y2) - y

  return w * h
}

function _iou(a: Detection, b: Detection): number {
  'worklet'
  const interArea = _calcInterArea(a, b)
  if (interArea === 0) return 0
  
  const unionArea = _calcUnionArea(a, b)
  return interArea / unionArea
}

function _getGrid(w: number, h: number): GridCoordinate[] {
  'worklet'
  const key = w * 10000 + h
  if (!_gridCache[key]) {
    _gridCache[key] = _generateGridCoordinatesWithStrides(STRIDES, h, w)
  }
  return _gridCache[key]!
}

// Convert grid to flat format for native module [x, y, stride, x, y, stride, ...]
function _gridToFlat(grid: GridCoordinate[]): Float32Array {
  'worklet'
  const flat = new Float32Array(grid.length * 3)
  for (let i = 0; i < grid.length; i++) {
    flat[i * 3] = grid[i].x
    flat[i * 3 + 1] = grid[i].y
    flat[i * 3 + 2] = grid[i].stride
  }
  return flat
}

// Generate bounding box proposals (matches C# GenerateBoundingBoxProposals)
function _generateBoundingBoxProposals(
  modelOutput: Float32Array,
  gridCoords: GridCoordinate[],
  numClasses: number,
  numBBoxFields: number,
  confidenceThreshold: number,
  netSize: number
): Detection[] {
  'worklet'
  
  const proposalLength = numClasses + numBBoxFields
  const proposals: Detection[] = []

  for (let anchorIndex = 0; anchorIndex < gridCoords.length; anchorIndex++) {
    const grid = gridCoords[anchorIndex]
    const startIndex = anchorIndex * proposalLength

    // Calculate coordinates and dimensions of the bounding box (matching C# logic)
    const centerX = (modelOutput[startIndex] + grid.x) * grid.stride
    const centerY = (modelOutput[startIndex + 1] + grid.y) * grid.stride
    const w = Math.exp(modelOutput[startIndex + 2]) * grid.stride
    const h = Math.exp(modelOutput[startIndex + 3]) * grid.stride

    // Compute objectness (matching C# box_objectness)
    // YoloX objectness should be passed through sigmoid activation - optimized
    const rawObjectness = modelOutput[startIndex + 4]
    const boxObjectness = rawObjectness > 0 ? 1.0 / (1.0 + Math.exp(-rawObjectness)) : Math.exp(rawObjectness) / (1.0 + Math.exp(rawObjectness))

    let bestProb = 0
    let bestClassIndex = 0

    // Compute class probabilities for each bounding box (matching C# logic) - optimized
    for (let classIndex = 0; classIndex < numClasses; classIndex++) {
      const rawClassScore = modelOutput[startIndex + numBBoxFields + classIndex]
      // YoloX class scores should also be passed through sigmoid activation - optimized
      const boxClassScore = rawClassScore > 0 ? 1.0 / (1.0 + Math.exp(-rawClassScore)) : Math.exp(rawClassScore) / (1.0 + Math.exp(rawClassScore))
      const boxProb = boxObjectness * boxClassScore // Final probability

      // Update the object with the highest probability and class label
      if (boxProb > bestProb) {
        bestClassIndex = classIndex
        bestProb = boxProb
      }
    }

    // Early exit optimizations - check cheapest conditions first
    if (boxObjectness < 0.15) continue // Quick objectness check (15%)
    
    // Skip expensive class probability calculations if we already have enough detections
    if (proposals.length >= 50 && boxObjectness < 0.3) continue
    
    const bestClassScore = bestProb / boxObjectness
    if (bestClassScore < 0.4) continue // Moderate class confidence (40%)
    if (bestProb < 0.25) continue // Minimum final probability check (25%)

    // Filter by confidence threshold (matching C# where clause)
    if (bestProb > confidenceThreshold) {
      const halfW = w * 0.5
      const halfH = h * 0.5
      const x1 = (centerX - halfW) / netSize
      const y1 = (centerY - halfH) / netSize
      const x2 = (centerX + halfW) / netSize
      const y2 = (centerY + halfH) / netSize
      
      // Reasonable bounds and size checking
      if (x1 < 0 || y1 < 0 || x2 > 1 || y2 > 1) continue // Box outside image bounds
      if ((x2 - x1) < 0.015 || (y2 - y1) < 0.015) continue // Box too small (min 1.5%)
      if ((x2 - x1) > 0.9 || (y2 - y1) > 0.9) continue // Box too large (max 90%)
      
      // Limit total proposals to prevent runaway detections - reduced for performance
      if (proposals.length >= 100) break // Hard limit of 100 proposals (was 200)
      
      const detection = {
        x1, y1, x2, y2,
        score: bestProb,
        classId: bestClassIndex,
      }
      proposals.push(detection)
      
      // Log first detection for debugging
      // if (proposals.length === 1) {
      //   console.log(`[YoloX] First proposal: class=${bestClassIndex} conf=${bestProb.toFixed(3)} obj=${boxObjectness.toFixed(3)} size=${((x2-x1)*100).toFixed(1)}%x${((y2-y1)*100).toFixed(1)}%`)
      // }
    }
  }

  // Sort by probability (matching C# OrderByDescending)
  proposals.sort((a, b) => b.score - a.score)
  return proposals
}

function _postprocess(
  tensor: Float32Array,
  grid: GridCoordinate[],
  netSize: number,
  numClasses: number,
  confThr: number,
  nmsThr: number,
): Detection[] {
  'worklet'

  // console.log(`[YoloX] Processing ${grid.length} anchors, confThr=${confThr}, nmsThr=${nmsThr}`)

  // Generate proposals using the same algorithm as C#
  const proposals = _generateBoundingBoxProposals(
    tensor,
    grid,
    numClasses,
    NUM_BBOX_FIELDS,
    confThr,
    netSize
  )

  // console.log(`[YoloX] Generated ${proposals.length} proposals`)

  // Apply NMS (matches C# NMSSortedBoxesOptimized)
  const picked: Detection[] = []

  for (let i = 0; i < proposals.length; i++) {
    let keep = true
    const a = proposals[i]
    
    for (let j = 0; j < picked.length; j++) {
      const interArea = _calcInterArea(a, picked[j])
      if (interArea > 0) {
        const unionArea = _calcUnionArea(a, picked[j])
        if (interArea / unionArea > nmsThr) {
          keep = false
          break
        }
      }
    }

    if (keep) {
      picked.push(a)
    }
  }

  // console.log(`[YoloX] After NMS: ${picked.length} detections kept`)
  
  // Final reasonable limit on detections - reduced for performance
  const finalDetections = picked.slice(0, 20) // Maximum 20 detections per frame (was 50)
  if (finalDetections.length < picked.length) {
    console.log(`[YoloX] Limited to ${finalDetections.length} detections (was ${picked.length})`)
  }
  
  return finalDetections
}
/* ─────────────────── public types ─────────────────── */

export interface YoloXOpts {
  /** network input size (square) */
  size?: number;            // default 416
  /** classes in your model       */
  numClasses?: number;      // default 80
  /** keep boxes > confThr        */
  confThr?: number;         // default 0.5
  /** IoU threshold for NMS       */
  nmsThr?: number;          // default 0.45
}

/* ─────────── factory: returns a WORKLET-safe detector ────────── */
/**
 *  const detect = createYoloXNanoDetector(model, resize /* plugin * /)
 *  const boxes = detect(frame)        // in a frame-processor worklet
 */
export function createYoloXNanoDetector(
  model: any /* TensorflowModel */,
  resizeFn: Function /* resize plugin worklet fn */,
  opts: YoloXOpts = {},
) {
  'worklet'

  console.log(`Model loaded! Shape:\n${modelToString(model)}]`)

  const inSize      = opts.size       ?? 416
  const numClasses  = opts.numClasses ?? 80
  const confThr     = opts.confThr    ?? 0.5
  const nmsThr      = opts.nmsThr     ?? 0.45

  // pre-computed grid/stride table
  const grid = _getGrid(inSize, inSize)

  // Pre-compute constants to avoid repeated calculations
  const halfInSize = inSize * 0.5
  
  return (frame:Frame /* VisionCamera Frame */): Detection[] => {
    'worklet'

    // console.log(`[YoloXNano] Processing frame: ${frame.width}x${frame.height}, pixelFormat: ${frame.pixelFormat}`)

    /* 1) preprocess ------------------------------------------------------ */
    const t0 = Date.now()
    
    // Get Float32Array directly from native resize plugin (patched)
    // Android patch keeps values in [0-255] range, iOS patch also keeps [0-255] range
    const inputData = resizeFn(frame, {
      scale: { width: inSize, height: inSize },
      crop: { y: 0, x: 0, width: frame.width, height: frame.height },
      pixelFormat: 'rgb',
      dataType: 'float32' // Returns Float32Array directly, no JS conversion needed
    }) as Float32Array
      
    const t2 = Date.now()
    // console.log(`[YoloX] Input: float32[0,255] from native, sample: ${inputData[0]}`)
    
    
    /* 2) inference + postprocessing -------------------------------------- */
    // Try native postprocessing via modified TFLite plugin
    let detections: Detection[];
    try {
      // Convert grid to flat format for native processing
      const gridFlat = _gridToFlat(grid);
      
      // Run inference with native YoloX postprocessing
      const out = model.runSync([inputData], {
        yoloxPostprocess: true,
        gridData: gridFlat,
        numClasses,
        netSize: inSize,
        confThreshold: confThr,
        nmsThreshold: nmsThr,
        skipNMS: false
      }) as Detection[];
      
      detections = out;
      // console.log('[YoloX] Native postprocessing succeeded');
    } catch (error) {
      console.log('[YoloX] Native postprocessing failed, using JS fallback:', error);
      // Fallback to JS postprocessing
      const out = model.runSync([inputData])
      const tensor = out[0] as Float32Array;
      detections = _postprocess(tensor, grid, inSize, numClasses, confThr, nmsThr);
    }
    const t3 = Date.now()
    
    // Transform coordinates based on frame orientation
    const transformedDetections = detections.map(d => {
      if (frame.orientation === 'landscape-right') {
        // For landscape-right: rotate 90 degrees clockwise 
        // (x,y) -> (1-y, x)
        return {
          ...d,
          x1: 1 - d.y2,
          y1: d.x1,
          x2: 1 - d.y1,
          y2: d.x2
        }
      } else if (frame.orientation === 'landscape-left') {
        // For landscape-left: rotate 90 degrees counter-clockwise
        // (x,y) -> (y, 1-x)  
        return {
          ...d,
          x1: d.y1,
          y1: 1 - d.x2,
          x2: d.y2,
          y2: 1 - d.x1
        }
      }
      // No transformation needed for portrait orientations
      return d
    })
    
    const t4 = Date.now()

    // // Add debug logging
    // console.log(`[YoloXNano] Total detection time: ${t4 - t0}ms, resize: ${t2-t0}ms, inference: ${t3 - t2}ms, postproc: ${t4 - t3}ms, in[${frame.width}x${frame.height}] -> [${inSize}x${inSize}]`)

    return transformedDetections
  }
}
