import { captureRef } from "react-native-view-shot";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";

/**
 * Capture a screenshot of a view reference
 * @param viewRef Reference to the view to capture
 * @returns URI of the captured screenshot
 */
export async function captureScreenshot(
  viewRef: any
): Promise<string | null> {
  try {
    if (!viewRef || !viewRef.current) {
      console.error("Invalid view reference for screenshot");
      return null;
    }

    const uri = await captureRef(viewRef, {
      format: "jpg",
      quality: 0.8,
    });

    return uri;
  } catch (error) {
    console.error("Error capturing screenshot:", error);
    return null;
  }
}

/**
 * Take a screenshot of the entire screen (requires ViewShot wrapper)
 * Alternative approach using canvas for web
 */
export async function captureScreenshotFromRoot(
  rootViewRef: any
): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      // For web, we could use html2canvas library
      // For now, return null as it requires additional setup
      console.log("Web screenshot capture not implemented yet");
      return null;
    }

    return await captureScreenshot(rootViewRef);
  } catch (error) {
    console.error("Error capturing root screenshot:", error);
    return null;
  }
}

/**
 * Save screenshot to temporary directory
 */
export async function saveScreenshotToTemp(
  uri: string
): Promise<string | null> {
  try {
    const filename = `feedback-screenshot-${Date.now()}.jpg`;
    const tempUri = `${FileSystem.cacheDirectory}${filename}`;

    await FileSystem.copyAsync({
      from: uri,
      to: tempUri,
    });

    return tempUri;
  } catch (error) {
    console.error("Error saving screenshot:", error);
    return null;
  }
}
