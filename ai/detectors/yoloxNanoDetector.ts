"use worklet";

import { Frame } from "react-native-vision-camera";
import { Detection, modelToString, toExactArrayBuffer } from "./types";

/* ───────────────────── private helpers ──────────────────────── */

const NUM_BBOX_FIELDS = 5; // cx, cy, w, h, objectness

/* Gates applied before the (cheap) score multiply. These are pre-NMS pruning
 * knobs, NOT the user-facing confidence threshold -- that is `confThr`, passed
 * in by the caller. Kept low so `confThr` stays the single meaningful dial;
 * the old values (0.15 / 0.4 / 0.25) were tuned against a DOUBLE-SIGMOIDED
 * score range and are far too aggressive now that scores are read correctly. */
const OBJECTNESS_GATE = 0.05;
const CLASS_GATE = 0.05;

const MIN_BOX_FRAC = 0.015; // 1.5% of the frame
const MAX_BOX_FRAC = 0.95;
const MAX_PROPOSALS = 100;

/* One-shot flag for the input-range log below. Held as an OBJECT PROPERTY, not
 * a bare `let`: the worklet runtime captures module-scope bindings by value, so
 * assigning to a plain `let` from inside the frame processor would not stick and
 * the message would repeat on every frame. Mutating a captured object does. */
const _diag = { logged: false };

// Calculate intersection area (matches C# CalcInterArea)
function _calcInterArea(a: Detection, b: Detection): number {
  "worklet";
  const x = Math.max(a.x1, b.x1);
  const y = Math.max(a.y1, b.y1);
  const w = Math.min(a.x2, b.x2) - x;
  const h = Math.min(a.y2, b.y2) - y;

  // No intersection if width or height is negative
  if (w < 0 || h < 0) return 0;
  return w * h;
}

// Calculate union area (matches C# CalcUnionArea)
function _calcUnionArea(a: Detection, b: Detection): number {
  "worklet";
  const x = Math.min(a.x1, b.x1);
  const y = Math.min(a.y1, b.y1);
  const w = Math.max(a.x2, b.x2) - x;
  const h = Math.max(a.y2, b.y2) - y;

  return w * h;
}

function _iou(a: Detection, b: Detection): number {
  "worklet";
  const interArea = _calcInterArea(a, b);
  if (interArea === 0) return 0;

  const unionArea = _calcUnionArea(a, b);
  return interArea / unionArea;
}

/**
 * 180-degree rotation of the box in normalized space.
 *
 * DELIBERATELY LEFT UNCHANGED during the 2026-07 model swap. This compensates
 * for how the camera frame arrives from the resizer, which is orthogonal to the
 * model's output contract -- so the decode fixes in this file neither justify
 * removing it nor confirm it is still right.
 *
 * It is, however, UNVERIFIED against the new export and cannot be checked off
 * device. If boxes render 180 degrees out (top-left object boxed at
 * bottom-right), delete the `.map(_flipXY)` at the end of the detector; if they
 * render correctly, keep it and drop this note. Test with an object clearly
 * off-centre -- a centred object looks identical either way and will tell you
 * nothing.
 */
function _flipXY(box: Detection): Detection {
  "worklet";
  return {
    ...box,
    x1: 1 - box.x2,
    x2: 1 - box.x1,
    y1: 1 - box.y2,
    y2: 1 - box.y1,
  };
}

/**
 * Turn the model's raw tensor into scored boxes.
 *
 * CONTRACT of the models exported by tools/yolox_to_tflite.py (see the .json
 * sidecar next to each .tflite):
 *
 *   - boxes are ALREADY DECODED: fields 0..3 are cx, cy, w, h in INPUT PIXELS.
 *     No grid walk, no `+ grid.x`, no `* stride`, no `Math.exp()`.
 *   - objectness and class scores are ALREADY SIGMOID-ACTIVATED, i.e. in [0, 1].
 *     Applying sigmoid again squeezes everything into ~[0.25, 0.53], which
 *     silently destroys every threshold below. Verified against PyTorch by
 *     tools/verify_tflite.py: objectness came out in [0.0000, 0.8730].
 *
 * The previous version of this file did BOTH of those things wrongly for the
 * current export, which is the single biggest source of bad detections.
 */
