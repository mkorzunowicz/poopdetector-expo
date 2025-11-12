'use worklet'

import { Detection, modelToString } from "./types";

/* ──────────────────── public types ──────────────────── */

export interface YoloX640Opts {
  confThr?: number;                 // default 0.4
  nmsThr?: number;                  // default 0.45
  maxBoxes?: number;                // default 300
  normalise?: boolean;              // divide pixels by 255? (default false)
}

/* ───────────── helper FIRST (hoisted) ───────────── */

function _iou(a: Detection, b: Detection): number {
  'worklet'
  const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1)
  const x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2)
  const w = Math.max(0, x2 - x1), h = Math.max(0, y2 - y1)
  const inter = w * h
  if (inter === 0) return 0
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1)
  return inter / (areaA + areaB - inter)
}

/* ───────── factory: returns WORKLET detector fn ───────── */

export function createYoloXMediumDetector(
  model: any,          // TensorflowModel (react-native-fast-tflite)
  resizeFn: Function,  // vision-camera-resize-plugin worklet fn
  {
    confThr = 0.4,
    nmsThr = 0.45,
    maxBoxes = 300,
    normalise = false, // set true if your model was trained on 0-1 floats
  }: YoloX640Opts = {},
) {
  'worklet'

  console.log(`Model loaded! Shape:\n${modelToString(model)}]`)

  const size = 640
  const numAnchors = 8400    // 640 model fixed

  return (frame): Detection[] => {
    'worklet'

    /* 1) rotate + resize to preview orientation -------------------- */
    const rot =
      frame.orientation === 0 ? '0deg' :
        frame.orientation === 90 ? '90deg' :
          frame.orientation === 180 ? '180deg' : '270deg'

    const inp = resizeFn(frame, {
      scale: { width: size, height: size },
      crop: {
        y: 0,
        x: 0,
        width: frame.width,
        height: frame.height
      },
      pixelFormat: 'rgb',
      dataType: 'float32',
      // rotation: rot as '0deg' | '90deg' | '180deg' | '270deg',
      normalise,                       // divide by 255 if asked
    })

    // console.log(inp)
    /* 2) inference --------------------------------------------------- */
    const out = model.runSync([inp])
    // console.log(out)
    const boxes = out[0] as Float32Array          // len 33 600
    const scores = out[1] as Float32Array          // len 8 400
    const classes = out[2] as Uint8Array            // len 8 400

    /* 3) mirror for front cam --------------------------------------- */
    const mirror = frame.cameraPosition === 'front'

    /* 4) filter + pack ---------------------------------------------- */
    const cand: Detection[] = []

    for (let i = 0; i < numAnchors && cand.length < maxBoxes; i++) {
      const score = scores[i]
      if (score > 10)
        console.log(score)
      if (score < confThr) continue

      const off = i * 4
      const y1 = boxes[off + 0]
      const x1 = boxes[off + 1]
      const y2 = boxes[off + 2]
      const x2 = boxes[off + 3]

      cand.push({
        x1: mirror ? 1 - x2 : x1,
        y1,
        x2: mirror ? 1 - x1 : x2,
        y2,
        score,
        classId: classes[i],
      })
    }

    /* 5) greedy NMS -------------------------------------------------- */
    cand.sort((a, b) => b.score - a.score)
    const keep: Detection[] = []

    outer: for (let i = 0; i < cand.length; i++) {
      const a = cand[i]
      for (let j = 0; j < keep.length; j++) {
        if (_iou(a, keep[j]) > nmsThr) continue outer
      }
      keep.push(a)
    }
    return keep
  }
}
