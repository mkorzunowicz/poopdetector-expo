import { CONTENT_SPACING, SAFE_AREA_PADDING } from "@/components/Constants";
import { tr } from "@/i18n/i18n";
import { useTheme } from "@/styles/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect } from "react";
import {
    Linking,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import {
    useCameraPermission,
    useMicrophonePermission,
} from "react-native-vision-camera";

const PermissionsPage: React.FC = () => {
  const { theme } = useTheme();
  const cameraPermission = useCameraPermission();
  const microphonePermission = useMicrophonePermission();
  const shouldOpenSettings =
    cameraPermission.status === "denied" ||
    cameraPermission.status === "restricted" ||
    microphonePermission.status === "denied" ||
    microphonePermission.status === "restricted";

  const requestMicrophonePermission = useCallback(async () => {
    console.log("Requesting microphone permission...");
    const granted = await microphonePermission.requestPermission();
    console.log(`Microphone permission status: ${microphonePermission.status}`);

    if (!granted) await Linking.openSettings();
  }, [microphonePermission]);

  const requestCameraPermission = useCallback(async () => {
    console.log("Requesting camera permission...");
    const granted = await cameraPermission.requestPermission();
    console.log(`Camera permission status: ${cameraPermission.status}`);

    if (!granted) await Linking.openSettings();
  }, [cameraPermission]);

  useEffect(() => {
    if (cameraPermission.hasPermission && microphonePermission.hasPermission) {
      router.replace("/(tabs)");
    }
  }, [cameraPermission.hasPermission, microphonePermission.hasPermission]);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
      paddingTop: SAFE_AREA_PADDING.paddingTop,
      paddingHorizontal: CONTENT_SPACING,
      paddingBottom: SAFE_AREA_PADDING.paddingBottom,
    },
    iconContainer: {
      alignItems: "center",
      marginTop: 60,
      marginBottom: 30,
    },
    welcome: {
      fontSize: 28,
      fontWeight: "bold",
      textAlign: "center",
      marginBottom: 16,
      color: theme.colors.text,
    },
    description: {
      fontSize: 16,
      textAlign: "center",
      color: theme.colors.textSecondary,
      marginBottom: 40,
      lineHeight: 22,
    },
    permissionsContainer: {
      gap: 24,
      marginBottom: 40,
    },
    permissionItem: {
      backgroundColor: theme.colors.backgroundSecondary,
      padding: 20,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    permissionHeader: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 12,
    },
    permissionTitle: {
      fontSize: 18,
      fontWeight: "600",
      marginLeft: 12,
      color: theme.colors.text,
    },
    permissionButton: {
      backgroundColor: theme.colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 8,
      alignItems: "center",
    },
    buttonText: {
      color: theme.colors.white,
      fontSize: 16,
      fontWeight: "600",
    },
    grantedText: {
      color: theme.colors.success,
      fontSize: 16,
      fontWeight: "500",
    },
    settingsContainer: {
      backgroundColor:
        theme.name === "dark" ? "rgba(255, 178, 77, 0.15)" : "#FFF3CD",
      padding: 16,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.warning,
    },
    settingsText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      textAlign: "center",
      marginBottom: 12,
    },
    settingsButton: {
      backgroundColor: theme.colors.warning,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 6,
      alignItems: "center",
    },
  });

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Ionicons
          name="camera-outline"
          size={80}
          color={theme.colors.primary}
        />
      </View>

      <Text style={styles.welcome}>
        {tr("Permissions.cameraPermissionRequired")}
      </Text>
      <Text style={styles.description}>{tr("Permissions.description")}</Text>

      <View style={styles.permissionsContainer}>
        <View style={styles.permissionItem}>
          <View style={styles.permissionHeader}>
            <Ionicons
              name={
                cameraPermission.hasPermission
                  ? "checkmark-circle"
                  : "camera-outline"
              }
              size={24}
              color={
                cameraPermission.hasPermission
                  ? theme.colors.success
                  : theme.colors.primary
              }
            />
            <Text style={styles.permissionTitle}>
              {tr("Permissions.cameraAccess")}
            </Text>
          </View>
          {!cameraPermission.hasPermission && (
            <TouchableOpacity
              style={styles.permissionButton}
              onPress={requestCameraPermission}
            >
              <Text style={styles.buttonText}>
                {tr("Permissions.grantCamera")}
              </Text>
            </TouchableOpacity>
          )}
          {cameraPermission.hasPermission && (
            <Text style={styles.grantedText}>
              {tr("Permissions.cameraGranted")}
            </Text>
          )}
        </View>

        <View style={styles.permissionItem}>
          <View style={styles.permissionHeader}>
            <Ionicons
              name={
                microphonePermission.hasPermission
                  ? "checkmark-circle"
                  : "mic-outline"
              }
              size={24}
              color={
                microphonePermission.hasPermission
                  ? theme.colors.success
                  : theme.colors.primary
              }
            />
            <Text style={styles.permissionTitle}>
              {tr("Permissions.microphoneAccess")}
            </Text>
          </View>
          {!microphonePermission.hasPermission && (
            <TouchableOpacity
              style={styles.permissionButton}
              onPress={requestMicrophonePermission}
            >
              <Text style={styles.buttonText}>
                {tr("Permissions.grantMicrophone")}
              </Text>
            </TouchableOpacity>
          )}
          {microphonePermission.hasPermission && (
            <Text style={styles.grantedText}>
              {tr("Permissions.microphoneGranted")}
            </Text>
          )}
        </View>
      </View>

      {shouldOpenSettings ? (
        <View style={styles.settingsContainer}>
          <Text style={styles.settingsText}>
            {tr("Permissions.deniedMessage")}
          </Text>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => Linking.openSettings()}
          >
            <Text style={styles.buttonText}>
              {tr("Permissions.openSettings")}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

export default PermissionsPage;
