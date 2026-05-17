/* yolov8Detector.ts – worklet‑safe detector for the 84×8400 export */
"use worklet";

import type { CameraOrientation, Frame } from "react-native-vision-camera";
import { COCO_COLORS, COCO_LABELS } from "../cocoLabels"; // adjust the path as needed
import { Detection, modelToString, toExactArrayBuffer } from "./types";

/* ── public types ─────────────────────────────────────────────── */

export interface YoloV8Opts {
  confThr?: number; // default 0.4
  nmsThr?: number; // default 0.45
  maxBoxes?: number; // default 300
  normalise?: boolean; // divide RGB by 255?  default false
}

/* ── helpers (hoisted for worklet capture) ────────────────────── */

function _iou(a: Detection, b: Detection): number {
  "worklet";
  const x1 = Math.max(a.x1, b.x1),
    y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2),
    y2 = Math.min(a.y2, b.y2);
  const w = Math.max(0, x2 - x1),
    h = Math.max(0, y2 - y1);
  const inter = w * h;
  if (!inter) return 0;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter);
}

function toDeg(o: CameraOrientation): 0 | 90 | 180 | 270 {
  "worklet";
  switch (o) {
    case "up":
      return 0;
    case "left":
      return 90;
    case "down":
      return 180;
    case "right":
      return 270;
    default:
      return 0;
  }
}

/* ── detector factory ─────────────────────────────────────────── */

export function createYolov8Detector(
  model: any,
  resizeFn: Function,
  {
    confThr = 0.4,
    nmsThr = 0.45,
    maxBoxes = 300,
    normalise = false,
  }: YoloV8Opts = {},
) {
  "worklet";

  console.log(`Model loaded! Shape:\n${modelToString(model)}]`);

  const SIZE = 640;
  const N_ANCH = 8400;
  const CH = 84; // cx,cy,w,h + 80 classes
  const LEN = CH * N_ANCH; // 705 600

  return (frame: Frame): Detection[] => {
    "worklet";

    /* 1 – rotate & resize into preview orientation ---------------- */
    let rot = toDeg(frame.orientation);
    rot = 0;
    const inp = resizeFn(frame, {
      scale: { width: SIZE, height: SIZE },
      crop: {
        y: 0,
        x: 0,
        width: frame.width,
        height: frame.height,
      },
      pixelFormat: "rgb",
      dataType: "float32",
      // rotation: (rot + 'deg') as '0deg' | '90deg' | '180deg' | '270deg',
      normalise,
    });

    /* 2 – inference ---------------------------------------------- */
    const tens = new Float32Array(model.runSync([toExactArrayBuffer(inp)])[0]!); // len 705600
    if (tens.length !== LEN) {
      console.warn("[YOLOv8] unexpected tensor length", tens.length);
      return [];
    }

    const mirror = frame.isMirrored;
    const cand: Detection[] = [];

    for (let i = 0; i < N_ANCH && cand.length < maxBoxes; i++) {
      /* best class & score */
      let best = 0;
      let cls = 0;
      const base = 4 * N_ANCH + i; // first class channel index
      for (let c = 0; c < 80; c++) {
        const s = tens[base + c * N_ANCH];
        if (s > best) {
          best = s;
          cls = c;
        }
      }
      if (best < confThr) continue;

      /* decode cx cy w h (in px) */

      let x1 = tens[0 * N_ANCH + i];
      let y1 = tens[1 * N_ANCH + i];
      let x2 = tens[2 * N_ANCH + i];
      let y2 = tens[3 * N_ANCH + i];
      // if (mirror) {
      //   const nx1 = 1 - x2
      //   const nx2 = 1 - x1
      //   x1 = nx1; x2 = nx2
      // }
      // TODO: coords are still off
      cand.push({ x2, y2, x1, y1, score: best, classId: cls });
    }

    /* 3 – NMS ------------------------------------------------------ */
    cand.sort((a, b) => b.score - a.score);
    const keep: Detection[] = [];

    outer: for (let i = 0; i < cand.length; i++) {
      const a = cand[i];
      for (let j = 0; j < keep.length; j++) {
        if (_iou(a, keep[j]) > nmsThr) continue outer;
      }
      keep.push(a);
    }

    /* 4 – attach label & return ---------------------------------- */
    const detsWithStyle = keep.map((d) => ({
      ...d,
      label: COCO_LABELS[d.classId],
      color: COCO_COLORS[d.classId], // uncomment if needed
    }));
    return detsWithStyle;
  };
}
