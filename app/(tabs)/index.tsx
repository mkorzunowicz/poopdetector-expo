import { BoundingBoxOverlay } from "@/components/BoundingBoxOverlay";
import { tr } from "@/i18n/i18n";
import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GestureResponderEvent } from "react-native";
import {
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { PinchGestureHandlerGestureEvent } from "react-native-gesture-handler";
import {
  PinchGestureHandler,
  TapGestureHandler,
} from "react-native-gesture-handler";
import {
  Camera,
  CommonDynamicRanges,
  CommonResolutions,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
  useMicrophonePermission,
  usePhotoOutput,
  useVideoOutput,
  type CameraRef,
  type Constraint,
  type DynamicRange,
  type Recorder,
} from "react-native-vision-camera";
import { createSynchronizable, scheduleOnRN } from "react-native-worklets";

import { DETECTOR_NAMES, DetectorName, useDetector } from "@/ai/detectors";
import { Detection } from "@/ai/detectors/types";
import { useOnnxModelSlot } from "@/ai/onnxModelCache";
import {
  samEncoderTfliteDelegates,
  samOnnxProviderOptions,
} from "@/ai/samDelegates";
import {
  DEFAULT_SAM_VARIANT_ID,
  getSamVariant,
  nextSamVariantId,
  type SamVariantId,
} from "@/ai/samModels";
import { useTensorflowModelSlot } from "@/ai/tfliteModelCache";
import { useFocusEffect } from "@react-navigation/core";

import { CaptureButton } from "@/components/buttons/CaptureButton";
import { useIsForeground } from "@/hooks/useIsForeground";
import { usePreferredCameraDevice } from "@/hooks/usePreferredCameraDevice";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  Extrapolate,
  interpolate,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Constants
const CONTENT_SPACING = 15;
const CONTROL_BUTTON_SIZE = 40;
const MAX_ZOOM_FACTOR = 10;
const SCALE_FULL_ZOOM = 3;
const SCREEN_WIDTH = Dimensions.get("window").width;
const SCREEN_HEIGHT = Dimensions.get("window").height;

const isHdrDynamicRange = (range: DynamicRange): boolean =>
  range.bitDepth === "hdr-10-bit";

const CameraPage: React.FC = () => {
  const camera = useRef<CameraRef>(null);
  const recorder = useRef<Recorder | null>(null);
  const [isCameraConfigured, setIsCameraConfigured] = useState(false);
  const [isCameraStarted, setIsCameraStarted] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const cameraPermission = useCameraPermission();
  const microphone = useMicrophonePermission();
  const zoom = useSharedValue(1);
  const insets = useSafeAreaInsets();

  // check if camera page is active
  const [isFocussed, setIsFocussed] = useState(false);
  const isForeground = useIsForeground();
  const isActive = isFocussed && isForeground;

  useFocusEffect(
    useCallback(() => {
      setIsFocussed(true);
      return () => {
        setIsFocussed(false);
      };
    }, []),
  );

  // Reset camera error state when app comes back to foreground
  useEffect(() => {
    if (isActive && cameraError) {
      console.log(
        "[Camera] App became active with previous error, attempting recovery...",
      );
      setCameraError(null);
      setIsCameraConfigured(false);
      setIsCameraStarted(false);
    }
  }, [isActive, cameraError]);

  useEffect(() => {
    if (!isActive) {
      setIsCameraStarted(false);
    }
  }, [isActive]);

  // Check permissions and redirect if needed
  useEffect(() => {
    if (!cameraPermission.hasPermission || !microphone.hasPermission) {
      router.push("/permissions");
    }
  }, [cameraPermission.hasPermission, microphone.hasPermission]);

  const [cameraPosition, setCameraPosition] = useState<"front" | "back">(
    "back",
  );
  const [enableHdr, setEnableHdr] = useState(false);
  const [flash, setFlash] = useState<"off" | "on">("off");
  const [enableNightMode, setEnableNightMode] = useState(false);

  const [previewSize, setPreviewSize] = useState({ w: 1, h: 1 });
  // camera device settings
  const [preferredDevice] = usePreferredCameraDevice();
  let device = useCameraDevice(cameraPosition);

  if (preferredDevice != null && preferredDevice.position === cameraPosition) {
    // override default device with the one selected by the user in settings
    device = preferredDevice;
  }

  const [targetFps, setTargetFps] = useState(30);

  const photoOutput = usePhotoOutput({
    targetResolution: CommonResolutions.UHD_4_3,
    containerFormat: "jpeg",
    quality: 0.9,
    qualityPrioritization: "quality",
  });
  const videoOutput = useVideoOutput({
    targetResolution: CommonResolutions.FHD_16_9,
    enableAudio: microphone.hasPermission,
  });

  const supportsFlash = device?.hasFlash ?? false;
  const supportsVideoHdr = useMemo(
    () => device?.supportedVideoDynamicRanges.some(isHdrDynamicRange) ?? false,
    [device],
  );
  const supportsHdr = (device?.supportsPhotoHDR ?? false) || supportsVideoHdr;
  const supports60Fps = device?.supportsFPS(60) ?? false;
  const canToggleNightMode = device?.supportsLowLightBoost ?? false;
  const lowLightBoostProps = canToggleNightMode
    ? { enableLowLightBoost: enableNightMode }
    : {};
  const cameraControlProps =
    isActive && isCameraConfigured && isCameraStarted
      ? {
          zoom,
          exposure: 0,
        }
      : {};
  const minZoom = device?.minZoom ?? 1;
  const maxZoom = Math.min(device?.maxZoom ?? 1, MAX_ZOOM_FACTOR);

  //#region Callbacks
  const onError = useCallback((error: Error) => {
    console.error("[Camera] Error:", error);
    setCameraError(error.message);
    setIsCameraConfigured(false);
    setIsCameraStarted(false);
  }, []);

  const onConfigured = useCallback(() => {
    console.log("[Camera] Session configured");
    setIsCameraConfigured(true);
    setCameraError(null); // Clear any previous errors
  }, []);

  const onStarted = useCallback(() => {
    console.log("Camera started!");
    setIsCameraStarted(true);
  }, []);

  const onStopped = useCallback(() => {
    console.log("Camera stopped!");
    setIsCameraStarted(false);
  }, []);

  // Which SAM variant the media screen should segment captured photos with.
  // Cycled via the selector button in the right control column.
  const [samVariantId, setSamVariantId] = useState<SamVariantId>(
    DEFAULT_SAM_VARIANT_ID,
  );
  const onCycleSamVariant = useCallback(() => {
    setSamVariantId((current) => {
      const next = nextSamVariantId(current);
      console.log(`SAM variant selected: ${next}`);
      return next;
    });
  }, []);

  // CPU/GPU choice for the detector and for whichever SAM runtime is active.
  // detectorUseGpu drives the LIVE detector below (useDetector) directly, so
  // toggling it changes frame-processor behavior on this screen immediately.
  // Both also get passed to the media/photo screen for its own (separate)
  // detector + SAM model instances, so the effect of switching is easy to
  // compare by capturing twice with the setting flipped.
  //
  // detectorUseGpu defaults to CPU (false). Dev-client A/B testing on one
  // device showed GPU running live detection 3-4x faster once compiled
  // (~60ms/frame vs ~230ms/frame CPU) after a ~4s one-time compile cost, so
  // GPU-default was tried -- but a preview/production Android build hung
  // indefinitely at "Loading detector" with zero logcat errors: the GPU
  // delegate's fallback-to-CPU logic (useDetectorYoloXNanoPoop) only
  // triggers on a clean "error" state, and NNAPI delegate compilation can
  // HANG rather than error on some device/driver/build combinations (a known
  // Android NNAPI issue category), which never resolves and never falls
  // back. Reverted to CPU-default until there's a safe way to detect/bound
  // that (e.g. a timeout-based fallback) rather than trusting the delegate
  // to always fail cleanly. samUseGpu stays CPU-default too: GPU gave no
  // measurable speedup for the SAM encoder, and actively broke the decoder
  // (silently empty masks) before it was hardcoded back to CPU-only.
  const [detectorUseGpu, setDetectorUseGpu] = useState(false);
  const [samUseGpu, setSamUseGpu] = useState(false);

  const samVariant = useMemo(() => getSamVariant(samVariantId), [samVariantId]);
  const isSamOnnxRuntime = samVariant.runtime === "onnx-nitro";

  // Declared here rather than next to the detector hook below because
  // onMediaCaptured now forwards it to the photo screen, and a useCallback
  // dependency array is evaluated during render -- referencing a `const`
  // declared further down would be a temporal-dead-zone error.
  const [selected, setSelected] = useState<DetectorName>("poop-yolox-nano");

  const onMediaCaptured = useCallback(
    (filePath: string, type: "photo" | "video") => {
      console.log(
        `Media captured! ${filePath} (sam=${samVariantId}, detectorGpu=${detectorUseGpu}, samGpu=${samUseGpu})`,
      );
      router.push(
        // `detector` carries the camera screen's model choice to the photo
        // screen. Without it media.tsx fell back to a hardcoded 2024 export --
        // the weakest model measured (F1 0.471, 39% false alarms on indoor
        // photos) -- so the picker here had no effect at all after the shutter.
        `/media?path=${encodeURIComponent(filePath)}&type=${type}&sam=${samVariantId}&detector=${selected}&detectorGpu=${detectorUseGpu ? "1" : "0"}&samGpu=${samUseGpu ? "1" : "0"}`,
      );
    },
    [samVariantId, selected, detectorUseGpu, samUseGpu],
  );
  const onFlipCameraPressed = useCallback(() => {
    setCameraPosition((p) => (p === "back" ? "front" : "back"));
  }, []);
  const onFlashPressed = useCallback(() => {
    setFlash((f) => (f === "off" ? "on" : "off"));
  }, []);
  //#endregion

  //#region Tap Gesture
  const onFocusTap = useCallback(
    ({ nativeEvent: event }: GestureResponderEvent) => {
      if (!device?.supportsFocusMetering || camera.current == null) return;
      void camera.current.focusTo({ x: event.locationX, y: event.locationY });
    },
    [device?.supportsFocusMetering],
  );
  const onDoubleTap = useCallback(() => {
    onFlipCameraPressed();
  }, [onFlipCameraPressed]);
  //#endregion

  //#region Effects
  useEffect(() => {
    // Reset zoom to it's default everytime the `device` changes.
    zoom.value = Math.max(minZoom, 1);
  }, [minZoom, zoom]);
  //#endregion

  //#region Pinch to Zoom Gesture
  // The gesture handler maps the linear pinch gesture (0 - 1) to an exponential curve since a camera's zoom
  // function does not appear linear to the user. (aka zoom 0.1 -> 0.2 does not look equal in difference as 0.8 -> 0.9)
  const onPinchGesture = React.useCallback(
    (event: PinchGestureHandlerGestureEvent) => {
      "worklet";
      // we're trying to map the scale gesture to a linear zoom here
      const scale = interpolate(
        event.nativeEvent.scale,
        [1 - 1 / SCALE_FULL_ZOOM, 1, SCALE_FULL_ZOOM],
        [-1, 0, 1],
        Extrapolate.CLAMP,
      );
      zoom.value = interpolate(
        scale,
        [-1, 0, 1],
        [minZoom, zoom.value, maxZoom],
        Extrapolate.CLAMP,
      );
    },
    [zoom, minZoom, maxZoom],
  );
  //#endregion

  useEffect(() => {
    console.log(
      `Camera: ${device?.localizedName ?? "unknown"} | position=${device?.position ?? "unknown"} | target=${targetFps}fps`,
    );
  }, [device, targetFps]);

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Shared detections state that the overlay will render               */
  const [detections, setDetections] = useState<Detection[]>([]);

  const { detect, ready } = useDetector(selected, detectorUseGpu);

  /**
   * SAM prefetch master switch -- OFF while benchmarking detectors.
   *
   * The prefetch loads a multi-hundred-MB encoder + decoder in the background as
   * soon as the detector reports ready. That is right for normal use (it hides
   * the SAM load behind the time a user spends framing a shot) but it competes
   * for CPU, memory bandwidth and thermal headroom with whatever the detector is
   * doing, which contaminates any frame-time measurement taken on this screen.
   *
   * Set back to true when done comparing precisions/delegates.
   */
  const PREFETCH_SAM = false;

  // Prefetch: start loading the currently-selected SAM model through the
  // SAME role-scoped cache app/media.tsx uses (ai/tfliteModelCache.ts /
  // ai/onnxModelCache.ts) with the SAME delegate/options computation
  // (ai/samDelegates.ts, shared so the cache keys are guaranteed to match).
  // By the time a photo is captured and the media screen mounts, the model
  // is already loaded or well underway -- hiding most of a multi-second SAM
  // load behind however long the user spends framing the shot.
  //
  // Gated on `ready` (the detector's own load having ALREADY completed),
  // not just "screen mounted" -- starting both heavy native loads at once
  // was starving the detector of the CPU it needed for its own startup,
  // visibly delaying when live detection kicked in. Sequencing them (detector
  // first, SAM prefetch only once it's confirmed running) fixes that; SAM
  // loading in the background afterward only competes with the detector's
  // much lighter steady-state per-frame inference, not its heavy initial
  // load.
  const samEncoderTflitePrefetch = useTensorflowModelSlot(
    "sam-encoder",
    samVariant.encoderAsset,
    samEncoderTfliteDelegates(samUseGpu),
    PREFETCH_SAM && ready && !isSamOnnxRuntime,
  );
  const samDecoderTflitePrefetch = useTensorflowModelSlot(
    "sam-decoder",
    samVariant.decoderAsset,
    [],
    PREFETCH_SAM && ready && !isSamOnnxRuntime,
  );
  const samEncoderOnnxPrefetch = useOnnxModelSlot(
    "sam-encoder-onnx",
    samVariant.encoderAsset,
    samOnnxProviderOptions(samUseGpu),
    PREFETCH_SAM && ready && isSamOnnxRuntime,
  );
  const samDecoderOnnxPrefetch = useOnnxModelSlot(
    "sam-decoder-onnx",
    samVariant.decoderAsset,
    samOnnxProviderOptions(samUseGpu),
    PREFETCH_SAM && ready && isSamOnnxRuntime,
  );

  // Timing for the prefetch above -- otherwise there's no visibility into
  // whether it actually finishes before a photo gets captured (the whole
  // point of prefetching). Clock starts when `ready` first flips true (i.e.
  // when the prefetch actually got enabled), not screen mount, so this
  // measures the prefetch itself, not detector load time. Keyed by
  // (variant, useGpu) and reset whenever either changes, so cycling SAM
  // variants mid-session (onCycleSamVariant) times each one separately
  // instead of reporting elapsed-since-the-very-first-prefetch.
  const samPrefetchStartRef = useRef<number | null>(null);
  const samPrefetchKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const key = `${samVariant.id}:${samUseGpu}`;
    if (samPrefetchKeyRef.current !== key) {
      samPrefetchKeyRef.current = key;
      samPrefetchStartRef.current = Date.now();
      console.log(
        `[SAM] prefetch starting for ${samVariant.name} (detector ready)`,
      );
    }
  }, [ready, samVariant.id, samVariant.name, samUseGpu]);

  const samEncoderPrefetchState = isSamOnnxRuntime
    ? samEncoderOnnxPrefetch.state
    : samEncoderTflitePrefetch.state;
  const samDecoderPrefetchState = isSamOnnxRuntime
    ? samDecoderOnnxPrefetch.state
    : samDecoderTflitePrefetch.state;

  useEffect(() => {
    if (samPrefetchStartRef.current == null) return;
    const elapsed = Date.now() - samPrefetchStartRef.current;
    if (samEncoderPrefetchState === "loaded") {
      console.log(`[SAM] prefetch encoder loaded in ${elapsed}ms`);
    } else if (samEncoderPrefetchState === "error") {
      console.log(`[SAM] prefetch encoder FAILED after ${elapsed}ms`);
    }
  }, [samEncoderPrefetchState]);

  useEffect(() => {
    if (samPrefetchStartRef.current == null) return;
    const elapsed = Date.now() - samPrefetchStartRef.current;
    if (samDecoderPrefetchState === "loaded") {
      console.log(`[SAM] prefetch decoder loaded in ${elapsed}ms`);
    } else if (samDecoderPrefetchState === "error") {
      console.log(`[SAM] prefetch decoder FAILED after ${elapsed}ms`);
    }
  }, [samDecoderPrefetchState]);

  useEffect(() => {
    if (
      samPrefetchStartRef.current != null &&
      samEncoderPrefetchState === "loaded" &&
      samDecoderPrefetchState === "loaded"
    ) {
      console.log(
        `[SAM] prefetch ready in ${Date.now() - samPrefetchStartRef.current}ms ` +
          `(${samVariant.name}) -- will be a cache hit on capture from here`,
      );
    }
  }, [samEncoderPrefetchState, samDecoderPrefetchState, samVariant.name]);

  // Adaptive FPS based on detection performance
  const [adaptiveTargetFps, setAdaptiveTargetFps] = useState(3);
  const adaptiveTargetFpsRef = useMemo(() => createSynchronizable(3), []);
  const lastDetectionStartedAtRef = useMemo(() => createSynchronizable(0), []);
  const detectionTimesRef = useRef<number[]>([]);
  const [detectionFpsHistory, setDetectionFpsHistory] = useState<number[]>([]);
  const [lastDetectionTimeMs, setLastDetectionTimeMs] = useState<number | null>(
    null,
  );

  // Clear detections when camera becomes inactive
  useEffect(() => {
    if (!isActive) {
      console.log(
        "[Camera] Camera inactive - clearing detections and pausing processing",
      );
      setDetections([]);
      detectionTimesRef.current = [];
      setDetectionFpsHistory([]);
      setLastDetectionTimeMs(null);
      lastDetectionStartedAtRef.setBlocking(0);
      return;
    }

    console.log("[Camera] Camera active - resuming processing");
    detectionTimesRef.current = [];
    setDetectionFpsHistory([]);
    setLastDetectionTimeMs(null);
    setAdaptiveTargetFps(3);
    adaptiveTargetFpsRef.setBlocking(3);
    lastDetectionStartedAtRef.setBlocking(0);
  }, [adaptiveTargetFpsRef, isActive, lastDetectionStartedAtRef]);

  useEffect(() => {
    adaptiveTargetFpsRef.setBlocking(adaptiveTargetFps);
  }, [adaptiveTargetFps, adaptiveTargetFpsRef]);

  const onDetectionCompleted = useCallback(
    (nextDetections: Detection[], detectionTimeMs: number) => {
      setDetections(nextDetections);
      setLastDetectionTimeMs(detectionTimeMs);

      detectionTimesRef.current.push(detectionTimeMs);
      if (detectionTimesRef.current.length > 5) {
        detectionTimesRef.current.shift();
      }

      const avgTime =
        detectionTimesRef.current.reduce((sum, time) => sum + time, 0) /
        detectionTimesRef.current.length;
      const idealFps = Math.floor(800 / avgTime);
      const newFps = Math.max(1, Math.min(10, idealFps));
      const currentFps = 1000 / detectionTimeMs;

      setDetectionFpsHistory((previous) =>
        [...previous, currentFps].slice(-60),
      );

      if (Math.abs(newFps - adaptiveTargetFps) >= 1) {
        console.log(
          `[AdaptiveFPS] Avg detection: ${avgTime.toFixed(0)}ms -> Target FPS: ${newFps}`,
        );
        setAdaptiveTargetFps(newFps);
      }
    },
    [adaptiveTargetFps],
  );

  const frameOutput = useFrameOutput({
    targetResolution: CommonResolutions.HD_16_9,
    pixelFormat: "yuv",
    onFrame(frame) {
      "worklet";

      try {
        if (!isActive || !detect || !ready) return;

        const now = Date.now();
        const minIntervalMs =
          1000 / Math.max(adaptiveTargetFpsRef.getBlocking(), 1);
        const lastDetectionStartedAt = lastDetectionStartedAtRef.getBlocking();
        if (now - lastDetectionStartedAt < minIntervalMs) return;

        lastDetectionStartedAtRef.setBlocking(now);

        const startedAt = Date.now();
        const nextDetections = detect(frame);
        const totalTime = Date.now() - startedAt;

        console.log(
          `[FrameProcessor] Detection completed in ${totalTime}ms, found ${nextDetections.length} objects @ ${adaptiveTargetFpsRef.getBlocking()}fps`,
        );

        scheduleOnRN(onDetectionCompleted, nextDetections, totalTime);
      } finally {
        frame.dispose();
      }
    },
  });

  const outputs = useMemo(
    () => [photoOutput, videoOutput, frameOutput],
    [frameOutput, photoOutput, videoOutput],
  );
  const constraints = useMemo((): Constraint[] => {
    const nextConstraints: Constraint[] = [{ fps: targetFps }];

    if (enableHdr && device?.supportsPhotoHDR) {
      nextConstraints.push({ photoHDR: true });
    }
    if (enableHdr && supportsVideoHdr) {
      nextConstraints.push({ videoDynamicRange: CommonDynamicRanges.ANY_HDR });
    }

    return nextConstraints;
  }, [device?.supportsPhotoHDR, enableHdr, supportsVideoHdr, targetFps]);

  const takePhoto = useCallback(async () => {
    try {
      const photo = await photoOutput.capturePhotoToFile(
        {
          flashMode: supportsFlash ? flash : "off",
          enableShutterSound: false,
          enableDistortionCorrection:
            device?.supportsDistortionCorrection ?? false,
        },
        {},
      );
      onMediaCaptured(photo.filePath, "photo");
    } catch (error) {
      console.error("Failed to take photo!", error);
    }
  }, [
    device?.supportsDistortionCorrection,
    flash,
    onMediaCaptured,
    photoOutput,
    supportsFlash,
  ]);

  const startRecording = useCallback(async () => {
    if (recorder.current != null) return;

    try {
      const nextRecorder = await videoOutput.createRecorder({});
      recorder.current = nextRecorder;

      await nextRecorder.startRecording(
        (filePath) => {
          recorder.current = null;
          console.log(`Recording successfully finished! ${filePath}`);
          onMediaCaptured(filePath, "video");
        },
        (error) => {
          recorder.current = null;
          console.error("Recording failed!", error);
        },
      );
    } catch (error) {
      recorder.current = null;
      console.error("failed to start recording!", error);
      throw error;
    }
  }, [onMediaCaptured, videoOutput]);

  const stopRecording = useCallback(async () => {
    const activeRecorder = recorder.current;
    if (activeRecorder == null) return;

    try {
      await activeRecorder.stopRecording();
    } catch (error) {
      console.error("failed to stop recording!", error);
      throw error;
    }
  }, []);

  // Show permissions screen if permissions are not granted
  if (!cameraPermission.hasPermission || !microphone.hasPermission) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.text}>{tr("Camera.permissionsRequired")}</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push("/permissions")}
        >
          <Text style={styles.text}>{tr("Permissions.grantPermissions")}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <View
      style={styles.container}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setPreviewSize({ w: width, h: height });
      }}
    >
      {device != null ? (
        <>
          <PinchGestureHandler
            onGestureEvent={onPinchGesture}
            enabled={isActive}
          >
            <View onTouchEnd={onFocusTap} style={StyleSheet.absoluteFill}>
              <TapGestureHandler onEnded={onDoubleTap} numberOfTaps={2}>
                <View style={StyleSheet.absoluteFill}>
                  <Camera
                    style={StyleSheet.absoluteFill}
                    device={device}
                    isActive={isActive}
                    ref={camera}
                    {...lowLightBoostProps}
                    {...cameraControlProps}
                    outputs={outputs}
                    constraints={constraints}
                    onConfigured={onConfigured}
                    onSessionConfigSelected={(config) => {
                      console.log(
                        `[Camera] Resolved session config. FPS=${config.selectedFPS ?? "auto"}`,
                      );
                    }}
                    onError={onError}
                    onStarted={onStarted}
                    onStopped={onStopped}
                    onPreviewStarted={() => console.log("Preview started!")}
                    onPreviewStopped={() => console.log("Preview stopped!")}
                    enableNativeZoomGesture={false}
                  />
                </View>
              </TapGestureHandler>
            </View>
          </PinchGestureHandler>

          <BoundingBoxOverlay
            detections={detections}
            viewWidth={previewSize.w}
            viewHeight={previewSize.h}
          />

          {!ready && (
            <View style={styles.modelLoaderOverlay}>
              <View style={styles.modelLoaderCard}>
                <Text style={styles.modelLoaderText}>Loading detector...</Text>
              </View>
            </View>
          )}

          {cameraError && (
            <View style={styles.errorOverlay}>
              <View style={styles.errorCard}>
                <Ionicons name="warning-outline" size={48} color="#E74C3C" />
                <Text style={styles.errorTitle}>Camera Error</Text>
                <Text style={styles.errorMessage}>{cameraError}</Text>
                <Text style={styles.errorHint}>
                  Switch back to the Camera tab to resume.
                </Text>
              </View>
            </View>
          )}
        </>
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.text}>{tr("Camera.noCameraAvailable")}</Text>
        </View>
      )}

      <CaptureButton
        style={[
          styles.captureButton,
          { bottom: insets.bottom + CONTENT_SPACING },
        ]}
        onTakePhoto={takePhoto}
        onStartRecording={startRecording}
        onStopRecording={stopRecording}
        enabled={isCameraConfigured && isActive}
        photoOnly
      />

      <View style={{ position: "absolute", top: 130, left: 10, zIndex: 99 }}>
        {DETECTOR_NAMES.map((n) => (
          <TouchableOpacity key={n} onPress={() => setSelected(n)}>
            <Text style={{ color: selected === n ? "lime" : "white" }}>
              {n}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Detection FPS Graph */}
      {detectionFpsHistory.length > 0 && (
        <View style={styles.detectionFpsGraph}>
          <View style={styles.detectionFpsGraphBars}>
            {[...detectionFpsHistory].slice(0, 40).map((fps, index) => {
              const height = Math.min((fps / 10) * 40, 40); // Scale to max 40px height (10 fps = full)
              return (
                <View
                  key={index}
                  style={{
                    width: 2,
                    height,
                    backgroundColor: "#7DD3F8", // Blue color from theme
                    marginLeft: 0,
                  }}
                />
              );
            })}
          </View>
          <View style={styles.detectionStatsText}>
            {lastDetectionTimeMs != null && (
              <Text style={styles.detectionTimeText}>
                {lastDetectionTimeMs} ms
              </Text>
            )}
            <Text style={styles.detectionFpsText}>{adaptiveTargetFps} FPS</Text>
          </View>
        </View>
      )}

      <View
        style={[
          styles.rightButtonRow,
          {
            right: insets.right + CONTENT_SPACING,
            top: insets.top + CONTENT_SPACING,
          },
        ]}
      >
        <TouchableOpacity style={styles.button} onPress={onFlipCameraPressed}>
          <Ionicons name="camera-reverse" color="white" size={24} />
        </TouchableOpacity>
        {supportsFlash && (
          <TouchableOpacity style={styles.button} onPress={onFlashPressed}>
            <Ionicons
              name={flash === "on" ? "flash" : "flash-off"}
              color="white"
              size={24}
            />
          </TouchableOpacity>
        )}
        {supports60Fps && (
          <TouchableOpacity
            style={styles.button}
            onPress={() => setTargetFps((t) => (t === 30 ? 60 : 30))}
          >
            <Text style={styles.text}>{`${targetFps}\nFPS`}</Text>
          </TouchableOpacity>
        )}
        {supportsHdr && (
          <TouchableOpacity
            style={styles.button}
            onPress={() => setEnableHdr((h) => !h)}
          >
            <MaterialCommunityIcons
              name={enableHdr ? "hdr" : "hdr-off"}
              color="white"
              size={24}
            />
          </TouchableOpacity>
        )}
        {canToggleNightMode && (
          <TouchableOpacity
            style={styles.button}
            onPress={() => setEnableNightMode(!enableNightMode)}
          >
            <Ionicons
              name={enableNightMode ? "moon" : "moon-outline"}
              color="white"
              size={24}
            />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.button} onPress={onCycleSamVariant}>
          <Text style={styles.text}>{samVariant.shortLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.button}
          onPress={() => setDetectorUseGpu((value) => !value)}
        >
          <Text style={styles.text}>{`Det\n${detectorUseGpu ? "GPU" : "CPU"}`}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.button}
          onPress={() => setSamUseGpu((value) => !value)}
        >
          <Text style={styles.text}>{`SAM\n${samUseGpu ? "GPU" : "CPU"}`}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push("/devices")}
        >
          <Ionicons name="settings-outline" color="white" size={24} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "black",
  },
  captureButton: {
    position: "absolute",
    alignSelf: "center",
  },
  button: {
    marginBottom: CONTENT_SPACING,
    width: CONTROL_BUTTON_SIZE,
    height: CONTROL_BUTTON_SIZE,
    borderRadius: CONTROL_BUTTON_SIZE / 2,
    backgroundColor: "rgba(140, 140, 140, 0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  rightButtonRow: {
    position: "absolute",
  },
  text: {
    color: "white",
    fontSize: 11,
    fontWeight: "bold",
    textAlign: "center",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  modelLoaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  modelLoaderCard: {
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    minWidth: 200,
  },
  modelLoaderText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 101,
  },
  errorCard: {
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    maxWidth: 320,
    margin: 20,
  },
  errorTitle: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: "700",
    color: "#E74C3C",
    marginBottom: 12,
  },
  errorMessage: {
    fontSize: 14,
    color: "#333",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 12,
  },
  errorHint: {
    fontSize: 13,
    color: "#666",
    textAlign: "center",
    fontStyle: "italic",
  },
  detectionFpsGraph: {
    position: "absolute",
    top: 70,
    left: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    height: 52,
    paddingLeft: 0,
    paddingRight: 8,
    paddingVertical: 2,
  },
  detectionStatsText: {
    position: "absolute",
    left: 8,
    top: 2,
  },
  detectionTimeText: {
    color: "white",
    fontSize: 13,
    fontWeight: "600",
  },
  detectionFpsText: {
    color: "white",
    fontSize: 14,
    fontWeight: "bold",
  },
  detectionFpsGraphBars: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 40,
  },
});

export default CameraPage;
