import React, { useCallback, useRef } from 'react'
import type { ViewProps } from 'react-native'
import { StyleSheet, View } from 'react-native'
import type { TapGestureHandlerStateChangeEvent } from 'react-native-gesture-handler'
import { PanGestureHandler, State, TapGestureHandler } from 'react-native-gesture-handler'
import Reanimated, {
  cancelAnimation,
  Easing,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming
} from 'react-native-reanimated'
import type { Camera, PhotoFile, VideoFile } from 'react-native-vision-camera'

// Constants
const CAPTURE_BUTTON_SIZE = 78
const START_RECORDING_DELAY = 200
const BORDER_WIDTH = CAPTURE_BUTTON_SIZE * 0.1

interface Props extends ViewProps {
  camera: React.RefObject<Camera | null>
  onMediaCaptured: (media: PhotoFile | VideoFile, type: 'photo' | 'video') => void

  minZoom: number
  maxZoom: number
  cameraZoom: SharedValue<number>

  flash: 'off' | 'on'

  enabled: boolean

  setIsPressingButton: (isPressingButton: boolean) => void
}

const _CaptureButton: React.FC<Props> = ({
  camera,
  onMediaCaptured,
  minZoom,
  maxZoom,
  cameraZoom,
  flash,
  enabled,
  setIsPressingButton,
  style,
  ...props
}): React.ReactElement => {
  const pressDownDate = useRef<Date | undefined>(undefined)
  const isRecording = useRef(false)
  const recordingProgress = useSharedValue(0)
  const isPressingButton = useSharedValue(false)

  //#region Camera Capture
  const takePhoto = useCallback(async () => {
    try {
      if (camera.current == null) throw new Error('Camera ref is null!')

      console.log('Taking photo...')
      const photo = await camera.current.takePhoto({
        flash: flash,
        enableShutterSound: false,
      })
      onMediaCaptured(photo, 'photo')
    } catch (e) {
      console.error('Failed to take photo!', e)
    }
  }, [camera, flash, onMediaCaptured])

  const onStoppedRecording = useCallback(() => {
    isRecording.current = false
    cancelAnimation(recordingProgress)
    console.log('stopped recording video!')
  }, [recordingProgress])
  const stopRecording = useCallback(async () => {
    try {
      if (camera.current == null) throw new Error('Camera ref is null!')

      console.log('calling stopRecording()...')
      await camera.current.stopRecording()
      console.log('called stopRecording()!')
    } catch (e) {
      console.error('failed to stop recording!', e)
    }
  }, [camera])
  const startRecording = useCallback(() => {
    try {
      if (camera.current == null) throw new Error('Camera ref is null!')

      console.log('calling startRecording()...')
      camera.current.startRecording({
        flash: flash,
        onRecordingError: (error) => {
          console.error('Recording failed!', error)
          onStoppedRecording()
        },
        onRecordingFinished: (video) => {
          console.log(`Recording successfully finished! ${video.path}`)
          onMediaCaptured(video, 'video')
          onStoppedRecording()
        },
      })
      // TODO: wait until startRecording returns to actually find out if the recording has successfully started
      console.log('called startRecording()!')
      isRecording.current = true
    } catch (e) {
      console.error('failed to start recording!', e, 'camera')
    }
  }, [camera, flash, onMediaCaptured, onStoppedRecording])
  //#endregion

  //#region Tap handler
  const tapHandler = useRef<TapGestureHandler>(null)
  const onHandlerStateChanged = useCallback(
    async ({ nativeEvent: event }: TapGestureHandlerStateChangeEvent) => {
      // This is the gesture handler for the circular "shutter" button.
      // Once the finger touches the button (State.BEGAN), a photo is being taken and "capture mode" is entered. (disabled tab bar)
      // Also, we set `pressDownDate` to the time of the press down event, and start a 200ms timeout. If the `pressDownDate` hasn't changed
      // after the 200ms, the user is still holding down the "shutter" button. In that case, we start recording.
      //
      // Once the finger releases the button (State.END/FAILED/CANCELLED), we leave "capture mode" (enable tab bar) and check the `pressDownDate`,
      // if `pressDownDate` was less than 200ms ago, we know that the intention of the user is to take a photo. We check the `takePhotoPromise` if
      // there already is an ongoing (or already resolved) takePhoto() call (remember that we called takePhoto() when the user pressed down), and
      // if yes, use that. If no, we just try calling takePhoto() again
      console.debug(`state: ${Object.keys(State)[event.state]}`)
      switch (event.state) {
        case State.BEGAN: {
          // enter "recording mode"
          recordingProgress.value = 0
          isPressingButton.value = true
          const now = new Date()
          pressDownDate.current = now
          setTimeout(() => {
            if (pressDownDate.current === now) {
              // user is still pressing down after 200ms, so his intention is to create a video
              startRecording()
            }
          }, START_RECORDING_DELAY)
          setIsPressingButton(true)
          return
        }
        case State.END:
        case State.FAILED:
        case State.CANCELLED: {
          // exit "recording mode"
          try {
            if (pressDownDate.current == null) throw new Error('PressDownDate ref .current was null!')
            const now = new Date()
            const diff = now.getTime() - pressDownDate.current.getTime()
            pressDownDate.current = undefined
            if (diff < START_RECORDING_DELAY) {
              // user has released the button within 200ms, so his intention is to take a single picture.
              await takePhoto()
            } else {
              // user has held the button for more than 200ms, so he has been recording this entire time.
              await stopRecording()
            }
          } finally {
            setTimeout(() => {
              isPressingButton.value = false
              setIsPressingButton(false)
            }, 500)
          }
          return
        }
        default:
          break
      }
    },
    [isPressingButton, recordingProgress, setIsPressingButton, startRecording, stopRecording, takePhoto],
  )
  //#endregion
  //#region Pan handler
  const panHandler = useRef<PanGestureHandler>(null)
  // For pan gesture, we'll use simplified inline handler
  //#endregion

  const shadowStyle = useAnimatedStyle(
    () => ({
      transform: [
        {
          scale: withSpring(isPressingButton.value ? 1 : 0, {
            mass: 1,
            damping: 35,
            stiffness: 300,
          }),
        },
      ],
    }),
    [isPressingButton],
  )
  const buttonStyle = useAnimatedStyle(() => {
    let scale: number
    if (enabled) {
      if (isPressingButton.value) {
        scale = withRepeat(
          withSpring(1, {
            stiffness: 100,
            damping: 1000,
          }),
          -1,
          true,
        )
      } else {
        scale = withSpring(0.9, {
          stiffness: 500,
          damping: 300,
        })
      }
    } else {
      scale = withSpring(0.6, {
        stiffness: 500,
        damping: 300,
      })
    }

    return {
      opacity: withTiming(enabled ? 1 : 0.3, {
        duration: 100,
        easing: Easing.linear,
      }),
      transform: [
        {
          scale: scale,
        },
      ],
    }
  }, [enabled, isPressingButton])

  return (
    <TapGestureHandler
      enabled={enabled}
      ref={tapHandler}
      onHandlerStateChange={onHandlerStateChanged}
      shouldCancelWhenOutside={false}
      maxDurationMs={99999999}>
      <Reanimated.View {...props} style={[buttonStyle, style]}>
        <Reanimated.View style={styles.flex}>
          <Reanimated.View style={[styles.shadow, shadowStyle]} />
          <View style={styles.button} />
        </Reanimated.View>
      </Reanimated.View>
    </TapGestureHandler>
  )
}

export const CaptureButton = React.memo(_CaptureButton)

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  shadow: {
    position: 'absolute',
    width: CAPTURE_BUTTON_SIZE,
    height: CAPTURE_BUTTON_SIZE,
    borderRadius: CAPTURE_BUTTON_SIZE / 2,
    backgroundColor: '#e34077',
  },
  button: {
    width: CAPTURE_BUTTON_SIZE,
    height: CAPTURE_BUTTON_SIZE,
    borderRadius: CAPTURE_BUTTON_SIZE / 2,
    borderWidth: BORDER_WIDTH,
    borderColor: 'white',
  },
})
