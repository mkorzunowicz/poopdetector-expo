import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { TensorflowModel } from "react-native-fast-tflite";
import { loadImage, type Image as NitroImage } from "react-native-nitro-image";

import { markModelRunEnd, markModelRunStart } from "./tfliteModelCache";
import type { Detection } from "./detectors/types";
import { modelToString, toExactArrayBuffer } from "./detectors/types";

const YOLOX_NUM_BBOX_FIELDS = 5;
const YOLOX_STRIDES = [8, 16, 32] as const;
// Exported: shared with ai/samOnnxNitro.ts, which packs the same 1024x1024 /
// 256x256 canvas for the ONNX EdgeSAM pair.
export const SAM_ENCODER_SIZE = 1024;
export const SAM_MASK_SIZE = 256;
const SAM_MODEL_TIMEOUT_MS = 15000;
// Facebook SAM's pixel_mean (0-255 scale). The Qualcomm AI Hub MobileSAM export
// pre-divides this by 255 and subtracts it inside the compiled encoder graph, so
// filling the encoder's letterbox padding with this color makes the padded region
// normalize to exactly 0 -- matching both Qualcomm's qai_hub_models SAMApp
// preprocessing AND the reference C# MobileSam implementation's aspect-preserving
// resize + pad-to-1024 approach (AspectRatioResizer.cs / MobileSamImageProcessor.cs).
export const SAM_PAD_PIXEL_RGB: readonly [number, number, number] = [
  123.675, 116.28, 103.53,
];
// Every bundled 3-input TFLite decoder (point_coords[1,N,2]) has a FIXED,
// compile-time-baked N (1 for the original MobileSAM export, 2 for the
// litert-torch re-export and EdgeSAM-via-TFLite). Confirmed via Netron AND
// runtime model.inputs introspection. Points beyond N are fanned out into
// extra decoder runs and combined client-side (see decodeSamMask). The ONNX
// EdgeSAM path (ai/samOnnxNitro.ts) has no such ceiling -- its decoder has a
// genuine dynamic num_points axis -- but reuses this same constant as a
// latency-only safety valve against a pathological number of taps. Set high
// and logs loudly if ever hit, rather than silently dropping points (a real
// bug this cap previously caused at a much lower value: a 6th positive point
// silently dropped the 1st).
export const MAX_PROMPT_POINTS_SAFETY_CAP = 24;

// Exported: shared with ai/samOnnxNitro.ts's NCHW packer.
export type RawPixelFormat =
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
  /** Original captured file path -- used as the persistence/gallery key. */
  filePath: string;
  /**
   * URI of the orientation-normalized copy actually decoded by Nitro. The
   * on-screen <Image> must render THIS (not the original path) so the display
   * and the mask share one coordinate frame on Android. See loadPhotoImage.
   */
  displayUri: string;
  width: number;
  height: number;
}

export interface SamPoint {
  x: number; // normalized 0..1 in original image space
  y: number; // normalized 0..1 in original image space
  label: 0 | 1;
}

/**
 * Per-model-family encoder preprocessing convention. Each bundled SAM export
 * was traced to a proven reference implementation:
 * - MobileSAM (Qualcomm AI Hub): letterbox (aspect-preserving, long side ->
 *   1024, pixel-mean pad), values in [0,1] -> mean 0 / std 255.
 * - EdgeSAM (exported from the working C# app's ONNX models,
 *   EdgeSamImageProcessor.cs): SQUASH resize to 1024x1024 ("stretching if
 *   needed"), ImageNet normalization (byte - mean)/std.
 */
export interface SamPreprocessing {
  geometry: "letterbox" | "squash";
  /** Per-RGB-channel: value = (byte - mean[c]) / std[c]. */
  mean: readonly [number, number, number];
  std: readonly [number, number, number];
}

export interface SamEncoderContext {
  originalWidth: number;
  originalHeight: number;
  /** Full square encoder canvas size (always SAM_ENCODER_SIZE). */
  encoderWidth: number;
  encoderHeight: number;
  /**
   * Size of the actual (non-padding) image content within the encoder canvas,
   * after an aspect-preserving resize (long side -> SAM_ENCODER_SIZE). One of
   * these equals encoderWidth/encoderHeight; the other is smaller when the
   * source image isn't square. The remaining canvas area is letterbox padding.
   */
  contentWidth: number;
  contentHeight: number;
}

