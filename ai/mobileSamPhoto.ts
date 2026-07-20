import type { TensorflowModel } from "react-native-fast-tflite";
import { loadImage, type Image as NitroImage } from "react-native-nitro-image";

import type { Detection } from "./detectors/types";
import { modelToString, toExactArrayBuffer } from "./detectors/types";

const YOLOX_NUM_BBOX_FIELDS = 5;
const YOLOX_STRIDES = [8, 16, 32] as const;
const SAM_ENCODER_SIZE = 1024;
const SAM_MASK_SIZE = 256;
const SAM_MODEL_TIMEOUT_MS = 15000;

type RawPixelFormat =
  | "ARGB"
  | "BGRA"
  | "ABGR"
  | "RGBA"
  | "XRGB"
  | "BGRX"
  | "XBGR"
  | "RGBX"
  | "RGB"
  | "BGR"
  | "unknown";

interface GridCoordinate {
  x: number;
  y: number;
  stride: number;
}

export interface PhotoImageData {
  image: NitroImage;
  filePath: string;
  width: number;
  height: number;
}

export interface SamPoint {
  x: number; // normalized 0..1 in original image space
  y: number; // normalized 0..1 in original image space
  label: 0 | 1;
}

export interface SamEncoderContext {
  originalWidth: number;
  originalHeight: number;
  encoderWidth: number;
  encoderHeight: number;
}

export interface SamDecodeResult {
  binaryMask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  polygon: Array<{ x: number; y: number }>;
  score: number;
}

export type SamEmbeddings = ArrayBuffer;

type RawPixelDataLike = {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  pixelFormat: RawPixelFormat | string;
};

type SamProgressCallback = (message: string) => void | Promise<void>;

const yoloxGridCache: Record<number, GridCoordinate[]> = {};

function logMediaSam(message: string, data?: Record<string, unknown>): void {
  if (data) {
    console.log(`[MediaSAM] ${message}`, data);
    return;
  }
  console.log(`[MediaSAM] ${message}`);
}

function logMediaSamError(
  message: string,
  error: unknown,
  data?: Record<string, unknown>,
): void {
  if (data) {
    console.error(`[MediaSAM] ${message}`, { ...data, error });
    return;
  }
  console.error(`[MediaSAM] ${message}`, error);
}

function measureStart(): number {
  return Date.now();
}

function elapsedMs(startTime: number): number {
  return Date.now() - startTime;
}

function normalizeFilePath(path: string): string {
  if (path.startsWith("file://")) {
    return decodeURIComponent(path.slice("file://".length));
  }
  return decodeURIComponent(path);
}

export function toFileUri(path: string): string {
  return path.startsWith("file://") ? path : `file://${path}`;
}

export async function loadPhotoImage(path: string): Promise<PhotoImageData> {
  const startTime = measureStart();
  const filePath = normalizeFilePath(path);
  const image = await Promise.resolve(loadImage({ filePath }));

  logMediaSam("Photo loaded", {
    filePath,
    width: image.width,
    height: image.height,
    elapsedMs: elapsedMs(startTime),
  });

  return {
    image,
    filePath,
    width: image.width,
    height: image.height,
  };
}

function rgbIndices(
  pixelFormat: RawPixelFormat,
): [number, number, number, number] {
  switch (pixelFormat) {
    case "BGRA":
    case "BGRX":
      return [2, 1, 0, 4];
    case "RGBA":
    case "RGBX":
      return [0, 1, 2, 4];
    case "ARGB":
    case "XRGB":
      return [1, 2, 3, 4];
    case "ABGR":
    case "XBGR":
      return [3, 2, 1, 4];
    case "RGB":
      return [0, 1, 2, 3];
    case "BGR":
      return [2, 1, 0, 3];
    default:
      throw new Error(`Unsupported pixel format: ${pixelFormat}`);
  }
}

function resolveRgbIndices(
  pixelFormat: RawPixelFormat,
  bytesPerPixel: number,
): [number, number, number, number] {
  if (pixelFormat !== "unknown") {
    return rgbIndices(pixelFormat);
  }

  if (bytesPerPixel === 4) {
    console.warn(
      "[MediaSAM] Nitro Image returned unknown pixel format, assuming BGRA.",
    );
    return rgbIndices("BGRA");
  }

  if (bytesPerPixel === 3) {
    console.warn(
      "[MediaSAM] Nitro Image returned unknown pixel format, assuming RGB.",
    );
    return rgbIndices("RGB");
  }

  throw new Error(
    `Unsupported pixel format: ${pixelFormat} (${bytesPerPixel} bytes/pixel)`,
  );
}

