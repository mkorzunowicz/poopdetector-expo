import { CONTENT_SPACING, SAFE_AREA_PADDING } from '@/components/Constants'
import { usePreferredCameraDevice } from '@/hooks/usePreferredCameraDevice'
import { useTheme } from '@/styles/ThemeContext'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import React, { useCallback, useMemo } from 'react'
import type { ListRenderItemInfo, SectionListData } from 'react-native'
import { SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { CameraDevice } from 'react-native-vision-camera'
import { useCameraDevices } from 'react-native-vision-camera'

const keyExtractor = (item: CameraDevice): string => item.id

interface SectionType {
  position: CameraDevice['position'] | 'preferred'
}
type SectionData = SectionListData<CameraDevice, SectionType>

interface DeviceProps {
  device: CameraDevice
  onPress: () => void
  theme: any
}

function Device({ device, onPress, theme }: DeviceProps): React.ReactElement {
  const maxPhotoRes = useMemo(
    () =>
      device.formats.reduce((prev, curr) => {
        if (curr.photoWidth * curr.photoHeight > prev.photoWidth * prev.photoHeight) return curr
        return prev
      }),
    [device.formats],
  )
  const maxVideoRes = useMemo(
    () =>
      device.formats.reduce((prev, curr) => {
        if (curr.videoWidth * curr.videoHeight > prev.videoWidth * prev.videoHeight) return curr
        return prev
      }),
    [device.formats],
  )
  const deviceTypes = useMemo(() => device.physicalDevices.map((t) => t.replace('-camera', '')).join(' + '), [device.physicalDevices])

  const styles = StyleSheet.create({
    itemContainer: {
      paddingHorizontal: CONTENT_SPACING,
      paddingVertical: 7,
      backgroundColor: theme.colors.backgroundSecondary,
      marginHorizontal: CONTENT_SPACING / 2,
      marginVertical: 4,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    horizontal: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    deviceName: {
      marginLeft: 10,
      fontSize: 18,
      fontWeight: 'bold',
      flex: 1,
      color: theme.colors.text,
    },
    devicePosition: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      fontWeight: 'normal',
    },
    deviceTypes: {
      fontSize: 14,
      color: theme.colors.textTertiary,
      marginLeft: 28,
    },
    resolutionText: {
      fontSize: 11,
      color: theme.colors.textTertiary,
      marginLeft: 5,
    },
    deviceId: {
      fontSize: 11,
      color: theme.colors.textTertiary,
      marginLeft: 28,
      marginTop: 3,
    },
  })

  return (
    <TouchableOpacity style={styles.itemContainer} onPress={onPress}>
      <View style={styles.horizontal}>
        <Ionicons name="camera" size={18} color={theme.colors.primary} />
        <Text style={styles.deviceName} numberOfLines={3}>
          {device.name} <Text style={styles.devicePosition}>({device.position})</Text>
        </Text>
      </View>
      <Text style={styles.deviceTypes}>{deviceTypes}</Text>
      <View style={styles.horizontal}>
        <Ionicons name="camera" size={12} color={theme.colors.secondary} />
        <Text style={styles.resolutionText}>
          {maxPhotoRes.photoWidth}x{maxPhotoRes.photoHeight}
        </Text>
      </View>
      <View style={styles.horizontal}>
        <Ionicons name="videocam" size={12} color={theme.colors.secondary} />
        <Text style={styles.resolutionText}>
          {maxVideoRes.videoWidth}x{maxVideoRes.videoHeight} @ {maxVideoRes.maxFps} FPS
        </Text>
      </View>
      <Text style={styles.deviceId} numberOfLines={2} ellipsizeMode="middle">
        {device.id}
      </Text>
    </TouchableOpacity>
  )
}

const DevicesPage: React.FC = () => {
  const { theme } = useTheme()
  const devices = useCameraDevices()
  const [preferredDevice, setPreferredDevice] = usePreferredCameraDevice()

  const sections = useMemo((): SectionData[] => {
    return [
      {
        position: 'preferred',
        data: preferredDevice != null ? [preferredDevice] : [],
      },
      {
        position: 'back',
        data: devices.filter((d) => d.position === 'back'),
      },
      {
        position: 'front',
        data: devices.filter((d) => d.position === 'front'),
      },
      {
        position: 'external',
        data: devices.filter((d) => d.position === 'external'),
      },
    ]
  }, [devices, preferredDevice])

  const onDevicePressed = useCallback(
    (device: CameraDevice) => {
      setPreferredDevice(device)
      router.back()
    },
    [setPreferredDevice],
  )

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<CameraDevice>) => {
      return <Device device={item} onPress={() => onDevicePressed(item)} theme={theme} />
    },
    [onDevicePressed, theme],
  )

  const renderSectionHeader = useCallback(({ section }: { section: SectionData }) => {
    if (section.data.length === 0) return null
    
    const sectionStyles = StyleSheet.create({
      sectionHeader: {
        paddingHorizontal: CONTENT_SPACING / 2,
        paddingVertical: 5,
      },
      sectionHeaderText: {
        opacity: 0.6,
        fontSize: 16,
        color: theme.colors.textSecondary,
        fontWeight: '600',
      },
    })
    
    return (
      <View style={sectionStyles.sectionHeader}>
        <Text style={sectionStyles.sectionHeaderText}>{section.position.toUpperCase()}</Text>
      </View>
    )
  }, [theme])

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
      paddingTop: 15,
    },
    list: {
      flex: 1,
    },
    listContent: {
      paddingBottom: SAFE_AREA_PADDING.paddingBottom,
      paddingTop: CONTENT_SPACING,
    },
  })

  return (
    <View style={styles.container}>
      <SectionList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        sections={sections}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={false}
      />
    </View>
  )
}

export default DevicesPage