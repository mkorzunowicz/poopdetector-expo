import React from "react";
import {
  View,
  Text,
  StyleSheet,
} from "react-native";
import { useTheme } from "@/styles/ThemeContext";
import { Ionicons } from "@expo/vector-icons";

import { tr } from "@/i18n/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";

export default function SettingsScreen() {
  const { theme } = useTheme();
  const styles = getStyles(theme);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{tr("Screens.settings")}</Text>
      </View>

      {/* Language Section */}
      <View style={styles.menuSection}>
        <View style={styles.sectionContainer}>
          <View style={styles.menuItem}>
            <View style={styles.menuItemLeft}>
              <View style={styles.iconContainer}>
                <Ionicons name="language" size={20} color={theme.colors.textPrimary} />
              </View>
              <LanguageSelector />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const getStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.backgroundQuaternary,
    },
    header: {
      alignItems: 'center',
      paddingTop: 60,
      paddingBottom: 30,
      paddingHorizontal: 20,
    },
    title: {
      fontSize: 24,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    menuSection: {
      marginBottom: 32,
      paddingHorizontal: 20,
    },
    sectionContainer: {
      backgroundColor: theme.colors.backgroundSecondary,
      borderRadius: 12,
      overflow: 'hidden',
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    menuItemLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    iconContainer: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: theme.colors.backgroundTertiary,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
  });