// Nitro's resize target is in points, so on a @Nx display the raw pixel buffer
// comes back N times larger than requested (e.g. 3072x3072 for a 1024 request on
// @3x). Packing that oversized buffer straight into a fixed [1,S,S,3] tensor feeds
// the model a sheared crop of garbage. Resample from the ACTUAL raw dimensions
// down to exactly targetWidth x targetHeight (nearest-neighbor) so the tensor is
// always the size the model expects, whatever the device pixel ratio.
function rawPixelsToRgbFloatDataResampled(
  raw: RawPixelDataLike,
  targetWidth: number,
  targetHeight: number,
  // Multiplier applied to each channel byte. The AI Hub MobileSAM encoder is
  // exported with value_range=(0,1) (pixel_mean/std are pre-divided by 255 in
  // MobileSAMLoader._patch_mobilesam_for_qnn_comatibility), so it needs 1/255.
  // YOLOX keeps the default 1 (raw 0-255), which is its proven working range.
  pixelScale = 1,
): Float32Array {
  const bytes = new Uint8Array(raw.buffer);
  const sourceWidth = raw.width;
  const sourceHeight = raw.height;
  const pixelCount = sourceWidth * sourceHeight;
  const bytesPerPixel = pixelCount > 0 ? bytes.length / pixelCount : 0;
  const [redIndex, greenIndex, blueIndex, stride] = resolveRgbIndices(
    raw.pixelFormat as RawPixelFormat,
    bytesPerPixel,
  );
  const output = new Float32Array(targetWidth * targetHeight * 3);

  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceY = Math.min(
      sourceHeight - 1,
      Math.floor(((targetY + 0.5) * sourceHeight) / targetHeight),
    );
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.floor(((targetX + 0.5) * sourceWidth) / targetWidth),
      );
      const sourceIndex = (sourceY * sourceWidth + sourceX) * stride;
      const targetIndex = (targetY * targetWidth + targetX) * 3;
      output[targetIndex] = (bytes[sourceIndex + redIndex] ?? 0) * pixelScale;
      output[targetIndex + 1] =
        (bytes[sourceIndex + greenIndex] ?? 0) * pixelScale;
      output[targetIndex + 2] =
        (bytes[sourceIndex + blueIndex] ?? 0) * pixelScale;
    }
  }

  return output;
}

function createYoloXGrid(width: number, height: number): GridCoordinate[] {
  const key = width * 10000 + height;
  if (yoloxGridCache[key]) {
    return yoloxGridCache[key]!;
  }

  const coords: GridCoordinate[] = [];
  for (const stride of YOLOX_STRIDES) {
    const gridHeight = Math.floor(height / stride);
    const gridWidth = Math.floor(width / stride);
    for (let y = 0; y < gridHeight; y += 1) {
      for (let x = 0; x < gridWidth; x += 1) {
        coords.push({ x, y, stride });
      }
    }
  }

  yoloxGridCache[key] = coords;
  return coords;
}

function calcInterArea(a: Detection, b: Detection): number {
  const x = Math.max(a.x1, b.x1);
  const y = Math.max(a.y1, b.y1);
  const width = Math.min(a.x2, b.x2) - x;
  const height = Math.min(a.y2, b.y2) - y;
  if (width < 0 || height < 0) return 0;
  return width * height;
}

function calcUnionArea(a: Detection, b: Detection): number {
  const x = Math.min(a.x1, b.x1);
  const y = Math.min(a.y1, b.y1);
  const width = Math.max(a.x2, b.x2) - x;
  const height = Math.max(a.y2, b.y2) - y;
  return width * height;
}

