import { useTheme } from "@/styles/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { LanguageSelector } from "@/components/LanguageSelector";
import { useAutoSam } from "@/hooks/useAutoSam";
import { tr } from "@/i18n/i18n";

export default function SettingsScreen() {
  const { theme, currentTheme, toggleTheme } = useTheme();
  const styles = getStyles(theme);
  const [autoSam, setAutoSam] = useAutoSam();

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{tr("Settings.title")}</Text>
      </View>

      {/* Appearance Section */}
      <View style={styles.menuSection}>
        <Text style={styles.sectionTitle}>{tr("Settings.appearance")}</Text>
        <View style={styles.sectionContainer}>
          <TouchableOpacity style={styles.menuItem} onPress={toggleTheme}>
            <View style={styles.menuItemLeft}>
              <View style={styles.iconContainer}>
                <Ionicons 
                  name={currentTheme === 'dark' ? 'moon' : 'sunny'} 
                  size={20} 
                  color={theme.colors.textPrimary} 
                />
              </View>
              <View style={styles.menuItemContent}>
                <Text style={styles.menuItemTitle}>{tr("Settings.theme")}</Text>
                <Text style={styles.menuItemSubtitle}>
                  {currentTheme === 'dark' ? tr("Settings.darkMode") : tr("Settings.lightMode")}
                </Text>
              </View>
            </View>
            <View style={styles.themeToggle}>
              <View style={[
                styles.toggleTrack,
                currentTheme === 'dark' && styles.toggleTrackActive
              ]}>
                <View style={[
                  styles.toggleThumb,
                  currentTheme === 'dark' && styles.toggleThumbActive
                ]} />
              </View>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Detection Section */}
      <View style={styles.menuSection}>
        <Text style={styles.sectionTitle}>{tr("Settings.detection")}</Text>
        <View style={styles.sectionContainer}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => setAutoSam(!autoSam)}
          >
            <View style={styles.menuItemLeft}>
              <View style={styles.iconContainer}>
                <Ionicons
                  name={autoSam ? "scan" : "scan-outline"}
                  size={20}
                  color={theme.colors.textPrimary}
                />
              </View>
              <View style={styles.menuItemContent}>
                <Text style={styles.menuItemTitle}>
                  {tr("Settings.autoSam")}
                </Text>
                <Text style={styles.menuItemSubtitle}>
                  {autoSam
                    ? tr("Settings.autoSamOn")
                    : tr("Settings.autoSamOff")}
                </Text>
              </View>
            </View>
            <View style={styles.themeToggle}>
              <View
                style={[
                  styles.toggleTrack,
                  autoSam && styles.toggleTrackActive,
                ]}
              >
                <View
                  style={[
                    styles.toggleThumb,
                    autoSam && styles.toggleThumbActive,
                  ]}
                />
              </View>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Language Section */}
      <View style={styles.menuSection}>
        <Text style={styles.sectionTitle}>{tr("Settings.language")}</Text>
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
    sectionTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 8,
      marginLeft: 4,
    },
    sectionContainer: {
      backgroundColor: theme.colors.backgroundSecondary,
      borderRadius: 12,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.colors.border,
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
    menuItemContent: {
      flex: 1,
    },
    menuItemTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 2,
    },
    menuItemSubtitle: {
      fontSize: 13,
      color: theme.colors.textSecondary,
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
    themeToggle: {
      marginLeft: 12,
    },
    toggleTrack: {
      width: 51,
      height: 31,
      borderRadius: 16,
      backgroundColor: theme.colors.border,
      padding: 2,
      justifyContent: 'center',
    },
    toggleTrackActive: {
      backgroundColor: theme.colors.primary,
    },
    toggleThumb: {
      width: 27,
      height: 27,
      borderRadius: 14,
      backgroundColor: theme.colors.white,
      shadowColor: '#000',
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.2,
      shadowRadius: 2.5,
      elevation: 4,
    },
    toggleThumbActive: {
      transform: [{ translateX: 20 }],
    },
  });
