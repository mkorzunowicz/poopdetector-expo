# Poop Detector 💩

A real-time AI-powered object detection app built with React Native and Expo that uses YoloX models to detect objects through your device camera.

## What it does

- **Real-time camera detection**: Uses your device camera to detect objects in real-time
- **AI-powered detection**: Leverages optimized YoloX TensorFlow Lite models for fast and accurate detection  
- **Save detections**: Capture and save images (no bounding boxes or SAM saved)
- **Multi-model support**: Switch between different detection models right in the app by clicking it's name
- **Cross-platform**: Works on both iOS and Android with native performance optimizations

## AI Models

The app uses pre-trained YoloX models from the [tflite_models repository](https://github.com/mkorzunowicz/tflite_models/releases/tag/tflite2):

Put the models into **./assets** directory. Remote download should be supported by the tflite library, but it didn't work yet. I'll see if I can get an alternative way to work.

Currently hardcoded:
- **YoloX Nano Poop**: YoloX Nano 416 old model dated 2024
- **ShitSpotter v5**: Erotemic's YoloX recent 640 model

## Installation & Setup

### Prerequisites

- Node.js (v18 or higher)
- npm
- For iOS: Xcode and iOS Simulator
- For Android: Android Studio and Android SDK

### Install Dependencies

```bash
npm install
```

This will automatically:
- Install all React Native and Expo dependencies
- Apply necessary patches for iOS/Android compatibility via `patch-package`
- Set up TensorFlow Lite and camera plugins

### Development Scripts

#### Run on Specific Platforms
```bash
# iOS
npx expo run:ios

# Android
npx expo run:android

# web isn't supported
```

## Platform Support

### iOS
- Uses CoreML delegate for optimized inference
- Native YoloX postprocessing in C++
- Supports all device orientations
- Requires camera and photo library permissions

### Android  
- Uses GPU delegate for accelerated inference
- Native YoloX postprocessing in C++
- Optimized memory management
- Requires camera and storage permissions

## Technical Features

- **Worklet-based frame processing**: Ultra-fast camera frame processing using React Native Worklets
- **Native TensorFlow Lite**: Custom patches for optimized model inference 
- **Adaptive frame rates**: Dynamic FPS adjustment based on performance
- **Memory optimization**: Efficient tensor operations and garbage collection
- **Multi-threading**: Background model loading and inference

## Performance

iOS (iPhone 15): detection takes 30ms (nano 416), 50ms shitspotter

Android (Samsung S10): 100ms (nano 416), 300ms shitspotter

## Architecture

```
app/
├── (tabs)/           # Tab navigation screens
├── ai/
│   ├── detectors/    # YoloX detection implementations
├── components/       # Reusable UI components  
├── hooks/            # Custom React hooks
├── services/         # App services and utilities
├── i18n/             # Translations
└── styles/           # Themes and styling

patches/              # Platform compatibility patches
assets/               # Model files and images
```

## Permissions Required

The app requires the following permissions:

**iOS (Info.plist)**:
- `NSCameraUsageDescription`: Camera access for real-time detection
- `NSMicrophoneUsageDescription`: Microphone access for video recording
- `NSPhotoLibraryUsageDescription`: Photo library access for saving images

**Android (AndroidManifest.xml)**:
- `CAMERA`: Camera access for detection
- `RECORD_AUDIO`: Audio recording for videos
- `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE`: File storage access

## Development Notes

The app includes custom patches for:
- **vision-camera-resize-plugin**: Maintains [0-255] float32 range for consistent model input
- **react-native-fast-tflite**: Adds native YoloX postprocessing for both iOS and Android

These patches are automatically applied via `patch-package` during `npm install`.
