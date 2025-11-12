import { Detection } from '@/ai/detectors/types'
import React from 'react'
import { StyleSheet } from 'react-native'
import Svg, { Rect, Text as SvgText } from 'react-native-svg'

interface Props {
  detections: Detection[]
  viewWidth: number
  viewHeight: number
  videoWidth: number
  videoHeight: number
  mirrored: boolean
}

export const BoundingBoxOverlay = React.memo(
  ({
    detections,
    viewWidth,
    viewHeight,
    videoWidth,
    videoHeight,
    mirrored,
  }: Props) => {
    // if (detections[0]) {
    //   var det = detections[0];
    //   console.log(`${det.label} x1 ${det.x1} x2 ${det.x2} y1 ${det.y2} y2 ${det.y2}`)
    // }

    // 1. aspect-ratio fit (same math React-Native uses for resizeMode="cover")
    // const videoRatio = videoWidth / videoHeight
    // const viewRatio = viewWidth / viewHeight

    // // console.log(`vid ${videoRatio} view ${viewRatio}`)
    // // let scale = 1
    // let xOffset = 0
    // let yOffset = 0


    // var scaleX = viewWidth / videoWidth;
    // var scaleY = viewHeight / videoHeight;
    // var scale = Math.min(scaleX, scaleY);
    // var offsetX = (viewWidth - (videoWidth * scaleX)) / 2;
    // var offsetY = (viewHeight - (videoHeight * scaleY)) / 2;
    // // var det = detections.find(d => d.label == "cell phone");
    
    // console.log(`h ${Math.ceil(viewHeight)} w ${Math.ceil(viewWidth)} hv ${videoHeight} wv ${videoWidth} oX ${offsetX} oY ${offsetY} s ${scale}`)
    // offsetX = 0;
    // offsetY = 0;
    // if (viewRatio > videoRatio) {
    //   // video fills the height → pillar-box left/right
    //   // scale = viewHeight / videoHeight
    //   scale = viewWidth / videoWidth
    //   // xOffset = (viewWidth - videoWidth * scaleX) / 2
    //   xOffset = (viewWidth - videoWidth * scale) / 2
    // } else {
    //   // video fills the width → letter-box top/bottom
    //   scale = viewWidth / videoWidth
    //   // yOffset = (viewHeight - videoHeight * scaleY) / 2
    //   yOffset = (viewHeight - videoHeight * scale) / 2
    // }
    
    const mapX = (x: number) =>
      // mirrored
        // ? viewWidth - (x * videoWidth * scaleX + offsetX)
        // : x * videoWidth * scaleX + xOffset
        // : 
        x * viewWidth //+ offsetX
    // const mapY = (y: number) => y * videoHeight * scaleY + yOffset
    const mapY = (y: number) => y * viewHeight //+ offsetY

    return (
      <>
        <Svg
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        >
          {detections.map((d, i) => {
            const x = mapX(d.x1)
            const y = mapY(d.y1)
            const w = Math.abs(mapX(d.x2) - x)
            const h = (mapY(d.y2) - y)
            // console.log(`x ${x} y ${y} w ${w} h ${h}`)

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
          {/* <Rect
          x={5}
          y={5}
          width={viewWidth-5}
          height={viewHeight-5}
          stroke='red'
          strokeWidth={5}
          fill="blue"
        /> */}
        </Svg>

        
      </>
    )
  },
)
