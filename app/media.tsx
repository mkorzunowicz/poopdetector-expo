import { SAFE_AREA_PADDING } from '@/components/Constants'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/core'
import { router, useLocalSearchParams } from 'expo-router'
import React, { useCallback, useMemo, useState } from 'react'
import type { ImageLoadEventData, NativeSyntheticEvent } from 'react-native'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

type OnLoadImage = NativeSyntheticEvent<ImageLoadEventData>

const MediaPage: React.FC = () => {
  const { path, type } = useLocalSearchParams<{ path: string; type: 'photo' | 'video' }>()
  const [hasMediaLoaded, setHasMediaLoaded] = useState(false)
  const [isScreenFocused, setIsScreenFocused] = useState(false)

  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true)
      return () => {
        setIsScreenFocused(false)
      }
    }, [])
  )

  const onMediaLoad = useCallback((event: OnLoadImage) => {
    const source = event.nativeEvent.source
    console.log(`Image loaded. Size: ${source.width}x${source.height}`)
  }, [])
  
  const onMediaLoadEnd = useCallback(() => {
    console.log('media has loaded.')
    setHasMediaLoaded(true)
  }, [])

  const source = useMemo(() => ({ uri: `file://${path}` }), [path])

  const screenStyle = useMemo(() => ({ opacity: hasMediaLoaded ? 1 : 0 }), [hasMediaLoaded])

  if (!path || !type) {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.closeButton} onPress={router.back}>
          <Ionicons name="close" size={35} color="white" />
        </TouchableOpacity>
        <Text style={{ color: 'white' }}>No media found</Text>
      </View>
    )
  }

  return (
    <View style={[styles.container, screenStyle]}>
      {type === 'photo' && (
        <Image source={source} style={StyleSheet.absoluteFill} resizeMode="cover" onLoadEnd={onMediaLoadEnd} onLoad={onMediaLoad} />
      )}
      {type === 'video' && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'black', justifyContent: 'center', alignItems: 'center' }]}>
          <Text style={{ color: 'white', fontSize: 18 }}>Video playback not yet implemented</Text>
        </View>
      )}

      <TouchableOpacity style={styles.closeButton} onPress={router.back}>
        <Ionicons name="close" size={35} color="white" />
      </TouchableOpacity>
    </View>
  )
}

export default MediaPage

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'black',
  },
  closeButton: {
    position: 'absolute',
    top: SAFE_AREA_PADDING.paddingTop,
    left: SAFE_AREA_PADDING.paddingLeft,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(140, 140, 140, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
})