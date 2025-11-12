'use worklet'

import { TensorflowModel } from "react-native-fast-tflite";
import { Frame } from "react-native-vision-camera";
import { COCO_LABELS } from "../cocoLabels";
import { toDegrees } from "../orientationMapping";
import { Detection, modelToString } from "./types";

/* ─────────────────── public types ─────────────────── */

export interface EffDetOpts {
  /** network input side (square) */  size?: number;           // default 320
  /** keep boxes ≥ confThr       */   confThr?: number;        // default 0.4
  /** nms treshold       */           nmsThr?: number;         // default 0.45
  /** top-N after NMS            */   maxBoxes?: number;       // default 100
  /** uint8 or float32 input     */   dataType?: 'uint8' | 'float32'; // def. uint8
}

/* ─────────── helper FIRST (hoisted for worklet capture) ────────── */

/** rotate a 0-1 box from sensor-0° to device preview space */
function _rot(
    b: Detection,
    deg: 0 | 90 | 180 | 270,
    mirrored: boolean,
): Detection {
    'worklet'

    // console.log("mirrored:" + mirrored)
    deg = mirrored ? 90 : 270;

    //   console.log(deg)
    /* 1 – rotation ---------------------------------------------------- */
    let x1 = b.x1, y1 = b.y1, x2 = b.x2, y2 = b.y2

    switch (deg as number) {
        case 90: { x1 = b.y1; y1 = 1 - b.x2; x2 = b.y2; y2 = 1 - b.x1; break }
        case 180: { x1 = 1 - b.x2; y1 = 1 - b.y2; x2 = 1 - b.x1; y2 = 1 - b.y1; break }
        case 270: { x1 = 1 - b.y2; y1 = b.x1; x2 = 1 - b.y1; y2 = b.x2; break }
        case 0:
        default: break
    }

    /* 2 – mirror for front cam --------------------------------------- */
    if (mirrored) {
        const nx1 = 1 - x2
        const nx2 = 1 - x1
        x1 = nx1
        x2 = nx2
    }

    /* ensure TL-BR ordering after transforms */
    if (x1 > x2) { const t = x1; x1 = x2; x2 = t }
    if (y1 > y2) { const t = y1; y1 = y2; y2 = t }

    return { ...b, x1, y1, x2, y2 }
}

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

/* ─────────── factory: returns a WORKLET-safe detector fn ────────── */

export function createEfficientDetDetector(
    model: TensorflowModel,           // TensorflowModel (react-native-fast-tflite)
    resizeFn: Function,   // vision-camera-resize-plugin worklet fn
    {
        size = 320,
        confThr = 0.6,
        nmsThr = 0.45,
        maxBoxes = 300,
        dataType = 'uint8',
    }: EffDetOpts = {},
) {
    'worklet'
    console.log(`Model loaded! Shape:\n${modelToString(model)}]`)

    return (
        frame: Frame, mirrored: boolean
    ): Detection[] => {
        'worklet'

        /* 1) preprocess -------------------------------------------------- */
        const inp = resizeFn(frame, {
            scale: { width: size, height: size },
            crop: {
                y: 0,
                x: 0,
                width: frame.width,
                height: frame.height
            },
            pixelFormat: 'rgb',
            dataType,                       // uint8 or float32
        })

        /* 2) inference --------------------------------------------------- */
        const out = model.runSync([inp])

        const boxes = out[0] as Float32Array   // [1,100,4] → flat 400
        const classes = out[1] as Float32Array   // [1,100]
        const scores = out[2] as Float32Array   // [1,100]
        const nDet = (out[3] as Float32Array)[0] | 0

        /* 3) post-proc + rotation --------------------------------------- */
        const deg = toDegrees(frame.orientation)
        const tmp: Detection[] = []

        for (let i = 0; i < nDet && tmp.length < maxBoxes; i++) {
            const score = scores[i]
            if (score < confThr) continue

            const yMin = boxes[i * 4 + 0], xMin = boxes[i * 4 + 1]
            const yMax = boxes[i * 4 + 2], xMax = boxes[i * 4 + 3]

            const rot = _rot(
                { x1: xMin, y1: yMin, x2: xMax, y2: yMax, score, classId: classes[i] | 0 },
                deg, mirrored,
            )
            tmp.push(rot)
        }

        /* 4) greedy NMS -------------------------------------------------- */
        tmp.sort((a, b) => b.score - a.score)
        const keep: Detection[] = []

        outer: for (let i = 0; i < tmp.length; i++) {
            const a = tmp[i]
            for (let j = 0; j < keep.length; j++) {
                if (_iou(a, keep[j]) > nmsThr) continue outer
            }
            keep.push(a)
        }
        const detsWithStyle = keep.map(d => ({
            ...d,
            label: COCO_LABELS[d.classId],
            // color: COCO_COLORS[d.classId],
        }))
        return detsWithStyle
    }
}
