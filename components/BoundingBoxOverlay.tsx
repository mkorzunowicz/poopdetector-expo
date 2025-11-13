import { Detection } from '@/ai/detectors/types'
import React from 'react'
import { StyleSheet } from 'react-native'
import Svg, { Rect, Text as SvgText } from 'react-native-svg'

interface Props {
  detections: Detection[]
  viewWidth: number
  viewHeight: number
  mirrored: boolean
}

export const BoundingBoxOverlay = React.memo(
  ({
    detections,
    viewWidth,
    viewHeight,
    mirrored,
  }: Props) => {
    
    // Universal bounding box overlay - expects normalized [0,1] coordinates
    // The detector should handle all transformations and output screen-relative coordinates
    
    console.log(`[Overlay] Simple mapping - view: ${viewWidth}x${viewHeight}, mirrored: ${mirrored}`)
    
    const mapX = (x: number) => {
      // Normalized [0,1] coordinate -> screen pixel
      let screenX = x * viewWidth
      // return screenX
      return mirrored ? viewWidth - screenX : screenX
    }
    
    const mapY = (y: number) => {
      // Normalized [0,1] coordinate -> screen pixel
      return y * viewHeight
    }

    return (
      <>
        <Svg
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        >
          {detections.map((d, i) => {
            // For mirrored mode, we need to handle the bounding box differently
            let x, y, w, h
            
            if (mirrored) {
              // When mirrored, flip the entire bounding box
              const x1Screen = mapX(d.x1)  // This flips x1
              const x2Screen = mapX(d.x2)  // This flips x2
              
              // The left edge becomes the smaller of the two flipped coordinates
              x = Math.min(x1Screen, x2Screen)
              w = Math.abs(x2Screen - x1Screen)
            } else {
              // Normal mode - straightforward mapping 
              x = mapX(d.x1)
              w = mapX(d.x2) - x
            }
            
            // Y coordinates are never mirrored
            y = mapY(d.y1)
            h = mapY(d.y2) - y
            
            // Debug: log coordinate transformation
            if (i === 0) {
              console.log(`[Overlay] Detection ${i}: original=[${d.x1.toFixed(3)},${d.y1.toFixed(3)},${d.x2.toFixed(3)},${d.y2.toFixed(3)}] -> screen=[${x.toFixed(1)},${y.toFixed(1)},${w.toFixed(1)},${h.toFixed(1)}] mirrored=${mirrored}`)
            }

            return (
              <React.Fragment key={i}>
                <Rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  stroke={d.color ?? 'lime'}
                  strokeWidth={2}
                  fill="none"
                />
                <SvgText
                  x={x}
                  y={Math.max(12, y - 4)}
                  fill={d.color ?? 'lime'}
                  fontSize="14"
                  fontWeight="bold"
                >
                  {d.label ?? d.classId} {Math.round(d.score * 100)}% ({Math.round(x)},{Math.round(y)}) {Math.round(w)}x{Math.round(h)} 
                </SvgText>
              </React.Fragment>
            )
          })}
        </Svg>

        
      </>
    )
  },
)
