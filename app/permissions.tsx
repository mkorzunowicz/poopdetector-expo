import { CONTENT_SPACING, SAFE_AREA_PADDING } from '@/components/Constants'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import React, { useCallback, useEffect, useState } from 'react'
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { CameraPermissionStatus } from 'react-native-vision-camera'
import { Camera } from 'react-native-vision-camera'

const PermissionsPage: React.FC = () => {
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

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Ionicons name="camera-outline" size={80} color="#007aff" />
      </View>
      
      <Text style={styles.welcome}>Camera Permissions Required</Text>
      <Text style={styles.description}>
        This app needs access to your camera and microphone to detect objects and capture photos/videos.
      </Text>
      
      <View style={styles.permissionsContainer}>
        <View style={styles.permissionItem}>
          <View style={styles.permissionHeader}>
            <Ionicons 
              name={cameraPermissionStatus === 'granted' ? 'checkmark-circle' : 'camera-outline'} 
              size={24} 
              color={cameraPermissionStatus === 'granted' ? '#4CAF50' : '#007aff'} 
            />
            <Text style={styles.permissionTitle}>Camera Access</Text>
          </View>
          {cameraPermissionStatus !== 'granted' && (
            <TouchableOpacity style={styles.permissionButton} onPress={requestCameraPermission}>
              <Text style={styles.buttonText}>Grant Camera Permission</Text>
            </TouchableOpacity>
          )}
          {cameraPermissionStatus === 'granted' && (
            <Text style={styles.grantedText}>✓ Camera permission granted</Text>
          )}
        </View>

        <View style={styles.permissionItem}>
          <View style={styles.permissionHeader}>
            <Ionicons 
              name={microphonePermissionStatus === 'granted' ? 'checkmark-circle' : 'mic-outline'} 
              size={24} 
              color={microphonePermissionStatus === 'granted' ? '#4CAF50' : '#007aff'} 
            />
            <Text style={styles.permissionTitle}>Microphone Access</Text>
          </View>
          {microphonePermissionStatus !== 'granted' && (
            <TouchableOpacity style={styles.permissionButton} onPress={requestMicrophonePermission}>
              <Text style={styles.buttonText}>Grant Microphone Permission</Text>
            </TouchableOpacity>
          )}
          {microphonePermissionStatus === 'granted' && (
            <Text style={styles.grantedText}>✓ Microphone permission granted</Text>
          )}
        </View>
      </View>

      {(cameraPermissionStatus === 'denied' || microphonePermissionStatus === 'denied') && (
        <View style={styles.settingsContainer}>
          <Text style={styles.settingsText}>
            If you've denied permissions, you can enable them in your device settings.
          </Text>
          <TouchableOpacity style={styles.settingsButton} onPress={() => Linking.openSettings()}>
            <Text style={styles.buttonText}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

export default PermissionsPage

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
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
    color: '#333',
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    color: '#666',
    marginBottom: 40,
    lineHeight: 22,
  },
  permissionsContainer: {
    gap: 24,
    marginBottom: 40,
  },
  permissionItem: {
    backgroundColor: '#f8f9fa',
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
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
    color: '#333',
  },
  permissionButton: {
    backgroundColor: '#007aff',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  grantedText: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: '500',
  },
  settingsContainer: {
    backgroundColor: '#fff3cd',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffeaa7',
  },
  settingsText: {
    fontSize: 14,
    color: '#856404',
    textAlign: 'center',
    marginBottom: 12,
  },
  settingsButton: {
    backgroundColor: '#ffc107',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
  },
})