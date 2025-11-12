import { Orientation } from "react-native-vision-camera"

/* orientationMapping.ts */
export function toDegrees(o: Orientation): 0 | 90 | 180 | 270 {
    'worklet'
    switch (o) {
      case 'portrait':              return 0           // home‑button bottom
      case 'landscape-left':        return 90          // home‑button left
      case 'portrait-upside-down':  return 180         // home‑button top
      case 'landscape-right':       return 270         // home‑button right
      default: return 0
    }
  }