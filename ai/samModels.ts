import type { SamPreprocessing } from "./mobileSamPhoto";

/**
 * Registry of the bundled interactive-segmentation (SAM) model pairs the
 * photo screen can run. Each entry's preprocessing convention was traced to a
 * proven reference implementation -- see SamPreprocessing in mobileSamPhoto.ts.
 *
 * Only confirmed-working pairs are listed here. Dropped: the original
 * Qualcomm AI Hub MobileSAM export (superseded by the litert-torch
 * re-export below) and the EdgeSAM TFLite re-exports (f32/f16 -- both
 * numerically broken, see ai/samModels.ts git history / memory).
 */
export type SamVariantId = "mobilesam-new" | "edgesam-onnx-nitro";

export interface SamVariant {
  id: SamVariantId;
  /** Human-readable name for status UI. */
  name: string;
  /** Compact label for the camera-screen selector button. */
  shortLabel: string;
  /**
   * Which inference engine loads encoderAsset/decoderAsset. "tflite" goes
   * through ai/tfliteModelCache.ts + ai/mobileSamPhoto.ts; "onnx-nitro" goes
   * through ai/onnxModelCache.ts + ai/samOnnxNitro.ts (react-native-nitro-
   * onnxruntime) -- runs the ONNX model directly, no TFLite re-export step,
   * with a genuine dynamic-shape multipoint decoder.
   */
  runtime: "tflite" | "onnx-nitro";
  encoderAsset: number;
  decoderAsset: number;
  preprocessing: SamPreprocessing;
}

// MobileSAM litert-torch re-export: the Colab EncoderHWC wrapper bakes
// (x - [123.675,116.28,103.53]) / [58.395,57.12,57.375] for x in RAW [0,255],
// so RN must feed raw bytes unchanged (mean 0, std 1). Verified locally: raw
// [0,255] -> IoU 1.00, [0,1] -> 0.97 (only that high because the test scene is
// high-contrast). Letterbox geometry (ResizeLongestSide-trained ViT).
const MOBILESAM_NEW_PREPROCESSING: SamPreprocessing = {
  geometry: "letterbox",
  mean: [0, 0, 0],
  std: [1, 1, 1],
};

// EdgeSAM (exported from the working C# app's ONNX models): squash resize +
// ImageNet normalization -- (byte - 255*mean)/(255*std) with the classic
// mean [0.485, 0.456, 0.406] / std [0.229, 0.224, 0.225].
const EDGESAM_PREPROCESSING: SamPreprocessing = {
  geometry: "squash",
  mean: [123.675, 116.28, 103.53],
  std: [58.395, 57.12, 57.375],
};

export const SAM_VARIANTS: SamVariant[] = [
  {
    // litert-torch re-export. Confirmed working on-device (iOS + Android).
    // Its point_labels input is INT64 (handled in decodeLiteSamPoints).
    id: "mobilesam-new",
    name: "MobileSAM (new)",
    shortLabel: "M-SAM\nnew",
    runtime: "tflite",
    encoderAsset: require("../assets/mobilesam_encoder_new.tflite"),
    decoderAsset: require("../assets/mobilesam_decoder_new.tflite"),
    preprocessing: MOBILESAM_NEW_PREPROCESSING,
  },
  {
    // Runs the ONNX model directly via react-native-nitro-onnxruntime -- no
    // TFLite re-export step. Local verification (scratchpad, onnxruntime):
    // single-point IoU 1.00, and genuine NATIVE 2-3 point multipoint (one
    // decoder call, dynamic num_points axis) correctly covers all target
    // regions jointly -- something no TFLite export here can do.
    id: "edgesam-onnx-nitro",
    name: "EdgeSAM (ONNX)",
    shortLabel: "E-SAM\nONNX",
    runtime: "onnx-nitro",
    encoderAsset: require("../assets/edge_sam_3x_encoder.onnx"),
    decoderAsset: require("../assets/edge_sam_3x_decoder.onnx"),
    preprocessing: EDGESAM_PREPROCESSING,
  },
];

export const DEFAULT_SAM_VARIANT_ID: SamVariantId = "edgesam-onnx-nitro";

export function getSamVariant(id: string | undefined | null): SamVariant {
  return (
    SAM_VARIANTS.find((variant) => variant.id === id) ??
    SAM_VARIANTS.find((variant) => variant.id === DEFAULT_SAM_VARIANT_ID)!
  );
}

export function nextSamVariantId(id: SamVariantId): SamVariantId {
  const index = SAM_VARIANTS.findIndex((variant) => variant.id === id);
  return SAM_VARIANTS[(index + 1) % SAM_VARIANTS.length]!.id;
}
