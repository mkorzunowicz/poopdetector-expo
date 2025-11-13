import i18n from '@/i18n/i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import React, { createContext, useContext, useEffect, useState } from 'react';

export type LanguageCode = 'auto' | 'en' | 'pl';

interface LanguageContextType {
  selectedLanguage: LanguageCode;
  setLanguage: (language: LanguageCode) => Promise<void>;
  availableLanguages: Array<{
    code: LanguageCode;
    label: string;
    nativeLabel: string;
  }>;
  // Add a trigger that changes when language changes to force re-renders
  languageChanged: number;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const LANGUAGE_STORAGE_KEY = '@poop_tracker_language';

export const availableLanguages = [
  { code: 'auto' as LanguageCode, label: 'Language.auto', nativeLabel: 'Auto-detect' },
  { code: 'en' as LanguageCode, label: 'Language.english', nativeLabel: 'English' },
  { code: 'pl' as LanguageCode, label: 'Language.polish', nativeLabel: 'Polski' },
  { code: 'de' as LanguageCode, label: 'Language.german', nativeLabel: 'Deutsch' },
];

const getSystemLanguage = (): string => {
  try {
    const locales = getLocales();
    return locales[0].languageCode ?? 'en';
  } catch {
    return 'en';
  }
};

const getEffectiveLanguage = (selectedLanguage: LanguageCode): string => {
  if (selectedLanguage === 'auto') {
    return getSystemLanguage();
  }
  return selectedLanguage;
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode>('auto');
  const [languageChanged, setLanguageChanged] = useState(0);

  // Load saved language preference on app start
  useEffect(() => {
    const loadLanguagePreference = async () => {
      try {
        const savedLanguage = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (savedLanguage && (savedLanguage === 'auto' || savedLanguage === 'en' || savedLanguage === 'pl' || savedLanguage === 'de')) {
          setSelectedLanguage(savedLanguage as LanguageCode);
          i18n.locale = getEffectiveLanguage(savedLanguage as LanguageCode);
        } else {
          // First time - use auto-detect
          i18n.locale = getEffectiveLanguage('auto');
        }
      } catch (error) {
        console.error('Failed to load language preference:', error);
        i18n.locale = getEffectiveLanguage('auto');
      }
    };

    loadLanguagePreference();
  }, []);

  const setLanguage = async (language: LanguageCode) => {
    try {
      // Save to AsyncStorage
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
      
      // Update state
      setSelectedLanguage(language);
      
      // Update i18n locale
      const effectiveLanguage = getEffectiveLanguage(language);
      i18n.locale = effectiveLanguage;
      
      // Trigger re-render of all components using translations
      setLanguageChanged(prev => prev + 1);
      
      console.log(`Language changed to: ${language} (effective: ${effectiveLanguage})`);
    } catch (error) {
      console.error('Failed to save language preference:', error);
    }
  };

  const value: LanguageContextType = {
    selectedLanguage,
    setLanguage,
    availableLanguages,
    languageChanged,
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