export interface SamDecodeResult {
  binaryMask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  // Every significant closed contour in the mask -- possibly more than one
  // disconnected object, and/or holes nested inside an outer boundary.
  // Render as a single SVG Path with fillRule="evenodd": that rule fills by
  // nesting parity (even depth = solid, odd depth = hole) automatically, so
  // no separate outer/hole classification is needed here. See maskToPolygon.
  polygons: Array<Array<{ x: number; y: number }>>;
  score: number;
}

export type SamEmbeddings = ArrayBuffer;

// Exported: shared with ai/samOnnxNitro.ts's NCHW packer.
export type RawPixelDataLike = {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  pixelFormat: RawPixelFormat | string;
};

export type SamProgressCallback = (message: string) => void | Promise<void>;

const yoloxGridCache: Record<number, GridCoordinate[]> = {};

// Flip to true for the detailed per-step pipeline trace (tensor shapes, raw
// pixel buffers, mask stats, per-model-run start/complete, etc). Default off so
// the console shows only the concise timing summaries from logSam().
export const VERBOSE_SAM_LOGS = false;

function logMediaSam(message: string, data?: Record<string, unknown>): void {
  if (!VERBOSE_SAM_LOGS) {
    return;
  }
  if (data) {
    console.log(`[MediaSAM] ${message}`, data);
    return;
  }
  console.log(`[MediaSAM] ${message}`);
}

