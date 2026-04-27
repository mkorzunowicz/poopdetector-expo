import { ConfigContext, ExpoConfig } from "expo/config";

type VisionCameraPluginProps = {
  cameraPermissionText?: string;
  microphonePermissionText?: string;
  enableCodeScanner?: boolean;
  enableFrameProcessors?: boolean;
};

function withVisionCamera(
  config: ExpoConfig,
  props: VisionCameraPluginProps = {},
): ExpoConfig {
  const { cameraPermissionText, microphonePermissionText } = props;

  config.ios ??= {};
  config.ios.infoPlist ??= {};

  if (cameraPermissionText != null) {
    config.ios.infoPlist.NSCameraUsageDescription = cameraPermissionText;
  }
  if (microphonePermissionText != null) {
    config.ios.infoPlist.NSMicrophoneUsageDescription =
      microphonePermissionText;
  }

  config.android ??= {};
  config.android.permissions = Array.from(
    new Set([
      ...(config.android.permissions ?? []),
      "android.permission.CAMERA",
      ...(microphonePermissionText != null
        ? ["android.permission.RECORD_AUDIO"]
        : []),
    ]),
  );

  return config;
}

export default ({ config }: ConfigContext): ExpoConfig =>
  withVisionCamera(
    {
      ...config,
      name: "Poop Detector",
      slug: "poop-detector",
      version: "1.0.0",
      orientation: "portrait",
      icon: "./assets/images/icon2.png",
      scheme: "poop-detector",
      userInterfaceStyle: "automatic",
      owner: "ugs",
      newArchEnabled: true,
      ios: {
        supportsTablet: true,
        bundleIdentifier: "com.ugs.poopdetector",
        infoPlist: {
          NSCameraUsageDescription:
            "This app needs access to your camera to take photos for poop detection.",
          NSMicrophoneUsageDescription:
            "This app needs access to your microphone to record audio with videos.",
          NSPhotoLibraryUsageDescription:
            "This app needs access to your photo library to select photos.",
          NSPhotoLibraryAddUsageDescription:
            "This app needs access to save photos to your photo library.",
        },
      },
      android: {
        softwareKeyboardLayoutMode: "pan",
        adaptiveIcon: {
          foregroundImage: "./assets/images/icon2.png",
        },
        package: "com.ugs.poopdetector",
        permissions: [
          "android.permission.CAMERA",
          "android.permission.READ_EXTERNAL_STORAGE",
          "android.permission.WRITE_EXTERNAL_STORAGE",
          "android.permission.READ_MEDIA_IMAGES",
          "android.permission.RECORD_AUDIO",
        ],
      },
      web: {
        bundler: "metro",
        output: "single",
        favicon: "./assets/images/favicon.png",
      },
      plugins: [
        "expo-router",
        [
          "expo-image-picker",
          {
            photosPermission: "This app needs access to your photos.",
            cameraPermission:
              "This app needs access to your camera for poop detection.",
          },
        ],
        [
          "expo-media-library",
          {
            photosPermission:
              "Allow Poop Detector to save photos to your gallery.",
            savePhotosPermission:
              "Allow Poop Detector to save photos to your gallery.",
            isAccessMediaLocationEnabled: true,
          },
        ],
        [
          "expo-splash-screen",
          {
            ios: {
              backgroundColor: "#000",
              image: "./assets/images/detector-splash.png",
              resizeMode: "cover",
            },
            android: {
              backgroundColor: "#000",
              image: "./assets/images/detector-splash.png",
              imageWidth: 400,
            },
          },
        ],
        [
          "expo-build-properties",
          {
            android: {
              minSdkVersion: 26,
            },
          },
        ],
        "expo-localization",
        [
          "react-native-fast-tflite",
          {
            enableCoreMLDelegate: true,
            enableAndroidGpuLibraries: true,
          },
        ],
      ],
      experiments: {
        typedRoutes: true,
      },
      extra: {
        router: {},
        scheme: "poop-detector",
      },
    },
    {
      cameraPermissionText:
        "This app needs access to your camera for poop detection.",
      microphonePermissionText:
        "This app needs access to your microphone to record audio with videos.",
      enableCodeScanner: false,
      enableFrameProcessors: true,
    },
  );