function generateBoundingBoxProposals(
  modelOutput: Float32Array,
  gridCoords: GridCoordinate[],
  numClasses: number,
  confidenceThreshold: number,
  netSize: number,
): Detection[] {
  const proposalLength = numClasses + YOLOX_NUM_BBOX_FIELDS;
  const proposals: Detection[] = [];

  for (let anchorIndex = 0; anchorIndex < gridCoords.length; anchorIndex += 1) {
    const grid = gridCoords[anchorIndex]!;
    const startIndex = anchorIndex * proposalLength;

    const centerX = (modelOutput[startIndex]! + grid.x) * grid.stride;
    const centerY = (modelOutput[startIndex + 1]! + grid.y) * grid.stride;
    const width = Math.exp(modelOutput[startIndex + 2]!) * grid.stride;
    const height = Math.exp(modelOutput[startIndex + 3]!) * grid.stride;

    const rawObjectness = modelOutput[startIndex + 4]!;
    const boxObjectness =
      rawObjectness > 0
        ? 1.0 / (1.0 + Math.exp(-rawObjectness))
        : Math.exp(rawObjectness) / (1.0 + Math.exp(rawObjectness));

    if (boxObjectness < 0.15) continue;
    if (proposals.length >= 50 && boxObjectness < 0.3) continue;

    let bestProb = 0;
    let bestClassIndex = 0;
    for (let classIndex = 0; classIndex < numClasses; classIndex += 1) {
      const rawClassScore =
        modelOutput[startIndex + YOLOX_NUM_BBOX_FIELDS + classIndex]!;
      const boxClassScore =
        rawClassScore > 0
          ? 1.0 / (1.0 + Math.exp(-rawClassScore))
          : Math.exp(rawClassScore) / (1.0 + Math.exp(rawClassScore));
      const boxProb = boxObjectness * boxClassScore;
      if (boxProb > bestProb) {
        bestProb = boxProb;
        bestClassIndex = classIndex;
      }
    }

    const bestClassScore = bestProb / boxObjectness;
    if (bestClassScore < 0.4) continue;
    if (bestProb < 0.25) continue;
    if (bestProb <= confidenceThreshold) continue;

    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const x1 = (centerX - halfWidth) / netSize;
    const y1 = (centerY - halfHeight) / netSize;
    const x2 = (centerX + halfWidth) / netSize;
    const y2 = (centerY + halfHeight) / netSize;

    if (x1 < 0 || y1 < 0 || x2 > 1 || y2 > 1) continue;
    if (x2 - x1 < 0.015 || y2 - y1 < 0.015) continue;
    if (x2 - x1 > 0.9 || y2 - y1 > 0.9) continue;
    if (proposals.length >= 100) break;

    proposals.push({
      x1,
      y1,
      x2,
      y2,
      score: bestProb,
      classId: bestClassIndex,
    });
  }

  proposals.sort((a, b) => b.score - a.score);
  return proposals;
}

function postprocessYoloX(
  tensor: Float32Array,
  width: number,
  height: number,
  numClasses: number,
  confThr: number,
  nmsThr: number,
): Detection[] {
  const proposals = generateBoundingBoxProposals(
    tensor,
    createYoloXGrid(width, height),
    numClasses,
    confThr,
    width,
  );
  const picked: Detection[] = [];

  for (const proposal of proposals) {
    let keep = true;
    for (const candidate of picked) {
      const interArea = calcInterArea(proposal, candidate);
      if (interArea > 0) {
        const unionArea = calcUnionArea(proposal, candidate);
        if (interArea / unionArea > nmsThr) {
          keep = false;
          break;
        }
      }
    }

    if (keep) {
      picked.push(proposal);
    }
  }

  return picked.slice(0, 20);
}

function cropToCover(
  image: NitroImage,
  targetWidth: number,
  targetHeight: number,
): NitroImage {
  const sourceAspect = image.width / image.height;
  const targetAspect = targetWidth / targetHeight;

  if (Math.abs(sourceAspect - targetAspect) < 0.0001) {
    return image.resize(targetWidth, targetHeight);
  }

  if (sourceAspect > targetAspect) {
    const cropWidth = image.height * targetAspect;
    const offsetX = (image.width - cropWidth) / 2;
    return image
      .crop(offsetX, 0, offsetX + cropWidth, image.height)
      .resize(targetWidth, targetHeight);
  }

  const cropHeight = image.width / targetAspect;
  const offsetY = (image.height - cropHeight) / 2;
  return image
    .crop(0, offsetY, image.width, offsetY + cropHeight)
    .resize(targetWidth, targetHeight);
}

function getCoverCropRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): { x: number; y: number; width: number; height: number } {
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;

  if (Math.abs(sourceAspect - targetAspect) < 0.0001) {
    return {
      x: 0,
      y: 0,
      width: sourceWidth,
      height: sourceHeight,
    };
  }

  if (sourceAspect > targetAspect) {
    const width = sourceHeight * targetAspect;
    return {
      x: (sourceWidth - width) / 2,
      y: 0,
      width,
      height: sourceHeight,
    };
  }

  const height = sourceWidth / targetAspect;
  return {
    x: 0,
    y: (sourceHeight - height) / 2,
    width: sourceWidth,
    height,
  };
}

