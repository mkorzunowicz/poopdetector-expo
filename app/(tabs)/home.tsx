import { tr } from "@/i18n/i18n";
import { useTheme } from "@/styles/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from '@react-navigation/native';
import * as MediaLibrary from 'expo-media-library';
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Dimensions, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const STORAGE_KEY = '@poopdetector_saved_photos';
const { width } = Dimensions.get('window');
const COLUMN_COUNT = 3;
const IMAGE_SIZE = (width - 32) / COLUMN_COUNT; // 32 = padding + gaps

interface SavedPhoto {
  uri: string;
  timestamp: number;
  assetId?: string;
}

const Home: React.FC = () => {
  const { theme } = useTheme();
  const styles = getStyles(theme);
  const [photos, setPhotos] = useState<SavedPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [permissionStatus, setPermissionStatus] = useState<MediaLibrary.PermissionStatus | null>(null);

  const loadPhotos = useCallback(async () => {
    try {
      setLoading(true);
      
      // Check permission
      const { status } = await MediaLibrary.getPermissionsAsync();
      setPermissionStatus(status);
      
      if (status === 'granted') {
        // Load photos from the Poop Detector album
        const albums = await MediaLibrary.getAlbumsAsync();
        const poopDetectorAlbum = albums.find(album => album.title === 'Poop Detector');
        
        if (poopDetectorAlbum) {
          const assets = await MediaLibrary.getAssetsAsync({
            album: poopDetectorAlbum,
            sortBy: [MediaLibrary.SortBy.creationTime],
            mediaType: MediaLibrary.MediaType.photo,
            first: 100,
          });
          
          const photoData: SavedPhoto[] = assets.assets.map(asset => ({
            uri: asset.uri,
            timestamp: asset.creationTime,
            assetId: asset.id,
          }));
          
          setPhotos(photoData);
        }
      }
    } catch (error) {
      console.error('Error loading photos:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadPhotos();
    }, [loadPhotos])
  );

  const requestPermission = async () => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    setPermissionStatus(status);
    if (status === 'granted') {
      loadPhotos();
    }
  };

  const renderPhoto = ({ item }: { item: SavedPhoto }) => (
    <TouchableOpacity 
      style={styles.photoContainer}
      onPress={() => {
        // TODO: Open full screen view
        Alert.alert(tr('Home.photosSaved'), item.uri);
      }}
    >
      <Image source={{ uri: item.uri }} style={styles.photo} />
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Ionicons name="images-outline" size={80} color={theme.colors.textTertiary} />
      <Text style={styles.emptyText}>{tr('Home.noPhotos')}</Text>
    </View>
  );

  const renderPermissionRequest = () => (
    <View style={styles.emptyState}>
      <Ionicons name="lock-closed-outline" size={80} color={theme.colors.warning} />
      <Text style={styles.emptyText}>{tr('Media.permissionNeeded')}</Text>
      <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
        <Text style={styles.permissionButtonText}>{tr('Permissions.grantPermissions')}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{tr('Home.gallery')}</Text>
        <Text style={styles.subtitle}>
          {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : permissionStatus !== 'granted' ? (
        renderPermissionRequest()
      ) : (
        <FlatList
          data={photos}
          renderItem={renderPhoto}
          keyExtractor={(item, index) => item.assetId || `photo-${index}`}
          numColumns={COLUMN_COUNT}
          contentContainerStyle={[
            styles.grid,
            photos.length === 0 && styles.gridEmpty
          ]}
          ListEmptyComponent={renderEmptyState}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
};

const getStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    title: {
      fontSize: 28,
      fontWeight: "bold",
      color: theme.colors.text,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 14,
      color: theme.colors.textSecondary,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    grid: {
      padding: 8,
    },
    gridEmpty: {
      flex: 1,
    },
    photoContainer: {
      width: IMAGE_SIZE,
      height: IMAGE_SIZE,
      padding: 4,
    },
    photo: {
      width: '100%',
      height: '100%',
      borderRadius: 8,
      backgroundColor: theme.colors.backgroundSecondary,
    },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 40,
    },
    emptyText: {
      fontSize: 16,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginTop: 16,
      lineHeight: 24,
    },
    permissionButton: {
      marginTop: 20,
      backgroundColor: theme.colors.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 8,
    },
    permissionButtonText: {
      color: theme.colors.white,
      fontSize: 16,
      fontWeight: '600',
    },
  });

export default Home;
