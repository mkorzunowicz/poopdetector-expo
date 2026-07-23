import { type Detection } from "@/ai/detectors/types";
import {
  decodeSamMask,
  detectPoopInPhoto,
  encodePhotoForSam,
  getInitialSamPoint,
  loadPhotoImage,
  toFileUri,
  VERBOSE_SAM_LOGS,
  type SamEmbeddings,
  type SamPoint,
} from "@/ai/mobileSamPhoto";
import { useOnnxModelSlot } from "@/ai/onnxModelCache";
import { getSamVariant } from "@/ai/samModels";
import { decodeSamMaskOnnx, encodePhotoForSamOnnx } from "@/ai/samOnnxNitro";
import {
  useCachedTensorflowModel,
  useTensorflowModelSlot,
} from "@/ai/tfliteModelCache";
import { SAFE_AREA_PADDING } from "@/components/Constants";
import { tr } from "@/i18n/i18n";
import {
  attachPhotoSegmentationAssetId,
  getPhotoSegmentation,
  savePhotoSegmentation,
} from "@/services/photoSegmentationStore";
import { useTheme } from "@/styles/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/core";
// expo-image honors the JPEG EXIF orientation flag (which RN core <Image>
// ignores here, rendering camera photos sideways), so the displayed frame
// matches the upright orientation Nitro decodes for the encoder/mask.
import { Image } from "expo-image";
import * as MediaLibrary from "expo-media-library";
import { router, useLocalSearchParams } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GestureResponderEvent, LayoutChangeEvent } from "react-native";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { TensorflowModelDelegate } from "react-native-fast-tflite";
import type { SessionOptions } from "react-native-nitro-onnxruntime";
import Svg, { Circle, Polygon, Rect } from "react-native-svg";

const DETECTION_MODEL_ASSET = require("../assets/yolox_nano_poop_cropped_only_best_float32.tflite");

function getContainedImageRect(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; width: number; height: number } | null {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return null;
  }

  const scale = Math.min(
    containerWidth / imageWidth,
    containerHeight / imageHeight,
  );
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function logMediaSamUi(message: string, data?: Record<string, unknown>): void {
  if (!VERBOSE_SAM_LOGS) {
    return;
  }
  if (data) {
    console.log(`[MediaSAM/UI] ${message}`, data);
    return;
  }
  console.log(`[MediaSAM/UI] ${message}`);
}

// Concise "(delegate) in [dtype[shape], ...] out [dtype[shape], ...]" summary,
// e.g. "(android-gpu) in [float32[1,1024,1024,3]] out [float32[1,64,64,256]]".
function formatModelLoadInfo(model: {
  delegates: readonly string[];
  inputs: readonly { dataType: string; shape: readonly number[] }[];
  outputs: readonly { dataType: string; shape: readonly number[] }[];
}): string {
  const delegate =
    model.delegates.length > 0 ? model.delegates.join("+") : "cpu";
  const fmt = (
    tensors: readonly { dataType: string; shape: readonly number[] }[],
  ) => tensors.map((t) => `${t.dataType}[${t.shape.join(",")}]`).join(", ");
  return `(${delegate}) in [${fmt(model.inputs)}] out [${fmt(model.outputs)}]`;
}

// Same idea as formatModelLoadInfo, but for react-native-nitro-onnxruntime's
// InferenceSession -- its Tensor shape is {name, type, dims} rather than
// TFLite's {name, dataType, shape}. `providerLabel` reflects what execution
// provider was REQUESTED at session creation (not necessarily what ORT
// actually used per-op internally -- that's up to its own per-node fallback).
function formatOnnxModelLoadInfo(
  session: {
    inputNames: readonly { type: string; dims: readonly number[] }[];
    outputNames: readonly { type: string; dims: readonly number[] }[];
  },
  providerLabel: string,
): string {
  const fmt = (tensors: readonly { type: string; dims: readonly number[] }[]) =>
    tensors.map((t) => `${t.type}[${t.dims.join(",")}]`).join(", ");
  return `(${providerLabel}) in [${fmt(session.inputNames)}] out [${fmt(session.outputNames)}]`;
}

// Always-on one-line summary (model load / bootstrap timings).
function logSamUi(message: string, data?: Record<string, unknown>): void {
  if (data) {
    console.log(`[SAM] ${message}`, data);
    return;
  }
  console.log(`[SAM] ${message}`);
}

