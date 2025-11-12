import { BoundingBoxOverlay } from '@/components/BoundingBoxOverlay'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GestureResponderEvent } from 'react-native'
import type { PinchGestureHandlerGestureEvent } from 'react-native-gesture-handler'
import { PinchGestureHandler, TapGestureHandler } from 'react-native-gesture-handler'
import type { CameraProps, CameraRuntimeError, PhotoFile, VideoFile } from 'react-native-vision-camera'
import {
  runAtTargetFps,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  useFrameProcessor,
  useLocationPermission,
  useMicrophonePermission,
} from 'react-native-vision-camera'
import { Worklets } from 'react-native-worklets-core'

import { DETECTOR_NAMES, DetectorName, useDetector } from '@/ai/detectors'
import { Detection } from '@/ai/detectors/types'
import { useFocusEffect } from '@react-navigation/core'
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useResizePlugin } from 'vision-camera-resize-plugin'

import { CaptureButton } from '@/components/buttons/CaptureButton'
import { useIsForeground } from '@/hooks/useIsForeground'
import { usePreferredCameraDevice } from '@/hooks/usePreferredCameraDevice'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { router } from 'expo-router'
import Reanimated, { Extrapolate, interpolate, useAnimatedProps, useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Camera } from 'react-native-vision-camera'

// Constants
const CONTENT_SPACING = 15
const CONTROL_BUTTON_SIZE = 40
const MAX_ZOOM_FACTOR = 10
const SCALE_FULL_ZOOM = 3
const SCREEN_WIDTH = Dimensions.get('window').width
const SCREEN_HEIGHT = Dimensions.get('window').height

const ReanimatedCamera = Reanimated.createAnimatedComponent(Camera)
Reanimated.addWhitelistedNativeProps({
  zoom: true,
})

