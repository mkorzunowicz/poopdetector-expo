import { CONTENT_SPACING, SAFE_AREA_PADDING } from '@/components/Constants'
import { tr } from '@/i18n/i18n'
import { useTheme } from '@/styles/ThemeContext'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import React, { useCallback, useEffect, useState } from 'react'
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { CameraPermissionStatus } from 'react-native-vision-camera'
import { Camera } from 'react-native-vision-camera'

const PermissionsPage: React.FC = () => {
  const { theme } = useTheme()
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState<CameraPermissionStatus>('not-determined')
  const [microphonePermissionStatus, setMicrophonePermissionStatus] = useState<CameraPermissionStatus>('not-determined')

  const requestMicrophonePermission = useCallback(async () => {
    console.log('Requesting microphone permission...')
    const permission = await Camera.requestMicrophonePermission()
    console.log(`Microphone permission status: ${permission}`)

    if (permission === 'denied') await Linking.openSettings()
    setMicrophonePermissionStatus(permission)
  }, [])

  const requestCameraPermission = useCallback(async () => {
    console.log('Requesting camera permission...')
    const permission = await Camera.requestCameraPermission()
    console.log(`Camera permission status: ${permission}`)

    if (permission === 'denied') await Linking.openSettings()
    setCameraPermissionStatus(permission)
  }, [])

  const checkPermissions = useCallback(async () => {
    const cameraPermission = await Camera.getCameraPermissionStatus()
    const microphonePermission = await Camera.getMicrophonePermissionStatus()
    
    setCameraPermissionStatus(cameraPermission)
    setMicrophonePermissionStatus(microphonePermission)
  }, [])

  useEffect(() => {
    checkPermissions()
  }, [checkPermissions])

  useEffect(() => {
    if (cameraPermissionStatus === 'granted' && microphonePermissionStatus === 'granted') {
      router.replace('/(tabs)')
    }
  }, [cameraPermissionStatus, microphonePermissionStatus])

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
      paddingTop: SAFE_AREA_PADDING.paddingTop,
      paddingHorizontal: CONTENT_SPACING,
      paddingBottom: SAFE_AREA_PADDING.paddingBottom,
    },
    iconContainer: {
      alignItems: 'center',
      marginTop: 60,
      marginBottom: 30,
    },
    welcome: {
      fontSize: 28,
      fontWeight: 'bold',
      textAlign: 'center',
      marginBottom: 16,
      color: theme.colors.text,
    },
    description: {
      fontSize: 16,
      textAlign: 'center',
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
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },
    permissionTitle: {
      fontSize: 18,
      fontWeight: '600',
      marginLeft: 12,
      color: theme.colors.text,
    },
    permissionButton: {
      backgroundColor: theme.colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 8,
      alignItems: 'center',
    },
    buttonText: {
      color: theme.colors.white,
      fontSize: 16,
      fontWeight: '600',
    },
    grantedText: {
      color: theme.colors.success,
      fontSize: 16,
      fontWeight: '500',
    },
    settingsContainer: {
      backgroundColor: theme.name === 'dark' ? 'rgba(255, 178, 77, 0.15)' : '#FFF3CD',
      padding: 16,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.warning,
    },
    settingsText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginBottom: 12,
    },
    settingsButton: {
      backgroundColor: theme.colors.warning,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 6,
      alignItems: 'center',
    },
  })

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Ionicons name="camera-outline" size={80} color={theme.colors.primary} />
      </View>
      
      <Text style={styles.welcome}>{tr('Permissions.cameraPermissionRequired')}</Text>
      <Text style={styles.description}>
        {tr('Permissions.description')}
      </Text>
      
      <View style={styles.permissionsContainer}>
        <View style={styles.permissionItem}>
          <View style={styles.permissionHeader}>
            <Ionicons 
              name={cameraPermissionStatus === 'granted' ? 'checkmark-circle' : 'camera-outline'} 
              size={24} 
              color={cameraPermissionStatus === 'granted' ? theme.colors.success : theme.colors.primary} 
            />
            <Text style={styles.permissionTitle}>{tr('Permissions.cameraAccess')}</Text>
          </View>
          {cameraPermissionStatus !== 'granted' && (
            <TouchableOpacity style={styles.permissionButton} onPress={requestCameraPermission}>
              <Text style={styles.buttonText}>{tr('Permissions.grantCamera')}</Text>
            </TouchableOpacity>
          )}
          {cameraPermissionStatus === 'granted' && (
            <Text style={styles.grantedText}>{tr('Permissions.cameraGranted')}</Text>
          )}
        </View>

        <View style={styles.permissionItem}>
          <View style={styles.permissionHeader}>
            <Ionicons 
              name={microphonePermissionStatus === 'granted' ? 'checkmark-circle' : 'mic-outline'} 
              size={24} 
              color={microphonePermissionStatus === 'granted' ? theme.colors.success : theme.colors.primary} 
            />
            <Text style={styles.permissionTitle}>{tr('Permissions.microphoneAccess')}</Text>
          </View>
          {microphonePermissionStatus !== 'granted' && (
            <TouchableOpacity style={styles.permissionButton} onPress={requestMicrophonePermission}>
              <Text style={styles.buttonText}>{tr('Permissions.grantMicrophone')}</Text>
            </TouchableOpacity>
          )}
          {microphonePermissionStatus === 'granted' && (
            <Text style={styles.grantedText}>{tr('Permissions.microphoneGranted')}</Text>
          )}
        </View>
      </View>

      {(cameraPermissionStatus === 'denied' || microphonePermissionStatus === 'denied') && (
        <View style={styles.settingsContainer}>
          <Text style={styles.settingsText}>
            {tr('Permissions.deniedMessage')}
          </Text>
          <TouchableOpacity style={styles.settingsButton} onPress={() => Linking.openSettings()}>
            <Text style={styles.buttonText}>{tr('Permissions.openSettings')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

export default PermissionsPage