// Exported: shared with ai/samOnnxNitro.ts so both runtimes log identically.
// Always-on, one-line summary log (timings). Kept terse on purpose.
export function logSam(message: string, data?: Record<string, unknown>): void {
  if (data) {
    console.log(`[SAM] ${message}`, data);
    return;
  }
  console.log(`[SAM] ${message}`);
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

// Exported: shared with ai/samOnnxNitro.ts.
export function measureStart(): number {
  return Date.now();
}

export function elapsedMs(startTime: number): number {
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

  // Bake EXIF orientation into the pixels before Nitro touches the file.
  // react-native-nitro-image decodes via BitmapFactory on Android, which
  // IGNORES the EXIF orientation tag, so a tilted-capture photo comes in
  // rotated 90deg vs what expo-image (Glide, EXIF-aware) displays -- making the
  // computed mask appear rotated on screen. expo-image-manipulator decodes
  // through the EXIF-aware loader and re-encodes, so the saved copy has upright
  // pixels and no orientation tag left to misinterpret. Both platforms then
  // agree; harmless on iOS (Nitro already honors EXIF there).
  let displayUri = toFileUri(filePath);
  try {
    const normalized = await ImageManipulator.manipulate(displayUri)
      .renderAsync()
      .then((rendered) =>
        rendered.saveAsync({ format: SaveFormat.JPEG, compress: 1 }),
      );
    displayUri = normalized.uri;
  } catch (error) {
    logMediaSamError(
      "Orientation normalize failed, using original file",
      error,
    );
  }

  const image = await Promise.resolve(
    loadImage({ filePath: normalizeFilePath(displayUri) }),
  );

  logMediaSam("Photo loaded", {
    filePath,
    displayUri,
    width: image.width,
    height: image.height,
    elapsedMs: elapsedMs(startTime),
  });

  return {
    image,
    filePath,
    displayUri,
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

// Exported: shared with ai/samOnnxNitro.ts's NCHW packer.
export function resolveRgbIndices(
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

// Packs `raw` (already resized to contentWidth x contentHeight, aspect-preserving)
// into the top-left corner of a canvasSize x canvasSize canvas, normalizing
// each channel as (byte - mean) / std per `preprocessing`. Any remaining
// letterbox padding is filled with SAM's pixel-mean color so it normalizes to
// ~0 (for squash geometry content covers the whole canvas and no pad is
// written). Mirrors Qualcomm's ResizeLongestSide + pixel_mean-pad for
// MobileSAM and the C# EdgeSamImageProcessor's stretch + ImageNet
// normalization for EdgeSAM.
function packSamEncoderInput(
  raw: RawPixelDataLike,
  contentWidth: number,
  contentHeight: number,
  canvasSize: number,
  preprocessing: SamPreprocessing,
): Float32Array {
  const [meanR, meanG, meanB] = preprocessing.mean;
  const [stdR, stdG, stdB] = preprocessing.std;
  const output = new Float32Array(canvasSize * canvasSize * 3);

  if (contentWidth < canvasSize || contentHeight < canvasSize) {
    const [padByteR, padByteG, padByteB] = SAM_PAD_PIXEL_RGB;
    const padR = (padByteR - meanR) / stdR;
    const padG = (padByteG - meanG) / stdG;
    const padB = (padByteB - meanB) / stdB;
    for (let index = 0; index < output.length; index += 3) {
      output[index] = padR;
      output[index + 1] = padG;
      output[index + 2] = padB;
    }
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
      const targetIndex = (targetY * canvasSize + targetX) * 3;
      output[targetIndex] = ((bytes[sourceIndex + redIndex] ?? 0) - meanR) / stdR;
      output[targetIndex + 1] =
        ((bytes[sourceIndex + greenIndex] ?? 0) - meanG) / stdG;
      output[targetIndex + 2] =
        ((bytes[sourceIndex + blueIndex] ?? 0) - meanB) / stdB;
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

// Exported: reused as-is by ai/samOnnxNitro.ts's ONNX encode path -- this
// resize step is purely NitroImage + geometry, no TFLite coupling at all.
export async function resizeForSamEncoder(
  image: NitroImage,
  geometry: SamPreprocessing["geometry"],
): Promise<{ image: NitroImage; context: SamEncoderContext }> {
  const originalWidth = image.width;
  const originalHeight = image.height;

  let contentWidth = SAM_ENCODER_SIZE;
  let contentHeight = SAM_ENCODER_SIZE;

  if (geometry === "letterbox") {
    // Aspect-preserving resize (long side -> 1024); MobileSAM convention
    // (Qualcomm export preprocessing + C# AspectRatioResizer.cs).
    // packSamEncoderInput pads the remaining canvas area with pixel-mean.
    const longestSide = Math.max(originalWidth, originalHeight);
    const letterboxScale = longestSide > 0 ? SAM_ENCODER_SIZE / longestSide : 1;
    contentWidth = Math.max(
      1,
      Math.min(SAM_ENCODER_SIZE, Math.round(originalWidth * letterboxScale)),
    );
    contentHeight = Math.max(
      1,
      Math.min(SAM_ENCODER_SIZE, Math.round(originalHeight * letterboxScale)),
    );
  }
  // else "squash": stretch straight to 1024x1024 (EdgeSAM convention, per the
  // proven C# EdgeSamImageProcessor: "resize to 1024x1024 (stretching if
  // needed)"). Content covers the full canvas, so downstream coordinate math
  // (points scaled by contentWidth/Height, cropMaskToContent no-op) degrades
  // to a plain full-frame mapping automatically.

  const resized = await image.resizeAsync(contentWidth, contentHeight);

  return {
    image: resized,
    context: {
      originalWidth,
      originalHeight,
      encoderWidth: SAM_ENCODER_SIZE,
      encoderHeight: SAM_ENCODER_SIZE,
      contentWidth,
      contentHeight,
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

  // The timeout below only makes THIS FUNCTION give up waiting -- it can't
  // actually cancel model.run() on the native side. So track the real run
  // promise's own completion (not the race) for markModelRunEnd, otherwise a
  // timed-out-but-still-running call would look "idle" to the model cache and
  // could get disposed mid-inference (a native use-after-free).
  markModelRunStart(model);
  const runPromise = model
    .run(inputs)
    .finally(() => markModelRunEnd(model));

  try {
    const result = await Promise.race<ArrayBuffer[]>([
      runPromise,
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

// Exported: shared with ai/samOnnxNitro.ts.
export async function reportSamProgress(
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
  preprocessing: SamPreprocessing,
  onProgress?: SamProgressCallback,
): Promise<{
  embeddings: SamEmbeddings;
  context: SamEncoderContext;
}> {
  const startTime = measureStart();
  logMediaSam("Encoder pipeline begin", {
    imageWidth: image.width,
    imageHeight: image.height,
    preprocessing,
  });

  await reportSamProgress(onProgress, "Resizing SAM input...");
  const resizeStart = measureStart();
  const { image: resized, context } = await resizeForSamEncoder(
    image,
    preprocessing.geometry,
  );
  const resizeMs = elapsedMs(resizeStart);
  logMediaSam("Encoder resize complete", {
    elapsedMs: resizeMs,
    resizedWidth: resized.width,
    resizedHeight: resized.height,
    context,
  });

  await reportSamProgress(onProgress, "Reading SAM pixels...");
  const readPixelsStart = measureStart();
  const rawPixels = await resized.toRawPixelDataAsync();
  const readPixelsMs = elapsedMs(readPixelsStart);
  logMediaSam("Encoder raw pixels ready", {
    elapsedMs: readPixelsMs,
    rawWidth: rawPixels.width,
    rawHeight: rawPixels.height,
    pixelFormat: rawPixels.pixelFormat,
    byteLength: rawPixels.buffer.byteLength,
  });

  await reportSamProgress(onProgress, "Packing SAM encoder tensor...");
  const packStart = measureStart();
  const inputData = packSamEncoderInput(
    rawPixels as RawPixelDataLike,
    context.contentWidth,
    context.contentHeight,
    SAM_ENCODER_SIZE,
    preprocessing,
  );
  const packMs = elapsedMs(packStart);
  logMediaSam("Encoder tensor packed", {
    elapsedMs: packMs,
    rawWidth: rawPixels.width,
    rawHeight: rawPixels.height,
    contentWidth: context.contentWidth,
    contentHeight: context.contentHeight,
    inputLength: inputData.length,
    inputBytes: inputData.byteLength,
    expectedLength: SAM_ENCODER_SIZE * SAM_ENCODER_SIZE * 3,
  });

  await reportSamProgress(onProgress, "Running SAM encoder...");
  const inferStart = measureStart();
  const output = await runModelAsync(
    model,
    [toExactArrayBuffer(inputData)],
    "SAM encoder",
  );
  const inferMs = elapsedMs(inferStart);

  const totalMs = elapsedMs(startTime);
  logMediaSam("Encoder pipeline complete", {
    elapsedMs: totalMs,
    embeddingLength:
      output[0]?.byteLength != null
        ? output[0]!.byteLength / Float32Array.BYTES_PER_ELEMENT
        : 0,
  });
  logSam(
    `Encoded in ${totalMs}ms ` +
      `(resize ${resizeMs}, read ${readPixelsMs}, pack ${packMs}, infer ${inferMs})`,
  );

  return {
    embeddings: output[0]!,
    context,
  };
}

// Exported: reused as-is by ai/samOnnxNitro.ts -- generic over plain
// Float32Array outputs, no TFLite coupling.
export function selectMaskSlice(
  outputs: Float32Array[],
  // Declared output shapes from model.outputs, index-aligned with `outputs`.
  // Used to detect channel-last multi-mask layouts; optional for callers that
  // don't have shape metadata.
  maskShapes?: Array<number[] | undefined>,
): {
  logits: Float32Array;
  score: number;
} {
  const maskTensorIndex = outputs.findIndex(
    (candidate) => candidate.length >= SAM_MASK_SIZE * SAM_MASK_SIZE,
  );
  const maskTensor = maskTensorIndex >= 0 ? outputs[maskTensorIndex]! : null;
  const scoreTensor = outputs.find(
    (candidate) => candidate.length > 0 && candidate.length <= 16,
  );

  if (!maskTensor) {
    throw new Error("SAM decoder did not return a mask tensor.");
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

  // Multi-mask decoder (EdgeSAM: 4 candidates + 4 scores). Pick the highest
  // predicted-IoU candidate -- SAM's standard ambiguity resolution.
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < maskCount; index += 1) {
    const candidateScore = scoreTensor?.[index] ?? 0;
    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      bestIndex = index;
    }
  }

  // Layout: [1,K,256,256] stores each candidate as a contiguous 256x256
  // plane; a channel-last export ([1,256,256,K], e.g. via ai-edge-torch's
  // to_channel_last_io) interleaves the K candidates per pixel. Use the
  // declared output shape to tell them apart -- slicing an interleaved
  // tensor as planes would scramble the mask.
  const maskShape = maskShapes?.[maskTensorIndex];
  const isChannelLast =
    maskShape != null &&
    maskShape.length === 4 &&
    maskShape[3] === maskCount &&
    maskShape[1] === SAM_MASK_SIZE;

  let logits: Float32Array;
  if (isChannelLast) {
    logits = new Float32Array(SAM_MASK_SIZE * SAM_MASK_SIZE);
    for (let pixel = 0; pixel < logits.length; pixel += 1) {
      logits[pixel] = maskTensor[pixel * maskCount + bestIndex]!;
    }
  } else {
    const sliceStart = bestIndex * SAM_MASK_SIZE * SAM_MASK_SIZE;
    logits = maskTensor.slice(
      sliceStart,
      sliceStart + SAM_MASK_SIZE * SAM_MASK_SIZE,
    );
  }

  logMediaSam("Mask candidate selected", {
    maskCount,
    bestIndex,
    bestScore,
    maskShape,
    isChannelLast,
    scores: scoreTensor ? Array.from(scoreTensor) : null,
  });

  return {
    logits,
    score: Number.isFinite(bestScore) ? bestScore : 0,
  };
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

// Exported: reused as-is by ai/samOnnxNitro.ts.
export function toBinaryMask(
  logits: Float32Array,
  threshold: number,
): Uint8Array {
  const binary = new Uint8Array(logits.length);
  for (let index = 0; index < logits.length; index += 1) {
    binary[index] = sigmoid(logits[index]!) >= threshold ? 1 : 0;
  }
  return binary;
}

// Diagnostic: is the decoder emitting raw logits (mix of +/-) or already-sigmoided
// probabilities (all in [0,1])? If min >= 0 the values are probabilities and the
// extra sigmoid() in toBinaryMask marks nearly every pixel as foreground.
// Exported: reused as-is by ai/samOnnxNitro.ts.
export function summarizeMaskValues(values: Float32Array): {
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

function polygonArea(points: Array<{ x: number; y: number }>): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area * 0.5;
}

function pointKey(x: number, y: number): string {
  return `${x.toFixed(2)},${y.toFixed(2)}`;
}

// Stitches the unordered edge segments marching squares emits per-cell into
// closed loops by walking shared endpoints. Returns EVERY closed loop found
// -- both outer object boundaries and holes (a hole is topologically just
// another closed contour, nested inside an outer one; see maskToPolygon for
// how that nesting gets rendered without needing to classify them here).
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

// Exact boundary tracing (marching squares) over the mask grid. Traces the
// TRUE pixel boundary -- however concave -- with zero approximation error,
// and naturally finds every disconnected object AND every hole (a hole's
// boundary is topologically identical to any other foreground/background
// boundary, so it falls out of the same algorithm for free). This replaced
// an earlier flood-fill + convex-hull approach (ported from a working
// reference C# app) that was simpler and structurally bug-proof, but could
// only approximate shapes (no concavity, no holes, and picked a single
// "most relevant" blob rather than showing every object) -- see the
// marching-squares-saddle-case-bug memory for the full history, including
// two real bugs already found and fixed in this exact lookup table (a
// swapped ambiguous-case pairing, and missing boundary handling at the
// mask's own edge -- both fixes are preserved below).
function marchingSquaresContours(
  binaryMask: Uint8Array,
  width: number,
  height: number,
): Array<Array<{ x: number; y: number }>> {
  const segments: Array<[{ x: number; y: number }, { x: number; y: number }]> =
    [];
  const lookup: Record<number, Array<[number, number]>> = {
    0: [],
    1: [[3, 2]],
    2: [[2, 1]],
    3: [[3, 1]],
    4: [[0, 1]],
    // Ambiguous "saddle" cases (diagonal corners foreground, e.g. TR+BL for
    // case 5): each needs TWO segments, one isolating each diagonal corner
    // via its own two adjacent edges. Case 5 (TR+BL) isolates TR via
    // top+right and BL via left+bottom; case 10 (TL+BR) isolates TL via
    // top+left and BR via bottom+right.
    5: [
      [0, 1],
      [3, 2],
    ],
    6: [[0, 2]],
    7: [[0, 3]],
    8: [[0, 3]],
    9: [[0, 2]],
    10: [
      [0, 3],
      [2, 1],
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

  // Out-of-bounds pixels count as background (0). Must be an explicit bounds
  // check -- a flat-array index like binaryMask[y*width + (-1)] or
  // binaryMask[y*width + width] does NOT go out of the array's total
  // bounds for interior rows, it silently aliases into the adjacent row.
  const pixelAt = (x: number, y: number): number => {
    if (x < 0 || x >= width || y < 0 || y >= height) {
      return 0;
    }
    return binaryMask[y * width + x] ?? 0;
  };

  // Loop runs one cell beyond the mask on every side so foreground that
  // touches the mask's own edge still gets a closing boundary segment there.
  for (let y = -1; y < height; y += 1) {
    for (let x = -1; x < width; x += 1) {
      const topLeft = pixelAt(x, y);
      const topRight = pixelAt(x + 1, y);
      const bottomRight = pixelAt(x + 1, y + 1);
      const bottomLeft = pixelAt(x, y + 1);
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

  return buildContourFromSegments(segments);
}

// Below this size a contour is raw logit-threshold noise (1-2 stray
// pixels), not a real object or hole.
const MIN_CONTOUR_AREA_PIXELS = 4;

// Exported: reused as-is by ai/samOnnxNitro.ts.
export function maskToPolygon(
  binaryMask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  originalWidth: number,
  originalHeight: number,
): Array<Array<{ x: number; y: number }>> {
  const contours = marchingSquaresContours(binaryMask, maskWidth, maskHeight);
  const significant = contours.filter(
    (contour) => Math.abs(polygonArea(contour)) >= MIN_CONTOUR_AREA_PIXELS,
  );

  return significant.map((contour) =>
    contour.map((point) => ({
      x: Math.round((point.x / maskWidth) * originalWidth),
      y: Math.round((point.y / maskHeight) * originalHeight),
    })),
  );
}

// The decoder's mask covers the full encoder canvas (which includes letterbox
// padding), but only the top-left contentWidth x contentHeight (scaled to
// mask resolution) corresponds to real image content. Crop down to that
// region so downstream code (maskToPolygon, the UI's row-run renderer) can
// keep mapping mask-space directly to original-image-space via a simple
// width/height ratio, exactly as if no padding ever existed.
// Exported: reused as-is by ai/samOnnxNitro.ts.
export function cropMaskToContent(
  mask: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
  context: SamEncoderContext,
): { mask: Uint8Array; width: number; height: number } {
  const contentWidth = Math.max(
    1,
    Math.min(
      canvasWidth,
      Math.round((canvasWidth * context.contentWidth) / context.encoderWidth),
    ),
  );
  const contentHeight = Math.max(
    1,
    Math.min(
      canvasHeight,
      Math.round(
        (canvasHeight * context.contentHeight) / context.encoderHeight,
      ),
    ),
  );

  if (contentWidth === canvasWidth && contentHeight === canvasHeight) {
    return { mask, width: canvasWidth, height: canvasHeight };
  }

  const cropped = new Uint8Array(contentWidth * contentHeight);
  for (let y = 0; y < contentHeight; y += 1) {
    const sourceRow = y * canvasWidth;
    const targetRow = y * contentWidth;
    cropped.set(
      mask.subarray(sourceRow, sourceRow + contentWidth),
      targetRow,
    );
  }
  return { mask: cropped, width: contentWidth, height: contentHeight };
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

// Compiled prompt-slot count from the model itself (point_coords[1,N,2]).
// The bundled MobileSAM decoder has N=1 (single real point + internal pad),
// the litert-torch re-export and EdgeSAM have N=2 (two real points). Whatever
// N is, we must supply exactly N coord pairs / labels.
function getPromptSlots(model: TensorflowModel): number {
  const declaredSlots = model.inputs[1]?.shape?.[1];
  return declaredSlots != null && declaredSlots >= 1 ? declaredSlots : 1;
}

// Decodes a batch of up to `promptSlots` real points in ONE decoder run --
// genuine multipoint segmentation where the model supports it (SAM reasons
// about all prompt points jointly), NOT a client-side union. Unused slots are
// filled with the "not-a-point" pad (label -1). Coordinates are in the
// encoder's 1024x1024 canvas pixel frame, scaled by the content (unpadded)
// dimensions (== full canvas for squash geometry).
async function decodeLiteSamPoints(
  model: TensorflowModel,
  embeddings: SamEmbeddings,
  context: SamEncoderContext,
  points: SamPoint[],
  threshold: number,
  logLabel: string,
): Promise<{
  binaryMask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  score: number;
}> {
  const promptSlots = getPromptSlots(model);
  const packed = points.slice(0, promptSlots);

  const pointCoords = new Float32Array(promptSlots * 2);
  packed.forEach((point, index) => {
    pointCoords[index * 2] = point.x * context.contentWidth;
    pointCoords[index * 2 + 1] = point.y * context.contentHeight;
  });

  // point_labels dtype varies by export: the Qualcomm AI Hub decoder uses
  // FLOAT32, litert-torch/onnx exports emit INT64 (and some INT32). Feeding a
  // Float32Array where the model expects int64 both misreads the values AND
  // under-sizes the buffer (4 vs 8 bytes/elem), so match the declared dtype.
  // 1 = foreground, 0 = background/negative, -1 = not-a-point pad.
  const labelDataType = model.inputs[2]?.dataType;
  let pointLabels: ArrayBufferView;
  if (labelDataType === "int64") {
    const labels = new BigInt64Array(promptSlots).fill(-1n);
    packed.forEach((point, index) => (labels[index] = BigInt(point.label)));
    pointLabels = labels;
  } else if (labelDataType === "int32") {
    const labels = new Int32Array(promptSlots).fill(-1);
    packed.forEach((point, index) => (labels[index] = point.label));
    pointLabels = labels;
  } else {
    const labels = new Float32Array(promptSlots).fill(-1);
    packed.forEach((point, index) => (labels[index] = point.label));
    pointLabels = labels;
  }

  logMediaSam("Decoder using 3-input path", {
    logLabel,
    packedPoints: packed,
    labelDataType,
    pointCoords: Array.from(pointCoords),
    pointLabels: Array.from(
      pointLabels as unknown as ArrayLike<number | bigint>,
    ).map(String),
  });

  const rawOutputs = await runModelAsync(
    model,
    [
      toExactArrayBuffer(embeddings),
      toExactArrayBuffer(pointCoords),
      toExactArrayBuffer(pointLabels),
    ],
    `SAM decoder (${logLabel})`,
  );

  const outputs = rawOutputs.map((output) => new Float32Array(output!));
  const { logits, score } = selectMaskSlice(
    outputs,
    model.outputs.map((tensor) => tensor.shape),
  );
  logMediaSam("Decoder raw mask stats (3-input)", {
    logLabel,
    outputLengths: outputs.map((output) => output.length),
    ...summarizeMaskValues(logits),
    score,
  });

  const fullMask = toBinaryMask(logits, threshold);
  const { mask, width, height } = cropMaskToContent(
    fullMask,
    SAM_MASK_SIZE,
    SAM_MASK_SIZE,
    context,
  );

  return { binaryMask: mask, maskWidth: width, maskHeight: height, score };
}

function combineMasksInPlace(
  target: Uint8Array,
  source: Uint8Array,
  op: "union" | "subtract",
): void {
  for (let index = 0; index < target.length; index += 1) {
    if (op === "union") {
      if (source[index] === 1) target[index] = 1;
    } else if (source[index] === 1) {
      target[index] = 0;
    }
  }
}

// Exported: reused as-is by ai/samOnnxNitro.ts.
export function countMaskForegroundPixels(binaryMask: Uint8Array): number {
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
    const promptSlots = getPromptSlots(model);
    let positivePoints = points.filter((point) => point.label === 1);
    if (positivePoints.length > MAX_PROMPT_POINTS_SAFETY_CAP) {
      logSam(
        `WARNING: ${positivePoints.length} positive points exceeds the ` +
          `safety cap (${MAX_PROMPT_POINTS_SAFETY_CAP}); dropping the oldest ` +
          `${positivePoints.length - MAX_PROMPT_POINTS_SAFETY_CAP}.`,
      );
      positivePoints = positivePoints.slice(-MAX_PROMPT_POINTS_SAFETY_CAP);
    }

    if (positivePoints.length === 0) {
      logMediaSam("Decoder pipeline complete", {
        elapsedMs: elapsedMs(startTime),
        path: "3-input",
        reason: "no positive points",
      });
      logSam(`Decoded in ${elapsedMs(startTime)}ms (no positive points)`);
      return {
        binaryMask: new Uint8Array(SAM_MASK_SIZE * SAM_MASK_SIZE),
        maskWidth: SAM_MASK_SIZE,
        maskHeight: SAM_MASK_SIZE,
        polygons: [],
        score: 0,
      };
    }

    let combinedMask: Uint8Array;
    let maskWidth: number;
    let maskHeight: number;
    let score: number;
    let inferCalls: number;
    let mode: string;

    if (points.length <= promptSlots) {
      // Native multipoint: the model has enough slots to take every prompt
      // point at once, so SAM reasons about them jointly in a single run.
      // Points are ordered oldest-first; the decoder handles positive (label 1)
      // and negative (label 0) points together.
      const result = await decodeLiteSamPoints(
        model,
        embeddings,
        context,
        points,
        threshold,
        "native",
      );
      combinedMask = result.binaryMask;
      maskWidth = result.maskWidth;
      maskHeight = result.maskHeight;
      score = result.score;
      inferCalls = 1;
      mode = `native x${points.length}`;
    } else {
      // More points than the model has slots: fall back to combining several
      // decoder runs. Positive points are batched into promptSlots-sized
      // native chunks (verified: e.g. 2 joint positive points correctly cover
      // BOTH target regions in one call, not just the closer one) and unioned
      // together -- this uses the model's real joint reasoning for every
      // positive point, not just the first `promptSlots` of them. Negative
      // points stay single-point-at-a-time (each real point + pad): a native
      // decode with two negatives and NO positive anchor is a materially
      // different, unverified query, so we don't risk it here. Every point
      // the caller provides is processed -- none are silently dropped, unlike
      // the old fixed 5-per-label cap.
      let negativePoints = points.filter((point) => point.label === 0);
      if (negativePoints.length > MAX_PROMPT_POINTS_SAFETY_CAP) {
        logSam(
          `WARNING: ${negativePoints.length} negative points exceeds the ` +
            `safety cap (${MAX_PROMPT_POINTS_SAFETY_CAP}); dropping the oldest ` +
            `${negativePoints.length - MAX_PROMPT_POINTS_SAFETY_CAP}.`,
        );
        negativePoints = negativePoints.slice(-MAX_PROMPT_POINTS_SAFETY_CAP);
      }
      inferCalls = 0;
      mode = `batched ${positivePoints.length}+/${negativePoints.length}- (${promptSlots}/call+, 1/call-)`;

      let mask: Uint8Array | null = null;
      let width = SAM_MASK_SIZE;
      let height = SAM_MASK_SIZE;
      let scoreSum = 0;
      let positiveBatchCount = 0;

      for (
        let start = 0;
        start < positivePoints.length;
        start += promptSlots
      ) {
        const batch = positivePoints.slice(start, start + promptSlots);
        const result = await decodeLiteSamPoints(
          model,
          embeddings,
          context,
          batch,
          threshold,
          "positive-batch",
        );
        inferCalls += 1;
        positiveBatchCount += 1;
        scoreSum += result.score;
        if (mask == null) {
          mask = result.binaryMask;
          width = result.maskWidth;
          height = result.maskHeight;
        } else {
          combineMasksInPlace(mask, result.binaryMask, "union");
        }
      }
      for (const point of negativePoints) {
        const result = await decodeLiteSamPoints(
          model,
          embeddings,
          context,
          [point],
          threshold,
          "negative",
        );
        inferCalls += 1;
        combineMasksInPlace(mask!, result.binaryMask, "subtract");
      }
      combinedMask = mask!;
      maskWidth = width;
      maskHeight = height;
      score = scoreSum / Math.max(1, positiveBatchCount);
    }

    const polygons = maskToPolygon(
      combinedMask,
      maskWidth,
      maskHeight,
      context.originalWidth,
      context.originalHeight,
    );
    const foregroundPixels = countMaskForegroundPixels(combinedMask);
    const totalMs = elapsedMs(startTime);

    logMediaSam("Decoder pipeline complete", {
      elapsedMs: totalMs,
      path: "3-input",
      mode,
      score,
      polygonCount: polygons.length,
      polygonPoints: polygons.reduce((sum, polygon) => sum + polygon.length, 0),
      maskPixels: combinedMask.length,
      foregroundPixels,
    });
    logSam(
      `Decoded in ${totalMs}ms (${mode}, ${inferCalls} infer, ` +
        `score ${score.toFixed(2)}, ${polygons.length} poly)`,
    );

    return {
      binaryMask: combinedMask,
      maskWidth,
      maskHeight,
      polygons,
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
    pointCoords[index * 2] = point.x * context.contentWidth;
    pointCoords[index * 2 + 1] = point.y * context.contentHeight;
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
  const { logits, score } = selectMaskSlice(
    outputs,
    model.outputs.map((tensor) => tensor.shape),
  );
  const binaryMask = toBinaryMask(logits, threshold);
  const polygons = maskToPolygon(
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
    polygonCount: polygons.length,
    polygonPoints: polygons.reduce((sum, polygon) => sum + polygon.length, 0),
    maskPixels: binaryMask.length,
  });

  return {
    binaryMask,
    maskWidth: SAM_MASK_SIZE,
    maskHeight: SAM_MASK_SIZE,
    polygons,
    score,
  };
}
