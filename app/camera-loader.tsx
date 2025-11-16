import { tr } from '@/i18n/i18n'
import { useTheme } from '@/styles/ThemeContext'
import { router } from 'expo-router'
import { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

export default function CameraLoader() {
  const { theme } = useTheme()
  const styles = getStyles(theme)

  useEffect(() => {
      console.log('[CameraLoader] 🎬 Showing loader, will navigate in 200ms...')
      // Delay to ensure loader is visible before navigating to tabs
      const timer = setTimeout(() => {
        console.log('[CameraLoader] ✅ Navigating to main app...')
        router.replace('/(tabs)')
      }, 200) // Give 200ms for loader to render
      
      return () => clearTimeout(timer)
  }, [])

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.title}>{tr('Camera.loadingModel')}</Text>
        <Text style={styles.subtitle}>{tr('Camera.initializingDetector')}</Text>
      </View>
    </View>
  )
}

const getStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.backgroundPrimary,
    },
    card: {
      backgroundColor: theme.colors.backgroundSecondary,
      borderRadius: 16,
      padding: 32,
      alignItems: 'center',
      minWidth: 250,
      shadowColor: theme.colors.text,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 4,
    },
    title: {
      marginTop: 20,
      fontSize: 18,
      fontWeight: '700',
      color: theme.colors.text,
    },
    subtitle: {
      marginTop: 8,
      fontSize: 14,
      color: theme.colors.textSecondary,
    },
  })
