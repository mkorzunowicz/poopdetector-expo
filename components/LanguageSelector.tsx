import { tr } from '@/i18n/i18n';
import { LanguageCode, useLanguage } from '@/providers/LanguageProvider';
import { useTheme } from '@/styles/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface LanguageSelectorProps {
  style?: any;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({ style }) => {
  const { theme } = useTheme();
  const { selectedLanguage, setLanguage, availableLanguages } = useLanguage();
  const [modalVisible, setModalVisible] = useState(false);
  const styles = getStyles(theme);

  const getCurrentLanguageLabel = () => {
    switch (selectedLanguage) {
      case 'auto':
        return tr('Language.auto');
      case 'en':
        return tr('Language.english');
      case 'pl':
        return tr('Language.polish');
      default:
        return tr('Language.auto');
    }
  };

  const handleLanguageSelect = async (languageCode: LanguageCode) => {
    await setLanguage(languageCode);
    setModalVisible(false);
  };

  return (
    <View style={[styles.container, style]}>
      <TouchableOpacity
        style={styles.selector}
        onPress={() => setModalVisible(true)}
      >
        <View style={styles.textContainer}>        
          <Text style={[styles.label, { color: theme.colors.textPrimary }]}>
          {tr('Screens.language')}
        </Text>
          <Text style={[styles.selectedValue, { color: theme.colors.textPrimary }]}>
            {getCurrentLanguageLabel()}
          </Text>
        </View>
      </TouchableOpacity>

      <Modal
        animationType="fade"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
        statusBarTranslucent
        presentationStyle="overFullScreen"
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.backgroundPrimary }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.textPrimary }]}>
                {tr('Screens.selectLanguage')}
              </Text>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={availableLanguages}
              keyExtractor={(item) => item.code}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.languageOption,
                    selectedLanguage === item.code && {
                      backgroundColor: theme.colors.backgroundSecondary,
                    },
                  ]}
                  onPress={() => handleLanguageSelect(item.code)}
                >
                  {/* <Text style={[styles.languageLabel, { color: theme.colors.textPrimary }]}>
                    {(() => {
                      switch (item.code) {
                        case 'auto':
                          return 'Auto-detect';
                        case 'en':
                          return 'English';
                        case 'pl':
                          return 'Polski';
                        default:
                          return item.nativeLabel;
                      }
                    })()}
                  </Text> */}
                  <Text style={[styles.languageLabel, { color: theme.colors.textPrimary }]}>
                    {item.nativeLabel}
                  </Text>
                  {selectedLanguage === item.code && (
                    <Ionicons
                      name="checkmark"
                      size={20}
                      color={theme.colors.primary}
                      style={styles.checkmark}
                    />
                  )}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

const getStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      width: '100%',
      paddingHorizontal: 0,
    },
    selector: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 4,
    },
    icon: {
      marginRight: 18,
    },
    textContainer: {
      flex: 1,
    },
    label: {
      fontSize: 16,
      fontWeight: '500',
    },
    selectedValue: {
      fontSize: 14,
      marginTop: 2,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 40,
      maxHeight: '50%',
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 20,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '600',
    },
    closeButton: {
      padding: 5,
    },
    languageOption: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 15,
      paddingHorizontal: 15,
      borderRadius: 8,
    },
    languageLabel: {
      fontSize: 16,
      fontWeight: '500',
      flex: 1,
    },
    nativeLabel: {
      fontSize: 14,
      marginLeft: 10,
    },
    checkmark: {
      marginLeft: 10,
    },
    separator: {
      height: 1,
      backgroundColor: '#ccc',
      opacity: 0.3,
      marginHorizontal: 15,
    },
  });
