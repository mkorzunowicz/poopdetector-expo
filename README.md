# Poop Detector 💩

A real-time AI-powered object detection app built with React Native and Expo that uses YoloX models to detect objects through your device camera.

## What it does

- **Real-time camera detection**: Uses your device camera to detect objects in real-time
- **AI-powered detection**: Leverages optimized YoloX TensorFlow Lite models for fast and accurate detection. Quantized models didn't work yet. Not sure we can gain here anything, but needs further testing.
- **Save detections**: Capture and save images (no bounding boxes included, SAM not implemented)
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

## Building Release Versions

To create standalone builds that don't require the Expo development server:

### iOS Release Build

#### Option 1: Development Build (Recommended)
```bash
# Build and install development build on device
npx expo run:ios --device --configuration Release

# Or build for specific device
npx expo run:ios --device "Your Device Name" --configuration Release
```

#### Option 2: EAS Build (Cloud Build)
```bash
# Install EAS CLI
npm install -g @expo/eas-cli

# Login to Expo account
eas login

# Configure build
eas build:configure

# Build for iOS
eas build --platform ios
```

### Android Release Build

#### Option 1: Local APK Build
```bash
# Build release APK
npx expo run:android --variant release

# Or build AAB for Play Store
cd android && ./gradlew bundleRelease
```

#### Option 2: EAS Build (Cloud Build)
```bash
# Build for Android
eas build --platform android

# Build both platforms
eas build --platform all
```

### Build Configuration

For production builds, consider updating `app.config.ts`:

```typescript
export default ({ config }: ConfigContext): ExpoConfig => ({
  // ... existing config
  extra: {
    eas: {
      projectId: "your-project-id"
    }
  }
})
```

### Release Notes

- **Development builds** include all native code and run independently
- **EAS builds** are recommended for App Store/Play Store distribution  
- **Local builds** are faster but require proper development environment setup
- All builds include the necessary TensorFlow Lite models and patches

## Platform Support

### iOS
- Uses CoreML delegate for optimized inference
- Native YoloX postprocessing in C++

### Android  
- Uses GPU delegate for accelerated inference, fallsback to CPU if not supported
- Native YoloX postprocessing in C++

## Technical Features

- **Worklet-based frame processing**: Ultra-fast camera frame processing using React Native Worklets
- **Native TensorFlow Lite**: Custom patches for optimized model inference 
- **Adaptive frame rates**: Dynamic FPS adjustment based on performance

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

## Development Notes

The app includes custom patches for:
- **vision-camera-resize-plugin**: Maintains [0-255] float32 range for consistent model input
- **react-native-fast-tflite**: Adds native YoloX postprocessing for both iOS and Android

These patches are automatically applied via `patch-package` during `npm install`.
