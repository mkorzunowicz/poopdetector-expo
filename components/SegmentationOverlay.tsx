import type { Detection } from "@/ai/detectors/types";
import type { SamPoint } from "@/ai/mobileSamPhoto";
import React, { useMemo } from "react";
import { StyleSheet } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

export interface ImageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  imageRect: ImageRect | null;
  photoSize: { width: number; height: number };
  maskData: {
    binaryMask: Uint8Array;
    maskWidth: number;
    maskHeight: number;
  } | null;
  // Every significant closed contour from maskToPolygon -- outer object
  // boundaries and holes both, unclassified. Rendered as one Path with
  // fillRule="evenodd", which fills by nesting parity (even depth = solid,
  // odd depth = hole) automatically, so holes punch out and multiple
  // disconnected objects render side by side with no classification needed
  // here. See ai/mobileSamPhoto.ts's maskToPolygon.
  polygons: Array<Array<{ x: number; y: number }>>;
  detections: Detection[];
  points: SamPoint[];
}

// Draws everything SAM/the detector found on top of the photo: the raw mask
// fill (row-run rectangles, always accurate even where the polygon can't
// represent something -- mirrors the reference C# app's bitmap-mask-first
// approach), detection boxes, the mask outline polygon(s), and tap markers.
export const SegmentationOverlay = React.memo(
  ({ imageRect, photoSize, maskData, polygons, detections, points }: Props) => {
    const polygonPathData = useMemo(() => {
      if (
        !imageRect ||
        photoSize.width <= 0 ||
        photoSize.height <= 0 ||
        polygons.length === 0
      ) {
        return "";
      }

      return polygons
        .filter((polygon) => polygon.length >= 3)
        .map((polygon) =>
          polygon
            .map((point, index) => {
              const screenX =
                imageRect.x + (point.x / photoSize.width) * imageRect.width;
              const screenY =
                imageRect.y + (point.y / photoSize.height) * imageRect.height;
              return `${index === 0 ? "M" : "L"}${screenX},${screenY}`;
            })
            .concat("Z")
            .join(" "),
        )
        .join(" ");
    }, [imageRect, photoSize.height, photoSize.width, polygons]);

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

    return (
      <Svg style={StyleSheet.absoluteFill}>
        {imageRect &&
          maskData &&
          maskRuns.map((run, index) => (
            <Rect
              key={`mask-run-${index}`}
              x={imageRect.x + (run.x / maskData.maskWidth) * imageRect.width}
              y={imageRect.y + (run.y / maskData.maskHeight) * imageRect.height}
              width={(run.width / maskData.maskWidth) * imageRect.width}
              height={(1 / maskData.maskHeight) * imageRect.height + 0.5}
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

        {polygonPathData.length > 0 && (
          <Path
            d={polygonPathData}
            fillRule="evenodd"
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
    );
  },
);
