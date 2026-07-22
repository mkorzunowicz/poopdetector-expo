import type { SamPreprocessing } from "./mobileSamPhoto";

/**
 * Registry of the bundled interactive-segmentation (SAM) model pairs the
 * photo screen can run. Each entry's preprocessing convention was traced to a
 * proven reference implementation -- see SamPreprocessing in mobileSamPhoto.ts.
 *
 * EdgeSAM ships in float32 and float16 flavors of the same export (weights
 * precision only -- identical I/O contract and preprocessing).
 */
export type SamVariantId =
  | "mobilesam"
  | "mobilesam-new"
  | "edgesam-f32"
  | "edgesam-f16";

export interface SamVariant {
  id: SamVariantId;
  /** Human-readable name for status UI. */
  name: string;
  /** Compact label for the camera-screen selector button. */
  shortLabel: string;
  encoderAsset: number;
  decoderAsset: number;
  preprocessing: SamPreprocessing;
}

// MobileSAM (Qualcomm AI Hub export): letterbox + [0,1] values (mean/std pre-
// divided by 255 inside that graph).
const MOBILESAM_PREPROCESSING: SamPreprocessing = {
  geometry: "letterbox",
  mean: [0, 0, 0],
  std: [255, 255, 255],
};

// MobileSAM litert-torch re-export: the Colab EncoderHWC wrapper bakes
// (x - [123.675,116.28,103.53]) / [58.395,57.12,57.375] for x in RAW [0,255],
// so RN must feed raw bytes unchanged (mean 0, std 1). Verified locally: raw
// [0,255] -> IoU 1.00, [0,1] -> 0.97 (only that high because the test scene is
// high-contrast). Same letterbox geometry (ResizeLongestSide-trained ViT).
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
    id: "mobilesam",
    name: "MobileSAM",
    shortLabel: "M-SAM",
    encoderAsset: require("../assets/mobilesam-samencoder.tflite"),
    decoderAsset: require("../assets/mobilesam-samdecoder.tflite"),
    preprocessing: MOBILESAM_PREPROCESSING,
  },
  {
    // litert-torch re-export. Local harness verdict (scratchpad): the ENCODER
    // is good (IoU 0.97 paired with the old decoder), but the DECODER export
    // is broken -- its point-prompt path is dead (identical all-foreground
    // mask regardless of tap location), so this pair produces garbage until
    // the decoder is re-exported. Its point_labels input is INT64 (handled in
    // decodeSingleLiteSamPoint). Same [0,1] letterbox preprocessing as the
    // original MobileSAM (same architecture, re-exported).
    id: "mobilesam-new",
    name: "MobileSAM (new)",
    shortLabel: "M-SAM\nnew",
    encoderAsset: require("../assets/mobilesam_encoder_new.tflite"),
    decoderAsset: require("../assets/mobilesam_decoder_new.tflite"),
    preprocessing: MOBILESAM_NEW_PREPROCESSING,
  },
  {
    id: "edgesam-f32",
    name: "EdgeSAM f32",
    shortLabel: "E-SAM\n32",
    encoderAsset: require("../assets/edge_sam_3x_encoder_float32.tflite"),
    decoderAsset: require("../assets/edge_sam_3x_decoder_static_float32.tflite"),
    preprocessing: EDGESAM_PREPROCESSING,
  },
  {
    id: "edgesam-f16",
    name: "EdgeSAM f16",
    shortLabel: "E-SAM\n16",
    encoderAsset: require("../assets/edge_sam_3x_encoder_float16.tflite"),
    decoderAsset: require("../assets/edge_sam_3x_decoder_static_float16.tflite"),
    preprocessing: EDGESAM_PREPROCESSING,
  },
];

export const DEFAULT_SAM_VARIANT_ID: SamVariantId = "mobilesam";

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