function mapDetectionFromCropToOriginal(
  detection: Detection,
  cropRect: { x: number; y: number; width: number; height: number },
  originalWidth: number,
  originalHeight: number,
): Detection {
  const x1 = (cropRect.x + detection.x1 * cropRect.width) / originalWidth;
  const y1 = (cropRect.y + detection.y1 * cropRect.height) / originalHeight;
  const x2 = (cropRect.x + detection.x2 * cropRect.width) / originalWidth;
  const y2 = (cropRect.y + detection.y2 * cropRect.height) / originalHeight;

  return {
    ...detection,
    x1: clamp(x1, 0, 1),
    y1: clamp(y1, 0, 1),
    x2: clamp(x2, 0, 1),
    y2: clamp(y2, 0, 1),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function resizeForSamEncoder(
  image: NitroImage,
): Promise<{ image: NitroImage; context: SamEncoderContext }> {
  const encoderWidth = SAM_ENCODER_SIZE;
  const encoderHeight = SAM_ENCODER_SIZE;
  const resized = await image.resizeAsync(encoderWidth, encoderHeight);

  return {
    image: resized,
    context: {
      originalWidth: image.width,
      originalHeight: image.height,
      encoderWidth,
      encoderHeight,
    },
  };
}

export function detectPoopInPhoto(
  model: TensorflowModel,
  image: NitroImage,
  {
    inputSize = 416,
    numClasses = 1,
    confThr = 0.4,
    nmsThr = 0.45,
  }: {
    inputSize?: number;
    numClasses?: number;
    confThr?: number;
    nmsThr?: number;
  } = {},
): Detection[] {
  const cropRect = getCoverCropRect(
    image.width,
    image.height,
    inputSize,
    inputSize,
  );
  const resized = cropToCover(image, inputSize, inputSize);
  const inputData = rawPixelsToRgbFloatDataResampled(
    resized.toRawPixelData() as RawPixelDataLike,
    inputSize,
    inputSize,
  );
  const output = model.runSync([toExactArrayBuffer(inputData)]);
  const tensor = new Float32Array(output[0]!);
  return postprocessYoloX(
    tensor,
    inputSize,
    inputSize,
    numClasses,
    confThr,
    nmsThr,
  ).map((detection) =>
    mapDetectionFromCropToOriginal(
      detection,
      cropRect,
      image.width,
      image.height,
    ),
  );
}

async function runModelAsync(
  model: TensorflowModel,
  inputs: ArrayBuffer[],
  operation: string,
): Promise<ArrayBuffer[]> {
  const startTime = measureStart();
  const inputBytes = inputs.map((input) => input.byteLength);

  logMediaSam(`${operation} start`, {
    inputCount: inputs.length,
    inputBytes,
    inputs: model.inputs.map((tensor) => ({
      name: tensor.name,
      shape: tensor.shape,
      dataType: tensor.dataType,
    })),
  });

  try {
    const result = await Promise.race<ArrayBuffer[]>([
      model.run(inputs),
      new Promise<ArrayBuffer[]>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `${operation} timed out after ${SAM_MODEL_TIMEOUT_MS}ms.`,
              ),
            ),
          SAM_MODEL_TIMEOUT_MS,
        );
      }),
    ]);

    logMediaSam(`${operation} complete`, {
      elapsedMs: elapsedMs(startTime),
      outputCount: result.length,
      outputBytes: result.map((output) => output.byteLength),
      outputs: model.outputs.map((tensor) => ({
        name: tensor.name,
        shape: tensor.shape,
        dataType: tensor.dataType,
      })),
    });

    return result;
  } catch (error) {
    logMediaSamError(`${operation} failed`, error, {
      elapsedMs: elapsedMs(startTime),
      inputCount: inputs.length,
      inputBytes,
      model: modelToString(model),
    });
    throw error;
  }
}

async function reportSamProgress(
  onProgress: SamProgressCallback | undefined,
  message: string,
): Promise<void> {
  if (!onProgress) {
    return;
  }
  await onProgress(message);
}

