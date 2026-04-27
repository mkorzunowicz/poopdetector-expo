import { Detection } from "@/ai/detectors/types";
import React from "react";
import { StyleSheet } from "react-native";
import Svg, { Rect, Text as SvgText } from "react-native-svg";

interface Props {
  detections: Detection[];
  viewWidth: number;
  viewHeight: number;
}

export const BoundingBoxOverlay = React.memo(
  ({ detections, viewWidth, viewHeight }: Props) => {
    // Universal bounding box overlay - expects normalized [0,1] coordinates
    // The detector should handle all transformations and output screen-relative coordinates

    const mapX = (x: number) => x * viewWidth;
    const mapY = (y: number) => y * viewHeight;

    return (
      <>
        <Svg
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        >
          {detections.map((d, i) => {
            const x1 = mapX(d.x1);
            const x2 = mapX(d.x2);
            const y1 = mapY(d.y1);
            const y2 = mapY(d.y2);
            const x = Math.min(x1, x2);
            const y = Math.min(y1, y2);
            const w = Math.abs(x2 - x1);
            const h = Math.abs(y2 - y1);

            return (
              <React.Fragment key={i}>
                <Rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  stroke={d.color ?? "lime"}
                  strokeWidth={2}
                  fill="none"
                />
                <SvgText
                  x={x}
                  y={Math.max(12, y - 4)}
                  fill={d.color ?? "lime"}
                  fontSize="14"
                  fontWeight="bold"
                >
                  {d.label ?? d.classId} {Math.round(d.score * 100)}% (
                  {Math.round(x)},{Math.round(y)}) {Math.round(w)}x
                  {Math.round(h)}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      </>
    );
  },
);
