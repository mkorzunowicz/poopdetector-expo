import type { Image as NitroImage } from "react-native-nitro-image";
import type { InferenceSession } from "react-native-nitro-onnxruntime";

import { toExactArrayBuffer } from "./detectors/types";
import {
  cropMaskToContent,
  elapsedMs,
  logSam,
  MAX_PROMPT_POINTS_SAFETY_CAP,
  maskToPolygon,
  measureStart,
  reportSamProgress,
  resizeForSamEncoder,
  resolveRgbIndices,
  SAM_ENCODER_SIZE,
  SAM_MASK_SIZE,
  SAM_PAD_PIXEL_RGB,
  selectMaskSlice,
  toBinaryMask,
  type RawPixelDataLike,
  type RawPixelFormat,
  type SamDecodeResult,
  type SamEmbeddings,
  type SamEncoderContext,
  type SamPoint,
  type SamPreprocessing,
  type SamProgressCallback,
} from "./mobileSamPhoto";
import { markOnnxRunEnd, markOnnxRunStart } from "./onnxModelCache";

// EdgeSAM's ONNX encoder wants NCHW ([1,3,H,W], planar) rather than the NHWC
// ([1,H,W,3], interleaved) layout every TFLite export here uses -- adapted
// from mobileSamPhoto.ts's packSamEncoderInput, writing each channel to its
// own contiguous plane instead of interleaving per pixel.
function packSamEncoderInputNCHW(
  raw: RawPixelDataLike,
  contentWidth: number,
  contentHeight: number,
  canvasSize: number,
  preprocessing: SamPreprocessing,
): Float32Array {
  const [meanR, meanG, meanB] = preprocessing.mean;
  const [stdR, stdG, stdB] = preprocessing.std;
  const planeSize = canvasSize * canvasSize;
  const output = new Float32Array(planeSize * 3);

  if (contentWidth < canvasSize || contentHeight < canvasSize) {
    const [padByteR, padByteG, padByteB] = SAM_PAD_PIXEL_RGB;
    const padR = (padByteR - meanR) / stdR;
    const padG = (padByteG - meanG) / stdG;
    const padB = (padByteB - meanB) / stdB;
    output.fill(padR, 0, planeSize);
    output.fill(padG, planeSize, planeSize * 2);
    output.fill(padB, planeSize * 2, planeSize * 3);
  }

  const bytes = new Uint8Array(raw.buffer);
  const sourceWidth = raw.width;
  const sourceHeight = raw.height;
  const pixelCount = sourceWidth * sourceHeight;
  const bytesPerPixel = pixelCount > 0 ? bytes.length / pixelCount : 0;
  const [redIndex, greenIndex, blueIndex, stride] = resolveRgbIndices(
    raw.pixelFormat as RawPixelFormat,
    bytesPerPixel,
  );

  for (let targetY = 0; targetY < contentHeight; targetY += 1) {
    const sourceY = Math.min(
      sourceHeight - 1,
      Math.floor(((targetY + 0.5) * sourceHeight) / contentHeight),
    );
    for (let targetX = 0; targetX < contentWidth; targetX += 1) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.floor(((targetX + 0.5) * sourceWidth) / contentWidth),
      );
      const sourceIndex = (sourceY * sourceWidth + sourceX) * stride;
      const pixelIndex = targetY * canvasSize + targetX;
      output[pixelIndex] = ((bytes[sourceIndex + redIndex] ?? 0) - meanR) / stdR;
      output[planeSize + pixelIndex] =
        ((bytes[sourceIndex + greenIndex] ?? 0) - meanG) / stdG;
      output[planeSize * 2 + pixelIndex] =
        ((bytes[sourceIndex + blueIndex] ?? 0) - meanB) / stdB;
    }
  }

  return output;
}

function outputName(session: InferenceSession, index: number): string {
  const tensor = session.outputNames[index];
  if (!tensor) {
    throw new Error(`ONNX session has no output at index ${index}.`);
  }
  return tensor.name;
}

async function runOnnxAsync(
  session: InferenceSession,
  feeds: Record<string, ArrayBuffer>,
  operation: string,
): Promise<Record<string, ArrayBuffer>> {
  const startTime = measureStart();
  markOnnxRunStart(session);
  try {
    const result = await session.runAsync(feeds).finally(() => markOnnxRunEnd(session));
    logSam(`${operation} ran in ${elapsedMs(startTime)}ms`);
    return result;
  } catch (error) {
    logSam(`${operation} failed after ${elapsedMs(startTime)}ms: ${String(error)}`);
    throw error;
  }
}