export async function encodePhotoForSam(
  model: TensorflowModel,
  image: NitroImage,
  onProgress?: SamProgressCallback,
): Promise<{
  embeddings: SamEmbeddings;
  context: SamEncoderContext;
}> {
  const startTime = measureStart();
  logMediaSam("Encoder pipeline begin", {
    imageWidth: image.width,
    imageHeight: image.height,
  });

  await reportSamProgress(onProgress, "Resizing MobileSAM input...");
  const resizeStart = measureStart();
  const { image: resized, context } = await resizeForSamEncoder(image);
  logMediaSam("Encoder resize complete", {
    elapsedMs: elapsedMs(resizeStart),
    resizedWidth: resized.width,
    resizedHeight: resized.height,
    context,
  });

  await reportSamProgress(onProgress, "Reading MobileSAM pixels...");
  const readPixelsStart = measureStart();
  const rawPixels = await resized.toRawPixelDataAsync();
  logMediaSam("Encoder raw pixels ready", {
    elapsedMs: elapsedMs(readPixelsStart),
    rawWidth: rawPixels.width,
    rawHeight: rawPixels.height,
    pixelFormat: rawPixels.pixelFormat,
    byteLength: rawPixels.buffer.byteLength,
  });

  await reportSamProgress(onProgress, "Packing MobileSAM encoder tensor...");
  const packStart = measureStart();
  const inputData = rawPixelsToRgbFloatDataResampled(
    rawPixels as RawPixelDataLike,
    SAM_ENCODER_SIZE,
    SAM_ENCODER_SIZE,
    1 / 255,
  );
  logMediaSam("Encoder tensor packed", {
    elapsedMs: elapsedMs(packStart),
    rawWidth: rawPixels.width,
    rawHeight: rawPixels.height,
    inputLength: inputData.length,
    inputBytes: inputData.byteLength,
    expectedLength: SAM_ENCODER_SIZE * SAM_ENCODER_SIZE * 3,
  });

  await reportSamProgress(onProgress, "Running MobileSAM encoder...");
  const output = await runModelAsync(
    model,
    [toExactArrayBuffer(inputData)],
    "MobileSAM encoder",
  );

  logMediaSam("Encoder pipeline complete", {
    elapsedMs: elapsedMs(startTime),
    embeddingLength:
      output[0]?.byteLength != null
        ? output[0]!.byteLength / Float32Array.BYTES_PER_ELEMENT
        : 0,
  });

  return {
    embeddings: output[0]!,
    context,
  };
}

function selectMaskSlice(outputs: Float32Array[]): {
  logits: Float32Array;
  score: number;
} {
  const maskTensor = outputs.find(
    (candidate) => candidate.length >= SAM_MASK_SIZE * SAM_MASK_SIZE,
  );
  const scoreTensor = outputs.find(
    (candidate) => candidate.length > 0 && candidate.length <= 16,
  );

  if (!maskTensor) {
    throw new Error("MobileSAM decoder did not return a mask tensor.");
  }

  const maskCount = Math.max(
    1,
    Math.floor(maskTensor.length / (SAM_MASK_SIZE * SAM_MASK_SIZE)),
  );
  if (maskCount === 1) {
    const score = scoreTensor?.[0] ?? 0;
    return {
      logits: maskTensor.slice(0, SAM_MASK_SIZE * SAM_MASK_SIZE),
      score,
    };
  }

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < maskCount; index += 1) {
    const candidateScore = scoreTensor?.[index] ?? 0;
    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      bestIndex = index;
    }
  }

  const sliceStart = bestIndex * SAM_MASK_SIZE * SAM_MASK_SIZE;
  return {
    logits: maskTensor.slice(
      sliceStart,
      sliceStart + SAM_MASK_SIZE * SAM_MASK_SIZE,
    ),
    score: Number.isFinite(bestScore) ? bestScore : 0,
  };
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function toBinaryMask(logits: Float32Array, threshold: number): Uint8Array {
  const binary = new Uint8Array(logits.length);
  for (let index = 0; index < logits.length; index += 1) {
    binary[index] = sigmoid(logits[index]!) >= threshold ? 1 : 0;
  }
  return binary;
}

// Diagnostic: is the decoder emitting raw logits (mix of +/-) or already-sigmoided
// probabilities (all in [0,1])? If min >= 0 the values are probabilities and the
// extra sigmoid() in toBinaryMask marks nearly every pixel as foreground.
function summarizeMaskValues(values: Float32Array): {
  min: number;
  max: number;
  mean: number;
  fractionAboveZero: number;
  fractionInUnitRange: number;
} {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let aboveZero = 0;
  let inUnitRange = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
    if (value >= 0) aboveZero += 1;
    if (value >= 0 && value <= 1) inUnitRange += 1;
  }
  const count = values.length || 1;
  return {
    min,
    max,
    mean: sum / count,
    fractionAboveZero: aboveZero / count,
    fractionInUnitRange: inUnitRange / count,
  };
}

function pointKey(x: number, y: number): string {
  return `${x.toFixed(2)},${y.toFixed(2)}`;
}

function polygonArea(points: Array<{ x: number; y: number }>): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area * 0.5;
}