function _generateBoundingBoxProposals(
  modelOutput: Float32Array,
  numAnchors: number,
  numClasses: number,
  numBBoxFields: number,
  confidenceThreshold: number,
  netSize: number,
): Detection[] {
  "worklet";

  const proposalLength = numClasses + numBBoxFields;
  const proposals: Detection[] = [];

  for (let anchorIndex = 0; anchorIndex < numAnchors; anchorIndex++) {
    const startIndex = anchorIndex * proposalLength;

    // Already sigmoid-activated by the graph -- read it straight.
    const boxObjectness = modelOutput[startIndex + 4];

    // Cheapest possible rejection first: most anchors die here.
    if (boxObjectness < OBJECTNESS_GATE) continue;

    let bestClassScore = 0;
    let bestClassIndex = 0;
    for (let classIndex = 0; classIndex < numClasses; classIndex++) {
      const classScore = modelOutput[startIndex + numBBoxFields + classIndex];
      if (classScore > bestClassScore) {
        bestClassScore = classScore;
        bestClassIndex = classIndex;
      }
    }
    if (bestClassScore < CLASS_GATE) continue;

    const bestProb = boxObjectness * bestClassScore;
    if (bestProb < confidenceThreshold) continue;

    // Decoded centre/size in input pixels -> normalized corners.
    const cx = modelOutput[startIndex];
    const cy = modelOutput[startIndex + 1];
    const halfW = modelOutput[startIndex + 2] * 0.5;
    const halfH = modelOutput[startIndex + 3] * 0.5;

    const x1 = (cx - halfW) / netSize;
    const y1 = (cy - halfH) / netSize;
    const x2 = (cx + halfW) / netSize;
    const y2 = (cy + halfH) / netSize;

    // Clamp rather than discard. The old code dropped any box touching an edge,
    // which threw away real detections at the frame border -- poop half out of
    // shot is still poop, and on a live camera it is about to be centred.
    const cx1 = x1 < 0 ? 0 : x1;
    const cy1 = y1 < 0 ? 0 : y1;
    const cx2 = x2 > 1 ? 1 : x2;
    const cy2 = y2 > 1 ? 1 : y2;

    const bw = cx2 - cx1;
    const bh = cy2 - cy1;
    if (bw < MIN_BOX_FRAC || bh < MIN_BOX_FRAC) continue;
    if (bw > MAX_BOX_FRAC || bh > MAX_BOX_FRAC) continue;

    proposals.push({
      x1: cx1,
      y1: cy1,
      x2: cx2,
      y2: cy2,
      score: bestProb,
      classId: bestClassIndex,
    });

    if (proposals.length >= MAX_PROPOSALS) break;
  }

  proposals.sort((a, b) => b.score - a.score);
  return proposals;
}

function _postprocess(
  tensor: Float32Array,
  netSize: number,
  numClasses: number,
  confThr: number,
  nmsThr: number,
): Detection[] {
  "worklet";

  // Anchor count comes from the tensor itself rather than a rebuilt grid: the
  // graph already decoded the boxes, so the only thing still needed is how many
  // rows there are. (416 -> 3549 = 52^2 + 26^2 + 13^2; 640 -> 8400.)
  const numAnchors = Math.floor(tensor.length / (numClasses + NUM_BBOX_FIELDS));

  const proposals = _generateBoundingBoxProposals(
    tensor,
    numAnchors,
    numClasses,
    NUM_BBOX_FIELDS,
    confThr,
    netSize,
  );

  // console.log(`[YoloX] Generated ${proposals.length} proposals`)

  // Apply NMS (matches C# NMSSortedBoxesOptimized)
  const picked: Detection[] = [];

  for (let i = 0; i < proposals.length; i++) {
    let keep = true;
    const a = proposals[i];

    for (let j = 0; j < picked.length; j++) {
      const interArea = _calcInterArea(a, picked[j]);
      if (interArea > 0) {
        const unionArea = _calcUnionArea(a, picked[j]);
        if (interArea / unionArea > nmsThr) {
          keep = false;
          break;
        }
      }
    }

    if (keep) {
      picked.push(a);
    }
  }

  // console.log(`[YoloX] After NMS: ${picked.length} detections kept`)

  // Final reasonable limit on detections - reduced for performance
  const finalDetections = picked.slice(0, 20); // Maximum 20 detections per frame (was 50)
  if (finalDetections.length < picked.length) {
    console.log(
      `[YoloX] Limited to ${finalDetections.length} detections (was ${picked.length})`,
    );
  }

  return finalDetections;
}
/* ─────────────────── public types ─────────────────── */

export interface YoloXOpts {
  /** network input size (square) */
  size?: number; // default 416
  /** classes in your model       */
  numClasses?: number; // default 80
  /** keep boxes > confThr        */
  confThr?: number; // default 0.5
  /** IoU threshold for NMS       */
  nmsThr?: number; // default 0.45
}

/* ─────────── factory: returns a WORKLET-safe detector ────────── */
/**
 *  const detect = createYoloXNanoDetector(model, resize /* plugin * /)
 *  const boxes = detect(frame)        // in a frame-processor worklet
 */