const CameraPage: React.FC = () => {
  const camera = useRef<Camera>(null)
  const [isCameraInitialized, setIsCameraInitialized] = useState(false)
  const cameraPermission = useCameraPermission()
  const microphone = useMicrophonePermission()
  const location = useLocationPermission()
  const zoom = useSharedValue(1)
  const isPressingButton = useSharedValue(false)
  const insets = useSafeAreaInsets()
  // const model = useTensorflowModel(require('../assets/fastsam_s-qualcomm_snapdragon_8_elite.tflite'),'android-gpu')
  // const model = useTensorflowModel({ url: 'https://github.com/mkorzunowicz/tflite_models/raw/refs/heads/main/efficientdet_f32.tflite'},'android-gpu')
  

  // const actualModel = model.state === 'loaded' ? model.model : undefined

  // React.useEffect(() => {
  //   if (actualModel == null) return
  //   console.log(`Model loaded! Shape:\n${modelToString(actualModel)}]`)
  // }, [actualModel])

  const { resize } = useResizePlugin()

  // check if camera page is active
  const [isFocussed, setIsFocussed] = useState(false)
  const isForeground = useIsForeground()
  const isActive = isFocussed && isForeground

  useFocusEffect(
    useCallback(() => {
      setIsFocussed(true)
      return () => {
        setIsFocussed(false)
      }
    }, [])
  )

  // Check permissions and redirect if needed
  useEffect(() => {
    if (!cameraPermission.hasPermission || !microphone.hasPermission) {
      router.push('/permissions')
    }
  }, [cameraPermission.hasPermission, microphone.hasPermission])

  const [cameraPosition, setCameraPosition] = useState<'front' | 'back'>('back')
  const [enableHdr, setEnableHdr] = useState(false)
  const [flash, setFlash] = useState<'off' | 'on'>('off')
  const [enableNightMode, setEnableNightMode] = useState(false)

  const [previewSize, setPreviewSize] = useState({ w: 1, h: 1 })
  // camera device settings
  const [preferredDevice] = usePreferredCameraDevice()
  let device = useCameraDevice(cameraPosition)

  if (preferredDevice != null && preferredDevice.position === cameraPosition) {
    // override default device with the one selected by the user in settings
    device = preferredDevice
  }

  const [targetFps, setTargetFps] = useState(30)

  const screenAspectRatio = SCREEN_HEIGHT / SCREEN_WIDTH
  const format = useCameraFormat(device, [
    { fps: targetFps },
    { videoAspectRatio: screenAspectRatio },
    { videoResolution: 'max' },
    { photoAspectRatio: screenAspectRatio },
    { photoResolution: 'max' },
  ])

  const fps = Math.min(format?.maxFps ?? 1, targetFps)

  const supportsFlash = device?.hasFlash ?? false
  const supportsHdr = format?.supportsPhotoHdr
  const supports60Fps = useMemo(() => device?.formats.some((f) => f.maxFps >= 60), [device?.formats])
  const canToggleNightMode = device?.supportsLowLightBoost ?? false

  //#region Animated Zoom
  const minZoom = device?.minZoom ?? 1
  const maxZoom = Math.min(device?.maxZoom ?? 1, MAX_ZOOM_FACTOR)

  const cameraAnimatedProps = useAnimatedProps<CameraProps>(() => {
    const z = Math.max(Math.min(zoom.value, maxZoom), minZoom)
    return {
      zoom: z,
    }
  }, [maxZoom, minZoom, zoom])
  //#endregion

  //#region Callbacks
  const setIsPressingButton = useCallback(
    (_isPressingButton: boolean) => {
      isPressingButton.value = _isPressingButton
    },
    [isPressingButton],
  )
  const onError = useCallback((error: CameraRuntimeError) => {
    console.error(error)
  }, [])
  const onInitialized = useCallback(() => {
    console.log('Camera initialized!')
    setIsCameraInitialized(true)
  }, [])
  const onMediaCaptured = useCallback(
    (media: PhotoFile | VideoFile, type: 'photo' | 'video') => {
      console.log(`Media captured! ${JSON.stringify(media)}`)
      router.push(`/media?path=${encodeURIComponent(media.path)}&type=${type}`)
    },
    [],
  )
  const onFlipCameraPressed = useCallback(() => {
    setCameraPosition((p) => (p === 'back' ? 'front' : 'back'))
  }, [])
  const onFlashPressed = useCallback(() => {
    setFlash((f) => (f === 'off' ? 'on' : 'off'))
  }, [])
  //#endregion

  //#region Tap Gesture
  const onFocusTap = useCallback(
    ({ nativeEvent: event }: GestureResponderEvent) => {
      if (!device?.supportsFocus) return
      camera.current?.focus({
        x: event.locationX,
        y: event.locationY,
      })
    },
    [device?.supportsFocus],
  )
  const onDoubleTap = useCallback(() => {
    onFlipCameraPressed()
  }, [onFlipCameraPressed])
  //#endregion

  //#region Effects
  useEffect(() => {
    // Reset zoom to it's default everytime the `device` changes.
    zoom.value = device?.neutralZoom ?? 1
  }, [zoom, device])
  //#endregion

  //#region Pinch to Zoom Gesture
  // The gesture handler maps the linear pinch gesture (0 - 1) to an exponential curve since a camera's zoom
  // function does not appear linear to the user. (aka zoom 0.1 -> 0.2 does not look equal in difference as 0.8 -> 0.9)
  const onPinchGesture = React.useCallback((event: PinchGestureHandlerGestureEvent) => {
    'worklet'
    // we're trying to map the scale gesture to a linear zoom here
    const scale = interpolate(event.nativeEvent.scale, [1 - 1 / SCALE_FULL_ZOOM, 1, SCALE_FULL_ZOOM], [-1, 0, 1], Extrapolate.CLAMP)
    zoom.value = interpolate(scale, [-1, 0, 1], [minZoom, zoom.value, maxZoom], Extrapolate.CLAMP)
  }, [zoom, minZoom, maxZoom])
  //#endregion

  useEffect(() => {
    const f =
      format != null
        ? `(${format.photoWidth}x${format.photoHeight} photo / ${format.videoWidth}x${format.videoHeight}@${format.maxFps} video @ ${fps}fps)`
        : undefined
    console.log(`Camera: ${device?.name} | Format: ${f}`)
  }, [device?.name, format, fps])

  useEffect(() => {
    location.requestPermission()
  }, [location])


  /* ──────────────────────────────────────────────────────────────────── */
  /*  Shared detections state that the overlay will render               */
  const [detections, setDetections] = useState<Detection[]>([])
  const updateDetectionsJS = useMemo(
    () =>
      Worklets.createRunOnJS((d: Detection[]) => {
        setDetections(d)
      }),
    [],
  )

  const [selected, setSelected] = useState<DetectorName>('efficientdet')
  const { detect, meta, ready } = useDetector(selected, resize)

  //#region FrameProcessor

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet'
    if (!detect || !ready) return

    runAtTargetFps(5, () => {
      const t0 = Date.now()
      const dets = detect(frame, device?.position == 'front')
      // console.log(`[FP] total: ${Date.now() - t0} ms`)
      updateDetectionsJS(dets)
    })
  }, [detect, device])

  //#endregion

  const videoHdr = format?.supportsVideoHdr && enableHdr
  const photoHdr = format?.supportsPhotoHdr && enableHdr && !videoHdr
  // Rotation at which *this* preview is shown
  const o: number = 270      // or use frame.orientation you saved

  // Swap if portrait
  const vW = (o === 90 || o === 270) ? format?.videoHeight ?? 0
    : format?.videoWidth ?? 0
  const vH = (o === 90 || o === 270) ? format?.videoWidth ?? 0
    : format?.videoHeight ?? 0
  // Show permissions screen if permissions are not granted
  if (!cameraPermission.hasPermission || !microphone.hasPermission) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.text}>Camera and microphone permissions are required.</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.push('/permissions')}>
          <Text style={styles.text}>Grant Permissions</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}
      onLayout={e => {
        const { width, height } = e.nativeEvent.layout
        setPreviewSize({ w: width, h: height })
      }}
    >
      {device != null ? (
        <>
          <PinchGestureHandler onGestureEvent={onPinchGesture} enabled={isActive}>
            <Reanimated.View onTouchEnd={onFocusTap} style={StyleSheet.absoluteFill}>
              <TapGestureHandler onEnded={onDoubleTap} numberOfTaps={2}>
                <ReanimatedCamera
                  style={StyleSheet.absoluteFill}
                  device={device}
                  isActive={isActive}
                  ref={camera}
                  onInitialized={onInitialized}
                  onError={onError}
                  onStarted={() => console.log('Camera started!')}
                  onStopped={() => console.log('Camera stopped!')}
                  onPreviewStarted={() => console.log('Preview started!')}
                  onPreviewStopped={() => console.log('Preview stopped!')}
                  onOutputOrientationChanged={(o) => console.log(`Output orientation changed to ${o}!`)}
                  onPreviewOrientationChanged={(o) => console.log(`Preview orientation changed to ${o}!`)}
                  onUIRotationChanged={(degrees) => console.log(`UI Rotation changed: ${degrees}°`)}
                  format={format}
                  fps={fps}
                  photoHdr={photoHdr}
                  videoHdr={videoHdr}
                  photoQualityBalance="quality"
                  lowLightBoost={device.supportsLowLightBoost && enableNightMode}
                  enableZoomGesture={false}
                  animatedProps={cameraAnimatedProps}
                  exposure={0}
                  enableFpsGraph={true}
                  outputOrientation="device"
                  photo={true}
                  video={true}
                  audio={microphone.hasPermission}
                  enableLocation={location.hasPermission}
                  frameProcessor={frameProcessor}
                />
              </TapGestureHandler>
            </Reanimated.View>
          </PinchGestureHandler>

          <BoundingBoxOverlay
            detections={detections}
            viewWidth={previewSize.w}
            viewHeight={previewSize.h}
            videoWidth={vW}
            videoHeight={vH}
            mirrored={cameraPosition === 'front'}
          />
        </>
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.text}>Your phone does not have a Camera.</Text>
        </View>
      )}

      <CaptureButton
        style={[styles.captureButton, { bottom: insets.bottom + CONTENT_SPACING }]}
        camera={camera}
        onMediaCaptured={onMediaCaptured}
        cameraZoom={zoom}
        minZoom={minZoom}
        maxZoom={maxZoom}
        flash={supportsFlash ? flash : 'off'}
        enabled={isCameraInitialized && isActive}
        setIsPressingButton={setIsPressingButton}
      />

      <View style={{ position: 'absolute', top: 90, left: 10, zIndex: 99 }}>
        {DETECTOR_NAMES.map(n => (
          <TouchableOpacity key={n} onPress={() => setSelected(n)}>
            <Text style={{ color: selected === n ? 'lime' : 'white' }}>{n}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.rightButtonRow, { right: insets.right + CONTENT_SPACING, top: insets.top + CONTENT_SPACING }]}>
        <TouchableOpacity style={styles.button} onPress={onFlipCameraPressed} >
          <Ionicons name="camera-reverse" color="white" size={24} />
        </TouchableOpacity>
        {supportsFlash && (
          <TouchableOpacity style={styles.button} onPress={onFlashPressed} >
            <Ionicons name={flash === 'on' ? 'flash' : 'flash-off'} color="white" size={24} />
          </TouchableOpacity>
        )}
        {supports60Fps && (
          <TouchableOpacity style={styles.button} onPress={() => setTargetFps((t) => (t === 30 ? 60 : 30))}>
            <Text style={styles.text}>{`${targetFps}\nFPS`}</Text>
          </TouchableOpacity>
        )}
        {supportsHdr && (
          <TouchableOpacity style={styles.button} onPress={() => setEnableHdr((h) => !h)}>
            <MaterialCommunityIcons name={enableHdr ? 'hdr' : 'hdr-off'} color="white" size={24} />
          </TouchableOpacity>
        )}
        {canToggleNightMode && (
          <TouchableOpacity style={styles.button} onPress={() => setEnableNightMode(!enableNightMode)} >
            <Ionicons name={enableNightMode ? 'moon' : 'moon-outline'} color="white" size={24} />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.button} onPress={() => router.push('/devices')}>
          <Ionicons name="settings-outline" color="white" size={24} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  captureButton: {
    position: 'absolute',
    alignSelf: 'center',
  },
  button: {
    marginBottom: CONTENT_SPACING,
    width: CONTROL_BUTTON_SIZE,
    height: CONTROL_BUTTON_SIZE,
    borderRadius: CONTROL_BUTTON_SIZE / 2,
    backgroundColor: 'rgba(140, 140, 140, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rightButtonRow: {
    position: 'absolute',
  },
  text: {
    color: 'white',
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
})

export default CameraPage
