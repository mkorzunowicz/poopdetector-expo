import { Platform } from "react-native";
import type { TensorflowModelDelegate } from "react-native-fast-tflite";
import type { SessionOptions } from "react-native-nitro-onnxruntime";

// Shared by app/(tabs)/index.tsx (which prefetches the SAM model as soon as
// it's selected, so it's already loaded/loading by the time a photo is
// captured) and app/media.tsx (which actually runs it). Both MUST compute
// the exact same delegate/options value for a given (variant, useGpu) pair,
// or the prefetch's role-scoped cache entry (ai/tfliteModelCache.ts /
// ai/onnxModelCache.ts key on JSON.stringify(options)) won't match what
// media.tsx requests, causing a pointless duplicate load instead of a cache
// hit. Pulling this into one shared module (rather than each screen
// independently computing "the same" values) makes that guarantee structural
// instead of "hopefully kept in sync by hand."
//
// GPU delegate/provider used for the detector and the SAM encoder. NOT used
// for the SAM decoder -- confirmed on-device (Android) that its GPU delegate
// silently returns an empty mask (0 polygons) instead of erroring, so the
// decoder always forces CPU regardless of this.
export const TFLITE_GPU_DELEGATES: TensorflowModelDelegate[] =
  Platform.OS === "ios"
    ? ["core-ml"]
    : Platform.OS === "android"
      ? ["android-gpu"]
      : [];

export const ONNX_GPU_PROVIDER_OPTIONS: SessionOptions | undefined =
  Platform.OS === "ios"
    ? { executionProviders: [{ name: "coreml" }] }
    : Platform.OS === "android"
      ? { executionProviders: [{ name: "nnapi" }] }
      : undefined;

export function samEncoderTfliteDelegates(
  useGpu: boolean,
): TensorflowModelDelegate[] {
  return useGpu ? TFLITE_GPU_DELEGATES : [];
}

export function samOnnxProviderOptions(
  useGpu: boolean,
): SessionOptions | undefined {
  return useGpu ? ONNX_GPU_PROVIDER_OPTIONS : undefined;
}