export function createYoloXNanoDetector(
  model: any /* TensorflowModel */,
  resizer:
    | Function
    | {
        resize(frame: Frame): {
          getPixelBuffer(): ArrayBuffer;
          dispose(): void;
        };
      },
  opts: YoloXOpts = {},
) {
  "worklet";

  console.log(`Model loaded! Shape:\n${modelToString(model)}]`);

  const inSize = opts.size ?? 416;
  const numClasses = opts.numClasses ?? 80;
  const confThr = opts.confThr ?? 0.5;
  const nmsThr = opts.nmsThr ?? 0.45;

  return (frame: Frame /* VisionCamera Frame */): Detection[] => {
    "worklet";

    // console.log(`[YoloXNano] Processing frame: ${frame.width}x${frame.height}, pixelFormat: ${frame.pixelFormat}`)

    /* 1) preprocess ------------------------------------------------------ */
    const t0 = Date.now();

    // The model now eats [0, 1] directly -- tools/yolox_to_tflite.py folded the
    // x255 into the stem convolution (exact, zero runtime cost). The resizer
    // therefore hands its NATIVE [0, 1] output straight through, and the
    // patches/react-native-vision-camera-resizer+5.1.1.patch that multiplied by
    // 255 in the Metal/Vulkan kernel is no longer needed. Delete that patch.
    let inputData: Float32Array;
    if (typeof resizer === "function") {
      inputData = resizer(frame, {
        scale: { width: inSize, height: inSize },
        crop: { y: 0, x: 0, width: frame.width, height: frame.height },
        pixelFormat: "rgb",
        dataType: "float32",
      }) as Float32Array;
    } else {
      const resizedFrame = resizer.resize(frame);
      inputData = new Float32Array(resizedFrame.getPixelBuffer());
      resizedFrame.dispose();
    }

    const t2 = Date.now();

    /* 2) inference + postprocessing -------------------------------------- */
    const out = model.runSync([toExactArrayBuffer(inputData)]);
    const tensor = new Float32Array(out[0]!);

    /* 2b) one-time self-check -------------------------------------------- */
    // "Confident garbage" has two common causes that look identical on screen:
    //   (a) input-range mismatch -- a [0,1] model fed [0,255] saturates
    //   (b) an OLD-CONTRACT model -- raw grid offsets read as pixels, and raw
    //       logits read as probabilities
    // Neither shows up in any other log line, so measure both once and name the
    // culprit explicitly instead of leaving it to inspection of the boxes.
    if (!_diag.logged) {
      _diag.logged = true;

      let inLo = Infinity;
      let inHi = -Infinity;
      for (let i = 0; i < inputData.length; i += 997) {
        const v = inputData[i];
        if (v < inLo) inLo = v;
        if (v > inHi) inHi = v;
      }

      // Sample the box + objectness fields across the whole tensor.
      const stride = numClasses + NUM_BBOX_FIELDS;
      let boxHi = 0;
      let objLo = Infinity;
      let objHi = -Infinity;
      for (let a = 0; a < tensor.length / stride; a += 7) {
        const s = a * stride;
        for (let f = 0; f < 4; f++) {
          const v = Math.abs(tensor[s + f]);
          if (v > boxHi) boxHi = v;
        }
        const o = tensor[s + 4];
        if (o < objLo) objLo = o;
        if (o > objHi) objHi = o;
      }

      const inputLooks255 = inHi > 1.5;
      // Decoded boxes span the input resolution; raw grid offsets stay tiny.
      const boxesDecoded = boxHi > inSize * 0.25;
      // Sigmoid output is bounded; logits are not.
      const scoresActivated = objLo >= -0.001 && objHi <= 1.001;

      console.log(
        `[YoloX] SELF-CHECK\n` +
          `  input range   ${inLo.toFixed(3)}..${inHi.toFixed(3)}  -> ${inputLooks255 ? "[0,255]" : "[0,1]"}\n` +
          `  box field max ${boxHi.toFixed(1)}  -> ${boxesDecoded ? "decoded pixels (new)" : "RAW GRID OFFSETS (old model!)"}\n` +
          `  objectness    ${objLo.toFixed(3)}..${objHi.toFixed(3)}  -> ${scoresActivated ? "sigmoid applied (new)" : "RAW LOGITS (old model!)"}\n` +
          `  model expects ${inputLooks255 ? "poop_nano_416_range255_float32.tflite" : "poop_nano_416_float32.tflite"}` +
          ` (NATIVE_BUILD_STILL_HAS_X255_PATCH = ${inputLooks255})`,
      );

      if (!boxesDecoded || !scoresActivated) {
        console.log(
          `[YoloX] *** WRONG MODEL LOADED. This build is running an OLD-CONTRACT ` +
            `export through the NEW decoder, which produces confident boxes in ` +
            `meaningless places. Rebuild so assets/poop_nano_416*.tflite is the ` +
            `bundled asset. ***`,
        );
      }
    }

    const detections = _postprocess(tensor, inSize, numClasses, confThr, nmsThr);
    const t3 = Date.now();

    const t4 = Date.now();

    // // Add debug logging
    // console.log(`[YoloXNano] Total detection time: ${t4 - t0}ms, resize: ${t2-t0}ms, inference: ${t3 - t2}ms, postproc: ${t4 - t3}ms, in[${frame.width}x${frame.height}] -> [${inSize}x${inSize}]`)

    return detections.map(_flipXY);
  };
}
