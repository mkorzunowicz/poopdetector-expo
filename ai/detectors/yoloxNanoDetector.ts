'use worklet'

import { Frame } from "react-native-vision-camera"
import { Detection, modelToString } from "./types"

function _iou(a: Detection, b: Detection): number {
  'worklet'
  const x1 = Math.max(a.x1, b.x1)
  const y1 = Math.max(a.y1, b.y1)
  const x2 = Math.min(a.x2, b.x2)
  const y2 = Math.min(a.y2, b.y2)
  const w = Math.max(0, x2 - x1)
  const h = Math.max(0, y2 - y1)
  const inter = w * h
  if (inter === 0) return 0
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1)
  return inter / (areaA + areaB - inter)
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

  return (frame:Frame /* VisionCamera Frame */): Detection[] => {
    'worklet'

    /* 1) preprocess ------------------------------------------------------ */
    const rgb = resizeFn(frame, {
      scale: { width: inSize, height: inSize },
      crop: {
        y: 0,
        x: 0,
        width: frame.width,
        height: frame.height
      },
      pixelFormat: 'rgb',
      // rotation:270,
      // dataType: 'uint8',
       dataType: 'float32',
      // normalise=true makes the plugin divide by 255 for you (plugin ≥1.1)
    //   normalise: true,
    })
    
    /* 2) inference ------------------------------------------------------- */
    const out = model.runSync([rgb])
    // YOLOX has a single output tensor
    const tensor = out[0] as Float32Array

    /* 3) post-process ---------------------------------------------------- */
    return _postprocess(
      tensor,
      grid,
      inSize,
      numClasses,
      confThr,
      nmsThr,
    )
  }
}

/* ───────────────────── private helpers ──────────────────────── */

const NUM_BBOX_FIELDS = 5
const STRIDES = [8, 16, 32] as const

function _postprocess(
  tensor: Float32Array,
  grid: readonly { cx: number; cy: number; s: number }[],
  netSize: number,
  numClasses: number,
  confThr: number,
  nmsThr: number,
): Detection[] {
  'worklet'

  const stride = numClasses + NUM_BBOX_FIELDS
  const anchors = grid.length
  const boxes: Detection[] = []

  for (let a = 0; a < anchors; a++) {
    const g = grid[a]
    const off = a * stride

    const cx = (tensor[off + 0] + g.cx) * g.s
    const cy = (tensor[off + 1] + g.cy) * g.s
    const w  = Math.exp(tensor[off + 2]) * g.s
    const h  = Math.exp(tensor[off + 3]) * g.s

    const obj = tensor[off + 4]

    let bestProb = 0
    let bestCls  = 0
    for (let c = 0; c < numClasses; c++) {
      const p = tensor[off + NUM_BBOX_FIELDS + c] * obj
      if (p > bestProb) { bestProb = p; bestCls = c }
    }
    if (bestProb < confThr) continue

    boxes.push({
      x1: (cx - w * 0.5) / netSize,
      y1: (cy - h * 0.5) / netSize,
      x2: (cx + w * 0.5) / netSize,
      y2: (cy + h * 0.5) / netSize,
      score: bestProb,
      classId: bestCls,
    })
  }

  // console.log(boxes.length)
  /* NMS (IoU) ------------------------------------------------------------ */
  boxes.sort((a, b) => b.score - a.score)
  const picked: Detection[] = []

  outer: for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]
    for (let j = 0; j < picked.length; j++) {
      if (_iou(a, picked[j]) > nmsThr) continue outer
    }
    picked.push(a)
  }
  // console.log(picked.length)
  return picked
}

/* grid cache (per net-size) */
const _gridCache: Record<number, Array<{ cx: number; cy: number; s: number }>> =
  {}

function _getGrid(w: number, h: number) {
  'worklet'
  const key = w * 10000 + h
  if (!_gridCache[key]) {
    const cells: { cx: number; cy: number; s: number }[] = []
    for (let sIdx = 0; sIdx < STRIDES.length; sIdx++) {
      const s = STRIDES[sIdx]
      const gw = w / s
      const gh = h / s
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          cells.push({ cx: x, cy: y, s })
        }
      }
    }
    _gridCache[key] = cells
  }
  return _gridCache[key]!
}