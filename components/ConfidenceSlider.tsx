import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from "react-native";

/**
 * Confidence threshold slider for the live detector.
 *
 * Built on PanResponder from react-native core rather than
 * @react-native-community/slider deliberately: that package needs a native
 * rebuild, and this exists to be adjusted in the field between shots. A JS
 * reload is enough for this one.
 *
 * The detector itself runs at a LOW fixed floor and this only filters what is
 * drawn, so dragging is instant -- no model reload, and the last frame re-filters
 * immediately rather than waiting for the next inference at 3-10 FPS.
 */
export const ConfidenceSlider: React.FC<{
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** rounding step -- 0.05 keeps the readout legible while dragging */
  step?: number;
  detectionCount?: number;
  hiddenCount?: number;
}> = ({
  value,
  onChange,
  min = 0.05,
  max = 0.9,
  step = 0.05,
  detectionCount,
  hiddenCount,
}) => {
  const [width, setWidth] = useState(0);
  // PanResponder is created once, so its callbacks close over the FIRST render's
  // props. Mirroring them into refs keeps the handlers reading current values
  // instead of stale ones -- otherwise dragging would always compute from the
  // width and callback captured at mount.
  const widthRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const clampToStep = useCallback(
    (raw: number) => {
      const clamped = Math.max(min, Math.min(max, raw));
      return Math.round(clamped / step) * step;
    },
    [min, max, step],
  );

  const setFromX = useCallback(
    (x: number) => {
      const w = widthRef.current;
      if (w <= 0) return;
      const fraction = Math.max(0, Math.min(1, x / w));
      onChangeRef.current(clampToStep(min + fraction * (max - min)));
    },
    [clampToStep, min, max],
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Claim the gesture so the camera's pinch-zoom handler does not steal it.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => setFromX(e.nativeEvent.locationX),
        onPanResponderMove: (e) => setFromX(e.nativeEvent.locationX),
      }),
    [setFromX],
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setWidth(w);
  }, []);

  const fraction = (value - min) / (max - min);
  const thumbLeft = width > 0 ? fraction * width : 0;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.labelRow} pointerEvents="none">
        <Text style={styles.label}>conf {value.toFixed(2)}</Text>
        {detectionCount != null && (
          <Text style={styles.count}>
            {detectionCount} shown
            {hiddenCount ? `  (+${hiddenCount} below)` : ""}
          </Text>
        )}
      </View>
      <View
        style={styles.track}
        onLayout={onLayout}
        {...responder.panHandlers}
        // Generous hit area: this gets used one-handed, outdoors.
        hitSlop={{ top: 16, bottom: 16, left: 8, right: 8 }}
      >
        <View style={[styles.fill, { width: thumbLeft }]} />
        <View style={[styles.thumb, { left: Math.max(0, thumbLeft - 11) }]} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 4,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 6,
  },
  label: {
    color: "white",
    fontSize: 13,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 3,
  },
  count: {
    color: "white",
    fontSize: 11,
    opacity: 0.85,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 3,
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.28)",
    justifyContent: "center",
  },
  fill: {
    position: "absolute",
    left: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#7DD3F8",
  },
  thumb: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "white",
    borderWidth: 2,
    borderColor: "#7DD3F8",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 4,
  },
});