function buildContourFromSegments(
  segments: Array<[{ x: number; y: number }, { x: number; y: number }]>,
): Array<Array<{ x: number; y: number }>> {
  const adjacency = new Map<string, number[]>();
  for (let index = 0; index < segments.length; index += 1) {
    const [start, end] = segments[index]!;
    const startKey = pointKey(start.x, start.y);
    const endKey = pointKey(end.x, end.y);
    adjacency.set(startKey, [...(adjacency.get(startKey) ?? []), index]);
    adjacency.set(endKey, [...(adjacency.get(endKey) ?? []), index]);
  }

  const remaining = new Set(segments.map((_, index) => index));
  const contours: Array<Array<{ x: number; y: number }>> = [];

  while (remaining.size > 0) {
    const seed = remaining.values().next().value as number;
    remaining.delete(seed);
    const [seedStart, seedEnd] = segments[seed]!;
    const contour = [seedStart, seedEnd];
    let previous = seedStart;
    let current = seedEnd;

    while (true) {
      const currentKey = pointKey(current.x, current.y);
      const connected = adjacency.get(currentKey) ?? [];
      const nextSegmentIndex = connected.find((candidate) =>
        remaining.has(candidate),
      );
      if (nextSegmentIndex == null) {
        break;
      }

      remaining.delete(nextSegmentIndex);
      const [segmentStart, segmentEnd] = segments[nextSegmentIndex]!;
      const next =
        pointKey(segmentStart.x, segmentStart.y) === currentKey
          ? segmentEnd
          : segmentStart;

      if (pointKey(next.x, next.y) === pointKey(previous.x, previous.y)) {
        const alternative = connected.find(
          (candidate) =>
            remaining.has(candidate) && candidate !== nextSegmentIndex,
        );
        if (alternative == null) {
          break;
        }
        remaining.delete(alternative);
        const [altStart, altEnd] = segments[alternative]!;
        const altNext =
          pointKey(altStart.x, altStart.y) === currentKey ? altEnd : altStart;
        contour.push(altNext);
        previous = current;
        current = altNext;
      } else {
        contour.push(next);
        previous = current;
        current = next;
      }

      if (
        pointKey(current.x, current.y) === pointKey(seedStart.x, seedStart.y)
      ) {
        break;
      }
    }

    if (contour.length >= 3) {
      contours.push(contour);
    }
  }

  return contours;
}

function marchingSquaresContour(
  binaryMask: Uint8Array,
  width: number,
  height: number,
): Array<{ x: number; y: number }> {
  const segments: Array<[{ x: number; y: number }, { x: number; y: number }]> =
    [];
  const lookup: Record<number, Array<[number, number]>> = {
    0: [],
    1: [[3, 2]],
    2: [[2, 1]],
    3: [[3, 1]],
    4: [[0, 1]],
    5: [
      [0, 3],
      [1, 2],
    ],
    6: [[0, 2]],
    7: [[0, 3]],
    8: [[0, 3]],
    9: [[0, 2]],
    10: [
      [0, 1],
      [2, 3],
    ],
    11: [[0, 1]],
    12: [[3, 1]],
    13: [[2, 1]],
    14: [[3, 2]],
    15: [],
  };

  const edgePoint = (edge: number, x: number, y: number) => {
    switch (edge) {
      case 0:
        return { x: x + 0.5, y };
      case 1:
        return { x: x + 1, y: y + 0.5 };
      case 2:
        return { x: x + 0.5, y: y + 1 };
      case 3:
        return { x, y: y + 0.5 };
      default:
        return { x, y };
    }
  };

  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const topLeft = binaryMask[y * width + x] ?? 0;
      const topRight = binaryMask[y * width + x + 1] ?? 0;
      const bottomRight = binaryMask[(y + 1) * width + x + 1] ?? 0;
      const bottomLeft = binaryMask[(y + 1) * width + x] ?? 0;
      const caseIndex =
        topLeft * 8 + topRight * 4 + bottomRight * 2 + bottomLeft;
      const edges = lookup[caseIndex] ?? [];

      for (const [startEdge, endEdge] of edges) {
        segments.push([edgePoint(startEdge, x, y), edgePoint(endEdge, x, y)]);
      }
    }
  }

  if (segments.length === 0) {
    return [];
  }

  const contours = buildContourFromSegments(segments);
  if (contours.length === 0) {
    return [];
  }

  let largestContour = contours[0]!;
  let largestArea = Math.abs(polygonArea(largestContour));
  for (const contour of contours.slice(1)) {
    const area = Math.abs(polygonArea(contour));
    if (area > largestArea) {
      largestArea = area;
      largestContour = contour;
    }
  }

  return largestContour;
}

function perpendicularDistance(
  point: { x: number; y: number },
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number },
): number {
  const numerator = Math.abs(
    (lineEnd.y - lineStart.y) * point.x -
      (lineEnd.x - lineStart.x) * point.y +
      lineEnd.x * lineStart.y -
      lineEnd.y * lineStart.x,
  );
  const denominator = Math.hypot(
    lineEnd.y - lineStart.y,
    lineEnd.x - lineStart.x,
  );
  return denominator === 0 ? 0 : numerator / denominator;
}

