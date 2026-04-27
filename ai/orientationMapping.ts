import type { CameraOrientation } from "react-native-vision-camera";

/* orientationMapping.ts */
export function toDegrees(o: CameraOrientation): 0 | 90 | 180 | 270 {
  "worklet";
  switch (o) {
    case "up":
      return 0;
    case "left":
      return 90;
    case "down":
      return 180;
    case "right":
      return 270;
    default:
      return 0;
  }
}