function logMediaSamUiError(
  message: string,
  error: unknown,
  data?: Record<string, unknown>,
): void {
  if (data) {
    console.error(`[MediaSAM/UI] ${message}`, { ...data, error });
    return;
  }
  console.error(`[MediaSAM/UI] ${message}`, error);
}

const MediaPage: React.FC = () => {
  const { path, type, sam, detectorGpu, samGpu } = useLocalSearchParams<{
    path: string;
    type: "photo" | "video";
    sam?: string;
    detectorGpu?: string;
    samGpu?: string;
  }>();
  // Which SAM pair to run -- chosen on the camera screen before capture and
  // passed along; falls back to the default variant for older links.
  const samVariant = useMemo(() => getSamVariant(sam), [sam]);
  // URI of the orientation-normalized copy Nitro decoded; the <Image> renders
  // this once bootstrap produces it so display and mask share one frame. Until
  // then we fall back to the original path (loader covers the brief swap).
  const [displayUri, setDisplayUri] = useState<string | null>(null);
  const [hasMediaLoaded, setHasMediaLoaded] = useState(false);
  const [isScreenFocused, setIsScreenFocused] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [isDecoding, setIsDecoding] = useState(false);
  const [photoSize, setPhotoSize] = useState({ width: 0, height: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [detections, setDetections] = useState<Detection[]>([]);
  const [points, setPoints] = useState<SamPoint[]>([]);
  const [pointMode, setPointMode] = useState<0 | 1>(1);
  const [polygon, setPolygon] = useState<Array<{ x: number; y: number }>>([]);
  const [maskData, setMaskData] = useState<{
    binaryMask: Uint8Array;
    maskWidth: number;
    maskHeight: number;
  } | null>(null);
  const [maskScore, setMaskScore] = useState<number | null>(null);
  const [statusText, setStatusText] = useState<string>("Loading models...");
  const [errorText, setErrorText] = useState<string | null>(null);
  // Debug A/B: force the detector and/or the active SAM runtime (whichever
  // one -- TFLite or ONNX -- samVariant.runtime picks) onto the platform
  // GPU/NPU delegate instead of CPU. Chosen on the camera screen before
  // capture (like samVariant above), not toggled here -- both default to
  // CPU, matching the delegates this app has settled on after repeated A/B
  // testing (GPU delegates measured slower, and for ONNX CoreML even less
  // accurate, than CPU for these models -- see memory).
  const detectorUseGpu = detectorGpu === "1";
  const samUseGpu = samGpu === "1";
  const { theme } = useTheme();

  const photoRef = useRef<Awaited<ReturnType<typeof loadPhotoImage>> | null>(
    null,
  );
  const embeddingsRef = useRef<SamEmbeddings | null>(null);
  const encoderContextRef = useRef<
    Awaited<ReturnType<typeof encodePhotoForSam>>["context"] | null
  >(null);
  const detectionsRef = useRef<Detection[]>([]);
  const hasBootstrappedRef = useRef(false);
  // Approx model-load start (first render). Models load in parallel via the
  // hooks below, so each logs its own elapsed-since-mount when it goes ready.
  const loadStartRef = useRef(Date.now());

  // Platform GPU/NPU delegate ids, reused by both debug toggles below. iOS ->
  // Core ML, Android -> GPU delegate (TFLite) / NNAPI (ONNX); both fall back
  // to CPU per-unsupported-op automatically. Repeated A/B testing settled on
  // CPU as the default for both the detector and every SAM path (GPU
  // delegates measured slower, and for ONNX CoreML even less accurate, than
  // CPU -- see memory) -- these toggles exist to re-verify that per device
  // without a code change.
  const tfliteGpuDelegates = useMemo<TensorflowModelDelegate[]>(
    () =>
      Platform.OS === "ios"
        ? ["core-ml"]
        : Platform.OS === "android"
          ? ["android-gpu"]
          : [],
    [],
  );
  const onnxGpuProviderOptions = useMemo<SessionOptions | undefined>(
    () =>
      Platform.OS === "ios"
        ? { executionProviders: [{ name: "coreml" }] }
        : Platform.OS === "android"
          ? { executionProviders: [{ name: "nnapi" }] }
          : undefined,
    [],
  );

  // Cached: the camera screen (useDetectorYoloXNanoPoop) already loads this
  // exact asset with delegates=[] (CPU) AND with the GPU delegate as its own
  // two cached instances, so whichever this toggle picks is very likely
  // already a cache hit by the time a photo is captured. See
  // ai/tfliteModelCache.ts.
  const detectionModelHook = useCachedTensorflowModel(
    DETECTION_MODEL_ASSET,
    detectorUseGpu ? tfliteGpuDelegates : [],
  );
  const isOnnxRuntime = samVariant.runtime === "onnx-nitro";
  // Role-scoped: this screen fully unmounts/remounts on every photo capture,
  // and SAM models are large (tens-hundreds of MB resident). Without explicit
  // disposal, retaking a photo leaked the previous instance and eventually
  // OOM-crashed the app. useTensorflowModelSlot/useOnnxModelSlot reuse the
  // already-loaded model when the same variant is picked again, and dispose
  // the old one when switching variants, so at most one encoder + one decoder
  // are ever resident. See ai/tfliteModelCache.ts / ai/onnxModelCache.ts.
  //
  // Both TFLite and ONNX slots are called unconditionally every render (rules
  // of hooks) with `enabled` gating the actual load to whichever runtime the
  // selected variant needs.
  const samTfliteDelegates = samUseGpu ? tfliteGpuDelegates : [];
  const samEncoderTfliteHook = useTensorflowModelSlot(
    "sam-encoder",
    samVariant.encoderAsset,
    samTfliteDelegates,
    !isOnnxRuntime,
  );
  const samDecoderTfliteHook = useTensorflowModelSlot(
    "sam-decoder",
    samVariant.decoderAsset,
    samTfliteDelegates,
    !isOnnxRuntime,
  );
  const samOnnxProviderOptions = samUseGpu ? onnxGpuProviderOptions : undefined;
  const samEncoderOnnxHook = useOnnxModelSlot(
    "sam-encoder-onnx",
    samVariant.encoderAsset,
    samOnnxProviderOptions,
    isOnnxRuntime,
  );
  const samDecoderOnnxHook = useOnnxModelSlot(
    "sam-decoder-onnx",
    samVariant.decoderAsset,
    samOnnxProviderOptions,
    isOnnxRuntime,
  );

  const detectionModel =
    detectionModelHook.state === "loaded" ? detectionModelHook.model : null;
  const samEncoderModel =
    samEncoderTfliteHook.state === "loaded" ? samEncoderTfliteHook.model : null;
  const samDecoderModel =
    samDecoderTfliteHook.state === "loaded" ? samDecoderTfliteHook.model : null;
  const samEncoderModelOnnx =
    samEncoderOnnxHook.state === "loaded" ? samEncoderOnnxHook.model : null;
  const samDecoderModelOnnx =
    samDecoderOnnxHook.state === "loaded" ? samDecoderOnnxHook.model : null;
  const samEncoderReady = isOnnxRuntime
    ? samEncoderModelOnnx != null
    : samEncoderModel != null;
  const samDecoderReady = isOnnxRuntime
    ? samDecoderModelOnnx != null
    : samDecoderModel != null;

  useEffect(() => {
    if (detectionModel) {
      logSamUi(
        `detector model loaded in ${Date.now() - loadStartRef.current}ms ` +
          formatModelLoadInfo(detectionModel),
      );
    }
  }, [detectionModel]);

  useEffect(() => {
    if (samEncoderModel) {
      logSamUi(
        `${samVariant.name} encoder loaded in ${Date.now() - loadStartRef.current}ms ` +
          formatModelLoadInfo(samEncoderModel),
      );
    }
  }, [samEncoderModel, samVariant.name]);

  useEffect(() => {
    if (samDecoderModel) {
      logSamUi(
        `${samVariant.name} decoder loaded in ${Date.now() - loadStartRef.current}ms ` +
          formatModelLoadInfo(samDecoderModel),
      );
    }
  }, [samDecoderModel, samVariant.name]);

  const onnxProviderLabel = samOnnxProviderOptions?.executionProviders?.length
    ? samOnnxProviderOptions.executionProviders
        .map((provider) =>
          typeof provider === "string" ? provider : provider.name,
        )
        .join("+")
    : "onnx-cpu";

  useEffect(() => {
    if (samEncoderModelOnnx) {
      logSamUi(
        `${samVariant.name} encoder loaded in ${Date.now() - loadStartRef.current}ms ` +
          formatOnnxModelLoadInfo(samEncoderModelOnnx, onnxProviderLabel),
      );
    }
  }, [samEncoderModelOnnx, samVariant.name, onnxProviderLabel]);

  useEffect(() => {
    if (samDecoderModelOnnx) {
      logSamUi(
        `${samVariant.name} decoder loaded in ${Date.now() - loadStartRef.current}ms ` +
          formatOnnxModelLoadInfo(samDecoderModelOnnx, onnxProviderLabel),
      );
    }
  }, [samDecoderModelOnnx, samVariant.name, onnxProviderLabel]);

  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);
      return () => {
        setIsScreenFocused(false);
      };
    }, []),
  );

  useEffect(() => {
    hasBootstrappedRef.current = false;
    photoRef.current = null;
    embeddingsRef.current = null;
    encoderContextRef.current = null;
    setHasMediaLoaded(false);
    setDisplayUri(null);
    setIsBootstrapping(false);
    setIsDecoding(false);
    setPhotoSize({ width: 0, height: 0 });
    setContainerSize({ width: 0, height: 0 });
    setDetections([]);
    setPoints([]);
    setPolygon([]);
    setMaskData(null);
    setMaskScore(null);
    setStatusText("Loading models...");
    setErrorText(null);
  }, [path, type, sam, detectorUseGpu, samUseGpu]);

  // Prefer the orientation-normalized copy once bootstrap has produced it; fall
  // back to the original file until then (the loading overlay hides the swap).
  const source = useMemo(
    () => ({ uri: displayUri ?? toFileUri(path ?? "") }),
    [displayUri, path],
  );
  const imageRect = useMemo(
    () =>
      getContainedImageRect(
        containerSize.width,
        containerSize.height,
        photoSize.width,
        photoSize.height,
      ),
    [
      containerSize.height,
      containerSize.width,
      photoSize.height,
      photoSize.width,
    ],
  );
  const samEncoderErrored = isOnnxRuntime
    ? samEncoderOnnxHook.state === "error"
    : samEncoderTfliteHook.state === "error";
  const samDecoderErrored = isOnnxRuntime
    ? samDecoderOnnxHook.state === "error"
    : samDecoderTfliteHook.state === "error";
  const modelError =
    detectionModelHook.state === "error"
      ? "Failed to load poop detection model."
      : samEncoderErrored
        ? `Failed to load ${samVariant.name} encoder model.`
        : samDecoderErrored
          ? `Failed to load ${samVariant.name} decoder model.`
          : null;

  useEffect(() => {
    if (modelError != null) {
      setErrorText(modelError);
      setStatusText(modelError);
    }
  }, [modelError]);

  useEffect(() => {
    detectionsRef.current = detections;
  }, [detections]);

  const persistSegmentation = useCallback(
    async (
      nextPoints: SamPoint[],
      nextPolygon: Array<{ x: number; y: number }>,
      nextScore: number,
      nextDetections: Detection[],
    ) => {
      const photo = photoRef.current;
      if (!photo) {
        return;
      }

      await savePhotoSegmentation({
        photoPath: photo.filePath,
        updatedAt: Date.now(),
        imageWidth: photo.width,
        imageHeight: photo.height,
        score: nextScore,
        points: nextPoints,
        polygon: nextPolygon,
        detections: nextDetections,
      });
    },
    [],
  );

  const runSegmentation = useCallback(
    async (nextPoints: SamPoint[]) => {
      if (
        !samDecoderReady ||
        !embeddingsRef.current ||
        !encoderContextRef.current
      ) {
        logMediaSamUi("runSegmentation skipped", {
          hasDecoderModel: samDecoderReady,
          hasEmbeddings: embeddingsRef.current != null,
          hasEncoderContext: encoderContextRef.current != null,
        });
        return;
      }

      const startTime = Date.now();
      setIsDecoding(true);
      setErrorText(null);

      try {
        logMediaSamUi("runSegmentation begin", {
          pointCount: nextPoints.length,
          points: nextPoints,
        });

        if (nextPoints.length === 0) {
          setPolygon([]);
          setMaskData(null);
          setMaskScore(null);
          setStatusText("Mask cleared.");
          await persistSegmentation([], [], 0, detectionsRef.current);
          logMediaSamUi("runSegmentation cleared mask", {
            elapsedMs: Date.now() - startTime,
          });
          return;
        }

        setStatusText("Decoding SAM mask...");
        await yieldToUi();
        const result = isOnnxRuntime
          ? await decodeSamMaskOnnx(
              samDecoderModelOnnx!,
              embeddingsRef.current,
              encoderContextRef.current,
              nextPoints,
            )
          : await decodeSamMask(
              samDecoderModel!,
              embeddingsRef.current,
              encoderContextRef.current,
              nextPoints,
            );
        setMaskData({
          binaryMask: result.binaryMask,
          maskWidth: result.maskWidth,
          maskHeight: result.maskHeight,
        });
        setPolygon(result.polygon);
        setMaskScore(result.score);
        setStatusText(
          result.polygon.length > 2
            ? `Mask updated (${Math.round(result.score * 100)}% confidence)`
            : "Mask updated.",
        );
        await persistSegmentation(
          nextPoints,
          result.polygon,
          result.score,
          detectionsRef.current,
        );
        logMediaSamUi("runSegmentation complete", {
          elapsedMs: Date.now() - startTime,
          score: result.score,
          polygonPoints: result.polygon.length,
        });
      } catch (error) {
        logMediaSamUiError("runSegmentation failed", error, {
          elapsedMs: Date.now() - startTime,
          pointCount: nextPoints.length,
        });
        setErrorText("Failed to decode SAM mask.");
      } finally {
        setIsDecoding(false);
      }
    },
    [
      isOnnxRuntime,
      persistSegmentation,
      samDecoderModel,
      samDecoderModelOnnx,
      samDecoderReady,
    ],
  );

  useEffect(() => {
    if (
      type !== "photo" ||
      !path ||
      !hasMediaLoaded ||
      !isScreenFocused ||
      !detectionModel ||
      !samEncoderReady ||
      !samDecoderReady ||
      hasBootstrappedRef.current
    ) {
      return;
    }

    hasBootstrappedRef.current = true;
    let isCancelled = false;

    const bootstrap = async () => {
      const startTime = Date.now();
      setIsBootstrapping(true);
      setErrorText(null);

      try {
        logMediaSamUi("bootstrap begin", { path, type });
        setStatusText("Loading photo...");
        const photo = await loadPhotoImage(path);
        if (isCancelled) return;

        photoRef.current = photo;
        setDisplayUri(photo.displayUri);
        setPhotoSize({ width: photo.width, height: photo.height });

        setStatusText("Detecting poop...");
        const nextDetections = detectPoopInPhoto(detectionModel, photo.image);
        if (isCancelled) return;
        setDetections(nextDetections);
        logMediaSamUi("Photo detection complete", {
          detectionCount: nextDetections.length,
          detections: nextDetections,
          elapsedMs: Date.now() - startTime,
        });

        setStatusText(`Encoding ${samVariant.name}...`);
        await yieldToUi();
        const onEncodeProgress = async (message: string) => {
          setStatusText(message);
          await yieldToUi();
        };
        const { embeddings, context } = isOnnxRuntime
          ? await encodePhotoForSamOnnx(
              samEncoderModelOnnx!,
              photo.image,
              samVariant.preprocessing,
              onEncodeProgress,
            )
          : await encodePhotoForSam(
              samEncoderModel!,
              photo.image,
              samVariant.preprocessing,
              onEncodeProgress,
            );
        if (isCancelled) return;
        embeddingsRef.current = embeddings;
        encoderContextRef.current = context;
        logMediaSamUi("SAM encoder complete", {
          elapsedMs: Date.now() - startTime,
          embeddingBytes: embeddings.byteLength,
          context,
        });

        setStatusText("Loading saved segmentation...");
        await yieldToUi();
        const savedSegmentation = await getPhotoSegmentation(photo.filePath);
        if (isCancelled) return;
        logMediaSamUi("Saved segmentation loaded", {
          elapsedMs: Date.now() - startTime,
          found: savedSegmentation != null,
          pointCount: savedSegmentation?.points.length ?? 0,
          polygonPoints: savedSegmentation?.polygon.length ?? 0,
        });

        const seededPoints = savedSegmentation?.points.length
          ? savedSegmentation.points
          : [getInitialSamPoint(nextDetections)];

        setPoints(seededPoints);
        setStatusText("Decoding initial SAM mask...");
        await yieldToUi();
        await runSegmentation(seededPoints);
        logMediaSamUi("bootstrap complete", {
          elapsedMs: Date.now() - startTime,
          seededPointCount: seededPoints.length,
        });
        logSamUi(
          `Ready in ${Date.now() - startTime}ms ` +
            `(${nextDetections.length} detection${nextDetections.length === 1 ? "" : "s"}, ` +
            `${samVariant.name})`,
        );
      } catch (error) {
        logMediaSamUiError("bootstrap failed", error, {
          elapsedMs: Date.now() - startTime,
          path,
          type,
        });
        const message =
          error instanceof Error
            ? `Failed to prepare photo segmentation: ${error.message}`
            : "Failed to prepare photo segmentation.";
        setErrorText(message);
        setStatusText(message);
      } finally {
        if (!isCancelled) {
          setIsBootstrapping(false);
        }
      }
    };

    void bootstrap();

    return () => {
      isCancelled = true;
    };
  }, [
    detectionModel,
    hasMediaLoaded,
    isOnnxRuntime,
    isScreenFocused,
    path,
    runSegmentation,
    samDecoderReady,
    samEncoderModel,
    samEncoderModelOnnx,
    samEncoderReady,
    samVariant,
    type,
  ]);

  const onMediaLoadEnd = useCallback(() => {
    setHasMediaLoaded(true);
  }, []);

  const onMediaLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainerSize({ width, height });
  }, []);

  const handleImagePress = useCallback(
    (event: GestureResponderEvent) => {
      if (!imageRect || isBootstrapping || isDecoding) {
        return;
      }

      const localX = event.nativeEvent.locationX - imageRect.x;
      const localY = event.nativeEvent.locationY - imageRect.y;
      if (
        localX < 0 ||
        localY < 0 ||
        localX > imageRect.width ||
        localY > imageRect.height
      ) {
        return;
      }

      const nextPoint: SamPoint = {
        x: clamp01(localX / imageRect.width),
        y: clamp01(localY / imageRect.height),
        label: pointMode,
      };

      const nextPoints = [...points, nextPoint];
      setPoints(nextPoints);
      void runSegmentation(nextPoints);
    },
    [
      imageRect,
      isBootstrapping,
      isDecoding,
      pointMode,
      points,
      runSegmentation,
    ],
  );

  const handleClearPoints = useCallback(() => {
    setPoints([]);
    void runSegmentation([]);
  }, [runSegmentation]);

  const handleSaveToGallery = useCallback(async () => {
    if (!path || type !== "photo") return;

    try {
      setIsSaving(true);

      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          tr("Media.permissionDenied"),
          tr("Media.permissionNeeded"),
          [{ text: tr("Global.ok") }],
        );
        return;
      }

      const asset = await MediaLibrary.createAssetAsync(toFileUri(path));
      const album = await MediaLibrary.getAlbumAsync("Poop Detector");
      if (album) {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      } else {
        await MediaLibrary.createAlbumAsync("Poop Detector", asset, false);
      }
      await attachPhotoSegmentationAssetId(path, asset.id);

      Alert.alert(tr("Global.success"), tr("Media.saved"), [
        { text: tr("Global.ok") },
      ]);
    } catch (error) {
      console.error("Error saving to gallery:", error);
      Alert.alert(tr("Global.error"), tr("Media.saveFailed"), [
        { text: tr("Global.ok") },
      ]);
    } finally {
      setIsSaving(false);
    }
  }, [path, type]);

  const polygonPoints = useMemo(() => {
    if (
      !imageRect ||
      photoSize.width <= 0 ||
      photoSize.height <= 0 ||
      polygon.length < 3
    ) {
      return "";
    }

    return polygon
      .map(
        (point) =>
          `${imageRect.x + (point.x / photoSize.width) * imageRect.width},${
            imageRect.y + (point.y / photoSize.height) * imageRect.height
          }`,
      )
      .join(" ");
  }, [imageRect, photoSize.height, photoSize.width, polygon]);

  const maskRuns = useMemo(() => {
    if (!imageRect || !maskData) {
      return [] as Array<{ x: number; y: number; width: number }>;
    }

    const runs: Array<{ x: number; y: number; width: number }> = [];
    const { binaryMask, maskWidth, maskHeight } = maskData;

    for (let y = 0; y < maskHeight; y += 1) {
      let runStart = -1;

      for (let x = 0; x < maskWidth; x += 1) {
        const isFilled = binaryMask[y * maskWidth + x] === 1;

        if (isFilled && runStart === -1) {
          runStart = x;
        }

        const isRunEnd = runStart !== -1 && (!isFilled || x === maskWidth - 1);
        if (!isRunEnd) {
          continue;
        }

        const endX = isFilled && x === maskWidth - 1 ? x + 1 : x;
        runs.push({
          x: runStart,
          y,
          width: endX - runStart,
        });
        runStart = -1;
      }
    }

    return runs;
  }, [imageRect, maskData]);

  const canInteract = type === "photo" && imageRect != null && !isBootstrapping;
  const showLoader =
    type === "photo" &&
    modelError == null &&
    (detectionModelHook.state !== "loaded" ||
      !samEncoderReady ||
      !samDecoderReady ||
      isBootstrapping ||
      isDecoding);

  if (!path || !type) {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.closeButton} onPress={router.back}>
          <Ionicons name="close" size={35} color="white" />
        </TouchableOpacity>
        <Text style={styles.emptyText}>No media found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.mediaFrame} onLayout={onMediaLayout}>
        {type === "photo" && (
          <>
            <Image
              source={source}
              style={styles.mediaImage}
              contentFit="contain"
              onLoadEnd={onMediaLoadEnd}
            />

            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={handleImagePress}
              disabled={!canInteract}
            >
              <Svg style={StyleSheet.absoluteFill}>
                {imageRect &&
                  maskData &&
                  maskRuns.map((run, index) => (
                    <Rect
                      key={`mask-run-${index}`}
                      x={
                        imageRect.x +
                        (run.x / maskData.maskWidth) * imageRect.width
                      }
                      y={
                        imageRect.y +
                        (run.y / maskData.maskHeight) * imageRect.height
                      }
                      width={(run.width / maskData.maskWidth) * imageRect.width}
                      height={
                        (1 / maskData.maskHeight) * imageRect.height + 0.5
                      }
                      fill="rgba(34, 197, 94, 0.18)"
                    />
                  ))}

                {imageRect &&
                  detections.map((detection, index) => (
                    <Rect
                      key={`detection-${index}`}
                      x={imageRect.x + detection.x1 * imageRect.width}
                      y={imageRect.y + detection.y1 * imageRect.height}
                      width={(detection.x2 - detection.x1) * imageRect.width}
                      height={(detection.y2 - detection.y1) * imageRect.height}
                      stroke="#22D3EE"
                      strokeWidth={2}
                      fill="transparent"
                    />
                  ))}

                {polygonPoints.length > 0 && (
                  <Polygon
                    points={polygonPoints}
                    fill="rgba(34, 197, 94, 0.28)"
                    stroke="#22C55E"
                    strokeWidth={2}
                  />
                )}

                {imageRect &&
                  points.map((point, index) => (
                    <Circle
                      key={`point-${index}`}
                      cx={imageRect.x + point.x * imageRect.width}
                      cy={imageRect.y + point.y * imageRect.height}
                      r={6}
                      fill={point.label === 1 ? "#22C55E" : "#EF4444"}
                      stroke="white"
                      strokeWidth={2}
                    />
                  ))}
              </Svg>
            </Pressable>
          </>
        )}

        {type === "video" && (
          <View style={styles.videoPlaceholder}>
            <Text style={styles.videoPlaceholderText}>
              Video playback not yet implemented
            </Text>
          </View>
        )}

        {showLoader && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="white" />
            <Text style={styles.loadingText}>{statusText}</Text>
          </View>
        )}
      </View>

      <TouchableOpacity style={styles.closeButton} onPress={router.back}>
        <Ionicons name="close" size={35} color="white" />
      </TouchableOpacity>

      {type === "photo" && (
        <>
          <View style={styles.topStatusCard}>
            <Text style={styles.topStatusTitle}>{samVariant.name}</Text>
            <Text style={styles.topStatusText}>
              {detections.length > 0
                ? `${detections.length} poop detection${detections.length === 1 ? "" : "s"}`
                : "No poop detection, using image center"}
            </Text>
            <Text style={styles.topStatusText}>
              {maskScore != null
                ? `Mask confidence ${Math.round(maskScore * 100)}%`
                : statusText}
            </Text>
            {errorText != null && (
              <Text style={styles.errorText}>{errorText}</Text>
            )}
            <View style={styles.debugToggleRow}>
              <View
                style={[
                  styles.debugToggle,
                  detectorUseGpu && styles.debugToggleActive,
                ]}
              >
                <Text style={styles.debugToggleText}>
                  Detector: {detectorUseGpu ? "GPU" : "CPU"}
                </Text>
              </View>
              <View
                style={[
                  styles.debugToggle,
                  samUseGpu && styles.debugToggleActive,
                ]}
              >
                <Text style={styles.debugToggleText}>
                  SAM: {samUseGpu ? "GPU" : "CPU"}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.segmentationControls}>
            <TouchableOpacity
              style={[
                styles.modeButton,
                pointMode === 1 && styles.modeButtonPositiveActive,
              ]}
              onPress={() => setPointMode(1)}
            >
              <Text style={styles.modeButtonText}>Positive</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modeButton,
                pointMode === 0 && styles.modeButtonNegativeActive,
              ]}
              onPress={() => setPointMode(0)}
            >
              <Text style={styles.modeButtonText}>Negative</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.clearButton}
              onPress={handleClearPoints}
            >
              <Text style={styles.clearButtonText}>Clear points</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[
              styles.saveButton,
              { backgroundColor: theme.colors.primary },
            ]}
            onPress={handleSaveToGallery}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <>
                <Ionicons name="download-outline" size={24} color="white" />
                <Text style={styles.saveButtonText}>
                  {tr("Media.saveToGallery")}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};

