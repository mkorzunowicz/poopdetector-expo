/* samDetectors.ts  – worklet‑safe SAM‑Lite encoder + decoder */
"use worklet";

import type { CameraOrientation, Frame } from "react-native-vision-camera";

import { toExactArrayBuffer } from "./types";

/* ─────────────────── shared helpers ─────────────────── */

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

/* ──────────────────── SamEncoder ────────────────────── */

export interface SamEncoderOpts {
  normalise?: boolean; // divide by 255?  default false
}

export function createSamEncoder(
  model: any, // TensorflowModel (react-native-fast-tflite)
  resizeFn: Function, // vision-camera-resize-plugin worklet fn
  { normalise = false }: SamEncoderOpts = {},
) {
  "worklet";

  const SIZE = 1024; // encoder input side

  return (frame: Frame): Float32Array | null => {
    "worklet";

    /* rotate → preview upright, then resize ----------------------- */
    const rot = toDeg(frame.orientation);
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
      rotation: (rot + "deg") as "0deg" | "90deg" | "180deg" | "270deg",
      normalise,
    });

    /* run encoder -------------------------------------------------- */
    const out = model.runSync([toExactArrayBuffer(inp)]);
    // encoder has exactly one output
    return new Float32Array(out[0]!); // length = 64*64*256 = 1,048,576
  };
}

/* ──────────────────── SamDecoder ────────────────────── */

export interface SamDecoderOpts {
  maskThreshold?: number; // binarise ≥ threshold (default 0.0 → raw probs)
}

export function createSamDecoder(
  model: any,
  { maskThreshold = 0 }: SamDecoderOpts = {},
) {
  "worklet";

  return (
    embeddings: Float32Array, // from encoder
    pointX: number, // 0‑1 (preview space!)
    pointY: number, // 0‑1
    pointLabel: 0 | 1 = 1, // 1=positive, 0=negative
    mirrored = false, // true for front camera
  ): { mask: Float32Array; score: number } | null => {
    "worklet";

    if (mirrored) pointX = 1 - pointX;

    /* inputs ------------------------------------------------------- */
    //  [1,64,64,256]  → already correct shape
    const ptCoords = new Float32Array([pointX, pointY, 0, 0]); // padded to 2×2
    const ptLabels = new Float32Array([pointLabel, 0]);

    const out = model.runSync([
      toExactArrayBuffer(embeddings),
      toExactArrayBuffer(ptCoords),
      toExactArrayBuffer(ptLabels),
    ]);

    let mask = new Float32Array(out[0]!); // len 256*256
    const score = new Float32Array(out[1]!)[0];

    /* optional threshold → binary mask ---------------------------- */
    if (maskThreshold > 0) {
      const bin = new Uint8Array(mask.length);
      for (let i = 0; i < mask.length; i++)
        bin[i] = mask[i] >= maskThreshold ? 255 : 0;
      // re‑use the same type so callers don't have to branch
      mask = new Float32Array(bin.buffer);
    }

    return { mask, score };
  };
}
