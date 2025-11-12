import { CONTENT_SPACING, SAFE_AREA_PADDING } from '@/components/Constants'
import { usePreferredCameraDevice } from '@/hooks/usePreferredCameraDevice'
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
}

function Device({ device, onPress }: DeviceProps): React.ReactElement {
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

  return (
    <TouchableOpacity style={styles.itemContainer} onPress={onPress}>
      <View style={styles.horizontal}>
        <Ionicons name="camera" size={18} color="black" />
        <Text style={styles.deviceName} numberOfLines={3}>
          {device.name} <Text style={styles.devicePosition}>({device.position})</Text>
        </Text>
      </View>
      <Text style={styles.deviceTypes}>{deviceTypes}</Text>
      <View style={styles.horizontal}>
        <Ionicons name="camera" size={12} color="black" />
        <Text style={styles.resolutionText}>
          {maxPhotoRes.photoWidth}x{maxPhotoRes.photoHeight}
        </Text>
      </View>
      <View style={styles.horizontal}>
        <Ionicons name="videocam" size={12} color="black" />
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
      return <Device device={item} onPress={() => onDevicePressed(item)} />
    },
    [onDevicePressed],
  )

  const renderSectionHeader = useCallback(({ section }: { section: SectionData }) => {
    if (section.data.length === 0) return null
    return (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>{section.position.toUpperCase()}</Text>
      </View>
    )
  }, [])

  return (
    <View style={styles.container}>
      <View style={styles.headerContainer}>
        <View style={styles.horizontal}>
          <TouchableOpacity style={styles.backButton} onPress={router.back}>
            <Ionicons name="chevron-back" size={35} color="black" />
          </TouchableOpacity>
          <Text style={styles.header}>Camera Devices</Text>
        </View>
        <Text style={styles.subHeader}>
          These are all detected Camera devices on your phone. This list will automatically update as you plug devices in or out.
        </Text>
      </View>

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  headerContainer: {
    paddingTop: SAFE_AREA_PADDING.paddingTop,
    paddingLeft: SAFE_AREA_PADDING.paddingLeft,
    paddingRight: SAFE_AREA_PADDING.paddingRight,
  },
  header: {
    fontSize: 38,
    fontWeight: 'bold',
    maxWidth: '80%',
  },
  subHeader: {
    marginTop: 10,
    fontSize: 18,
    maxWidth: '80%',
  },
  list: {
    marginTop: CONTENT_SPACING,
  },
  listContent: {
    paddingBottom: SAFE_AREA_PADDING.paddingBottom,
  },
  sectionHeader: {
    paddingHorizontal: CONTENT_SPACING / 2,
    paddingVertical: 5,
  },
  sectionHeaderText: {
    opacity: 0.4,
    fontSize: 16,
  },
  itemContainer: {
    paddingHorizontal: CONTENT_SPACING,
    paddingVertical: 7,
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
  },
  devicePosition: {
    fontSize: 14,
    color: 'gray',
    fontWeight: 'normal',
  },
  deviceTypes: {
    fontSize: 14,
    color: 'gray',
    marginLeft: 28,
  },
  resolutionText: {
    fontSize: 11,
    color: 'gray',
    marginLeft: 5,
  },
  deviceId: {
    fontSize: 11,
    color: 'gray',
    marginLeft: 28,
    marginTop: 3,
  },
  backButton: {
    marginRight: 10,
  },
})