export default MediaPage;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "black",
  },
  mediaFrame: {
    flex: 1,
  },
  mediaImage: {
    ...StyleSheet.absoluteFillObject,
  },
  videoPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "black",
    justifyContent: "center",
    alignItems: "center",
  },
  videoPlaceholderText: {
    color: "white",
    fontSize: 18,
  },
  closeButton: {
    position: "absolute",
    top: SAFE_AREA_PADDING.paddingTop,
    left: SAFE_AREA_PADDING.paddingLeft,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(140, 140, 140, 0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  topStatusCard: {
    position: "absolute",
    top: SAFE_AREA_PADDING.paddingTop,
    right: SAFE_AREA_PADDING.paddingRight,
    maxWidth: 230,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    gap: 4,
  },
  topStatusTitle: {
    color: "white",
    fontSize: 15,
    fontWeight: "700",
  },
  topStatusText: {
    color: "white",
    fontSize: 13,
  },
  debugToggleRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
  },
  debugToggle: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
  },
  debugToggleActive: {
    backgroundColor: "rgba(34, 197, 94, 0.75)",
  },
  debugToggleText: {
    color: "white",
    fontSize: 11,
    fontWeight: "600",
  },
  segmentationControls: {
    position: "absolute",
    bottom: SAFE_AREA_PADDING.paddingBottom + 96,
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  modeButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
  },
  modeButtonPositiveActive: {
    backgroundColor: "rgba(34, 197, 94, 0.75)",
  },
  modeButtonNegativeActive: {
    backgroundColor: "rgba(239, 68, 68, 0.75)",
  },
  modeButtonText: {
    color: "white",
    fontSize: 15,
    fontWeight: "600",
  },
  clearButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "rgba(15, 23, 42, 0.85)",
  },
  clearButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  saveButton: {
    position: "absolute",
    bottom: SAFE_AREA_PADDING.paddingBottom + 20,
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 24,
    gap: 8,
  },
  saveButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.38)",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  errorText: {
    color: "#FCA5A5",
    fontSize: 13,
  },
  emptyText: {
    color: "white",
  },
});