function simplifyPolygon(
  points: Array<{ x: number; y: number }>,
  tolerance: number,
): Array<{ x: number; y: number }> {
  if (points.length <= 3) {
    return points;
  }

  let maxDistance = 0;
  let index = 0;
  const lastPoint = points[points.length - 1]!;

  for (
    let currentIndex = 1;
    currentIndex < points.length - 1;
    currentIndex += 1
  ) {
    const distance = perpendicularDistance(
      points[currentIndex]!,
      points[0]!,
      lastPoint,
    );
    if (distance > maxDistance) {
      index = currentIndex;
      maxDistance = distance;
    }
  }

  if (maxDistance <= tolerance) {
    return [points[0]!, lastPoint];
  }

  const left = simplifyPolygon(points.slice(0, index + 1), tolerance);
  const right = simplifyPolygon(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function maskToPolygon(
  binaryMask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  originalWidth: number,
  originalHeight: number,
): Array<{ x: number; y: number }> {
  const contour = marchingSquaresContour(binaryMask, maskWidth, maskHeight);
  if (contour.length === 0) {
    return [];
  }

  const simplified = simplifyPolygon(contour, 1.5);
  return simplified.map((point) => ({
    x: Math.round((point.x / maskWidth) * originalWidth),
    y: Math.round((point.y / maskHeight) * originalHeight),
  }));
}

export function getInitialSamPoint(detections: Detection[]): SamPoint {
  if (detections.length > 0) {
    const detection = detections[0]!;
    return {
      x: (detection.x1 + detection.x2) * 0.5,
      y: (detection.y1 + detection.y2) * 0.5,
      label: 1,
    };
  }

  return { x: 0.5, y: 0.5, label: 1 };
}

function tensorElementCount(shape: number[]): number | null {
  if (shape.length === 0) {
    return null;
  }

  let product = 1;
  for (const dimension of shape) {
    if (dimension <= 0) {
      return null;
    }
    product *= dimension;
  }
  return product;
}

function getPromptCapacity(model: TensorflowModel): number | null {
  const coordsTensor = model.inputs[1];
  const labelsTensor = model.inputs[2];
  if (!coordsTensor || !labelsTensor) {
    return null;
  }

  const coordsElementCount = tensorElementCount(coordsTensor.shape);
  const labelsElementCount = tensorElementCount(labelsTensor.shape);

  const coordsCapacity =
    coordsElementCount != null ? Math.floor(coordsElementCount / 2) : null;

  if (coordsCapacity != null && labelsElementCount != null) {
    return Math.min(coordsCapacity, labelsElementCount);
  }

  return coordsCapacity ?? labelsElementCount;
}

type LiteSamCoordinateMode = "normalized" | "encoder-space";

function buildLiteSamPromptInputs(
  model: TensorflowModel,
  points: SamPoint[],
  context: SamEncoderContext,
  coordinateMode: LiteSamCoordinateMode,
): { pointCoords: Float32Array; pointLabels: Float32Array } {
  const promptCapacity = getPromptCapacity(model) ?? 2;
  const effectiveCapacity = Math.max(1, promptCapacity);
  const effectivePoints = points.slice(-effectiveCapacity);
  const pointCoords = new Float32Array(effectiveCapacity * 2);
  // Unused prompt slots must be label -1 ("not a point" in SAM's prompt
  // encoder). Label 0 would be an ACTIVE background point at the top-left
  // corner, dragging every mask toward it.
  const pointLabels = new Float32Array(effectiveCapacity).fill(-1);

  effectivePoints.forEach((point, index) => {
    pointCoords[index * 2] =
      coordinateMode === "encoder-space" ? point.x * context.encoderWidth : point.x;
    pointCoords[index * 2 + 1] =
      coordinateMode === "encoder-space" ? point.y * context.encoderHeight : point.y;
    pointLabels[index] = point.label;
  });

  return { pointCoords, pointLabels };
}

function countMaskForegroundPixels(binaryMask: Uint8Array): number {
  let foregroundCount = 0;
  for (let index = 0; index < binaryMask.length; index += 1) {
    foregroundCount += binaryMask[index] ?? 0;
  }
  return foregroundCount;
}

export async function decodeSamMask(
  model: TensorflowModel,
  embeddings: SamEmbeddings,
  context: SamEncoderContext,
  points: SamPoint[],
  threshold = 0.5,
): Promise<SamDecodeResult> {
  const startTime = measureStart();
  if (points.length === 0) {
    throw new Error("MobileSAM decode requires at least one point.");
  }

  logMediaSam("Decoder pipeline begin", {
    decoderInputCount: model.inputs.length,
    pointCount: points.length,
    points,
    embeddingBytes: embeddings.byteLength,
    context,
    threshold,
  });

  if (model.inputs.length === 3) {
    // This MobileSAM decoder (point_coords[1,2,2]) is the standard SAM export:
    // it expects point coords in the 1024x1024 ENCODER pixel frame, not
    // normalized [0,1]. Feeding [0.5,0.5] reads as a top-left corner prompt and
    // the model returns an all-foreground mask (min logit > 0). Scale by 1024.
    const { pointCoords, pointLabels } = buildLiteSamPromptInputs(
      model,
      points,
      context,
      "encoder-space",
    );

    logMediaSam("Decoder using 3-input path", {
      coordinateMode: "encoder-space",
      pointCoordsLength: pointCoords.length,
      pointLabelsLength: pointLabels.length,
      pointCoords: Array.from(pointCoords),
      pointLabels: Array.from(pointLabels),
    });

    const rawOutputs = await runModelAsync(
      model,
      [
        toExactArrayBuffer(embeddings),
        toExactArrayBuffer(pointCoords),
        toExactArrayBuffer(pointLabels),
      ],
      "MobileSAM decoder",
    );

    const outputs = rawOutputs.map((output) => new Float32Array(output!));
    const { logits, score } = selectMaskSlice(outputs);
    logMediaSam("Decoder raw mask stats (3-input)", {
      outputLengths: outputs.map((output) => output.length),
      ...summarizeMaskValues(logits),
      score,
    });
    const binaryMask = toBinaryMask(logits, threshold);
    const polygon = maskToPolygon(
      binaryMask,
      SAM_MASK_SIZE,
      SAM_MASK_SIZE,
      context.originalWidth,
      context.originalHeight,
    );
    const foregroundPixels = countMaskForegroundPixels(binaryMask);

    logMediaSam("Decoder pipeline complete", {
      elapsedMs: elapsedMs(startTime),
      path: "3-input",
      coordinateMode: "encoder-space",
      outputLengths: outputs.map((output) => output.length),
      score,
      polygonPoints: polygon.length,
      maskPixels: binaryMask.length,
      foregroundPixels,
    });

    return {
      binaryMask,
      maskWidth: SAM_MASK_SIZE,
      maskHeight: SAM_MASK_SIZE,
      polygon,
      score,
    };
  }

  if (model.inputs.length !== 6) {
    throw new Error(
      `Unsupported SAM decoder signature: expected 3 or 6 inputs, got ${model.inputs.length}.`,
    );
  }

  const paddedPointCount = points.length + 1;
  const pointCoords = new Float32Array(paddedPointCount * 2);
  const pointLabels = new Float32Array(paddedPointCount);

  points.forEach((point, index) => {
    pointCoords[index * 2] = point.x * context.encoderWidth;
    pointCoords[index * 2 + 1] = point.y * context.encoderHeight;
    pointLabels[index] = point.label;
  });

  const dummyIndex = points.length;
  pointCoords[dummyIndex * 2] = 0;
  pointCoords[dummyIndex * 2 + 1] = 0;
  pointLabels[dummyIndex] = -1;

  const maskInput = new Float32Array(SAM_MASK_SIZE * SAM_MASK_SIZE);
  const hasMaskInput = new Float32Array([0]);
  const originalImageSize = new Float32Array([
    context.originalHeight,
    context.originalWidth,
  ]);

  logMediaSam("Decoder using 6-input path", {
    pointCoordsLength: pointCoords.length,
    pointLabelsLength: pointLabels.length,
    maskInputLength: maskInput.length,
    hasMaskInput: Array.from(hasMaskInput),
    originalImageSize: Array.from(originalImageSize),
  });

  const rawOutputs = await runModelAsync(
    model,
    [
      toExactArrayBuffer(embeddings),
      toExactArrayBuffer(pointCoords),
      toExactArrayBuffer(pointLabels),
      toExactArrayBuffer(maskInput),
      toExactArrayBuffer(hasMaskInput),
      toExactArrayBuffer(originalImageSize),
    ],
    "MobileSAM decoder",
  );

  const outputs = rawOutputs.map((output) => new Float32Array(output!));
  const { logits, score } = selectMaskSlice(outputs);
  const binaryMask = toBinaryMask(logits, threshold);
  const polygon = maskToPolygon(
    binaryMask,
    SAM_MASK_SIZE,
    SAM_MASK_SIZE,
    context.originalWidth,
    context.originalHeight,
  );

  logMediaSam("Decoder pipeline complete", {
    elapsedMs: elapsedMs(startTime),
    path: "6-input",
    outputLengths: outputs.map((output) => output.length),
    score,
    polygonPoints: polygon.length,
    maskPixels: binaryMask.length,
  });

  return {
    binaryMask,
    maskWidth: SAM_MASK_SIZE,
    maskHeight: SAM_MASK_SIZE,
    polygon,
    score,
  };
}