export async function encodePhotoForSamOnnx(
  session: InferenceSession,
  image: NitroImage,
  preprocessing: SamPreprocessing,
  onProgress?: SamProgressCallback,
): Promise<{
  embeddings: SamEmbeddings;
  context: SamEncoderContext;
}> {
  const startTime = measureStart();

  await reportSamProgress(onProgress, "Resizing SAM input...");
  const resizeStart = measureStart();
  const { image: resized, context } = await resizeForSamEncoder(
    image,
    preprocessing.geometry,
  );
  const resizeMs = elapsedMs(resizeStart);

  await reportSamProgress(onProgress, "Reading SAM pixels...");
  const readPixelsStart = measureStart();
  const rawPixels = await resized.toRawPixelDataAsync();
  const readPixelsMs = elapsedMs(readPixelsStart);

  await reportSamProgress(onProgress, "Packing SAM encoder tensor...");
  const packStart = measureStart();
  const inputData = packSamEncoderInputNCHW(
    rawPixels as RawPixelDataLike,
    context.contentWidth,
    context.contentHeight,
    SAM_ENCODER_SIZE,
    preprocessing,
  );
  const packMs = elapsedMs(packStart);

  await reportSamProgress(onProgress, "Running SAM encoder...");
  const inferStart = measureStart();
  const inputTensorName = session.inputNames[0]?.name ?? "image";
  const outputs = await runOnnxAsync(
    session,
    { [inputTensorName]: toExactArrayBuffer(inputData) },
    "SAM encoder (onnx)",
  );
  const inferMs = elapsedMs(inferStart);

  const embeddings = outputs[outputName(session, 0)];
  if (!embeddings) {
    throw new Error("ONNX SAM encoder did not return an embeddings tensor.");
  }

  const totalMs = elapsedMs(startTime);
  logSam(
    `Encoded in ${totalMs}ms ` +
      `(resize ${resizeMs}, read ${readPixelsMs}, pack ${packMs}, infer ${inferMs})`,
  );

  return { embeddings, context };
}

export async function decodeSamMaskOnnx(
  session: InferenceSession,
  embeddings: SamEmbeddings,
  context: SamEncoderContext,
  points: SamPoint[],
  threshold = 0.5,
): Promise<SamDecodeResult> {
  const startTime = measureStart();
  if (points.length === 0) {
    throw new Error("EdgeSAM (onnx) decode requires at least one point.");
  }

  const positiveCount = points.filter((point) => point.label === 1).length;
  if (positiveCount === 0) {
    logSam(`Decoded in ${elapsedMs(startTime)}ms (no positive points)`);
    return {
      binaryMask: new Uint8Array(SAM_MASK_SIZE * SAM_MASK_SIZE),
      maskWidth: SAM_MASK_SIZE,
      maskHeight: SAM_MASK_SIZE,
      polygon: [],
      score: 0,
    };
  }

  // Unlike every TFLite decoder in this app (fixed, compile-time-baked point
  // count), this decoder's point_coords/point_labels have a genuine dynamic
  // num_points axis (verified via cpp/InferenceSession.cpp's single-dynamic-
  // dimension inference, and locally via onnxruntime against a synthetic
  // multi-target scene). So every point goes into ONE native call -- no
  // client-side batching/union workaround needed. The safety cap here is
  // purely a pathological-latency guard, not a correctness requirement.
  let packedPoints = points;
  if (packedPoints.length > MAX_PROMPT_POINTS_SAFETY_CAP) {
    logSam(
      `WARNING: ${packedPoints.length} points exceeds the safety cap ` +
        `(${MAX_PROMPT_POINTS_SAFETY_CAP}); dropping the oldest ` +
        `${packedPoints.length - MAX_PROMPT_POINTS_SAFETY_CAP}.`,
    );
    packedPoints = packedPoints.slice(-MAX_PROMPT_POINTS_SAFETY_CAP);
  }

  const pointCoords = new Float32Array(packedPoints.length * 2);
  const pointLabels = new Float32Array(packedPoints.length);
  packedPoints.forEach((point, index) => {
    pointCoords[index * 2] = point.x * context.contentWidth;
    pointCoords[index * 2 + 1] = point.y * context.contentHeight;
    pointLabels[index] = point.label;
  });

  const outputs = await runOnnxAsync(
    session,
    {
      image_embeddings: toExactArrayBuffer(embeddings),
      point_coords: toExactArrayBuffer(pointCoords),
      point_labels: toExactArrayBuffer(pointLabels),
    },
    "SAM decoder (onnx)",
  );

  // Output shapes are omitted here (unlike the TFLite path's model.outputs
  // shape hints): the decoder's dynamic num_points axis means declared
  // static dims aren't reliable, and local verification already confirmed
  // this export's mask layout is the standard [1,K,256,256] mask-major
  // layout (not channel-last), so selectMaskSlice's shape-based check is
  // unnecessary here and safely falls through to that default.
  const maskTensors = Object.values(outputs).map(
    (buffer) => new Float32Array(buffer),
  );
  const { logits, score } = selectMaskSlice(maskTensors);

  const fullMask = toBinaryMask(logits, threshold);
  const { mask, width, height } = cropMaskToContent(
    fullMask,
    SAM_MASK_SIZE,
    SAM_MASK_SIZE,
    context,
  );

  const positivePoints = packedPoints.filter((point) => point.label === 1);
  const polygon = maskToPolygon(
    mask,
    width,
    height,
    context.originalWidth,
    context.originalHeight,
    positivePoints,
  );

  const totalMs = elapsedMs(startTime);
  logSam(
    `Decoded in ${totalMs}ms (native x${packedPoints.length}, ` +
      `score ${score.toFixed(2)}, ${polygon.length} poly pts)`,
  );

  return { binaryMask: mask, maskWidth: width, maskHeight: height, polygon, score };
}
