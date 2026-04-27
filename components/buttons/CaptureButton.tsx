import React, { useCallback, useRef } from "react";
import type { ViewProps } from "react-native";
import { StyleSheet, View } from "react-native";
import type { TapGestureHandlerStateChangeEvent } from "react-native-gesture-handler";
import { State, TapGestureHandler } from "react-native-gesture-handler";
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";

// Constants
const CAPTURE_BUTTON_SIZE = 78;
const START_RECORDING_DELAY = 200;
const BORDER_WIDTH = CAPTURE_BUTTON_SIZE * 0.1;

interface Props extends ViewProps {
  onTakePhoto: () => Promise<void>;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<void>;
  enabled: boolean;
}

const _CaptureButton: React.FC<Props> = ({
  onTakePhoto,
  onStartRecording,
  onStopRecording,
  enabled,
  style,
  ...props
}): React.ReactElement => {
  const pressDownDate = useRef<Date | undefined>(undefined);
  const isRecording = useRef(false);
  const isPressingButton = useSharedValue(false);

  //#region Camera Capture
  const takePhoto = useCallback(async () => {
    try {
      console.log("Taking photo...");
      await onTakePhoto();
    } catch (e) {
      console.error("Failed to take photo!", e);
    }
  }, [onTakePhoto]);

  const onStoppedRecording = useCallback(() => {
    isRecording.current = false;
    console.log("stopped recording video!");
  }, []);

  const stopRecording = useCallback(async () => {
    if (!isRecording.current) return;

    try {
      console.log("calling stopRecording()...");
      await onStopRecording();
      console.log("called stopRecording()!");
    } catch (e) {
      console.error("failed to stop recording!", e);
    } finally {
      onStoppedRecording();
    }
  }, [onStopRecording, onStoppedRecording]);

  const startRecording = useCallback(async () => {
    try {
      console.log("calling startRecording()...");
      isRecording.current = true;
      await onStartRecording();
      console.log("called startRecording()!");
    } catch (e) {
      isRecording.current = false;
      console.error("failed to start recording!", e, "camera");
    }
  }, [onStartRecording]);
  //#endregion

  //#region Tap handler
  const tapHandler = useRef<TapGestureHandler>(null);
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
      console.debug(`state: ${Object.keys(State)[event.state]}`);
      switch (event.state) {
        case State.BEGAN: {
          // enter "recording mode"
          isPressingButton.value = true;
          const now = new Date();
          pressDownDate.current = now;
          setTimeout(() => {
            if (pressDownDate.current === now) {
              // user is still pressing down after 200ms, so his intention is to create a video
              void startRecording();
            }
          }, START_RECORDING_DELAY);
          return;
        }
        case State.END:
        case State.FAILED:
        case State.CANCELLED: {
          // exit "recording mode"
          try {
            if (pressDownDate.current == null)
              throw new Error("PressDownDate ref .current was null!");
            const now = new Date();
            const diff = now.getTime() - pressDownDate.current.getTime();
            pressDownDate.current = undefined;
            if (diff < START_RECORDING_DELAY) {
              // user has released the button within 200ms, so his intention is to take a single picture.
              await takePhoto();
            } else {
              // user has held the button for more than 200ms, so he has been recording this entire time.
              await stopRecording();
            }
          } finally {
            setTimeout(() => {
              isPressingButton.value = false;
            }, 500);
          }
          return;
        }
        default:
          break;
      }
    },
    [isPressingButton, startRecording, stopRecording, takePhoto],
  );
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
  );
  const buttonStyle = useAnimatedStyle(() => {
    let scale: number;
    if (enabled) {
      if (isPressingButton.value) {
        scale = withRepeat(
          withSpring(1, {
            stiffness: 100,
            damping: 1000,
          }),
          -1,
          true,
        );
      } else {
        scale = withSpring(0.9, {
          stiffness: 500,
          damping: 300,
        });
      }
    } else {
      scale = withSpring(0.6, {
        stiffness: 500,
        damping: 300,
      });
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
    };
  }, [enabled, isPressingButton]);

  return (
    <TapGestureHandler
      enabled={enabled}
      ref={tapHandler}
      onHandlerStateChange={onHandlerStateChanged}
      shouldCancelWhenOutside={false}
      maxDurationMs={99999999}
    >
      <Reanimated.View {...props} style={[buttonStyle, style]}>
        <Reanimated.View style={styles.flex}>
          <Reanimated.View style={[styles.shadow, shadowStyle]} />
          <View style={styles.button} />
        </Reanimated.View>
      </Reanimated.View>
    </TapGestureHandler>
  );
};

export const CaptureButton = React.memo(_CaptureButton);

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  shadow: {
    position: "absolute",
    width: CAPTURE_BUTTON_SIZE,
    height: CAPTURE_BUTTON_SIZE,
    borderRadius: CAPTURE_BUTTON_SIZE / 2,
    backgroundColor: "#e34077",
  },
  button: {
    width: CAPTURE_BUTTON_SIZE,
    height: CAPTURE_BUTTON_SIZE,
    borderRadius: CAPTURE_BUTTON_SIZE / 2,
    borderWidth: BORDER_WIDTH,
    borderColor: "white",
  },
});
