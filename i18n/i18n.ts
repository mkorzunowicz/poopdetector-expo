import { getLocales } from 'expo-localization';

import { translations } from "@/i18n/translations";
import { log } from '@/utils/logger';
import { I18n } from 'i18n-js';

// Extended translations that include both TypeScript and JSON loaded translations
let extendedTranslations = { ...translations };

export const i18n = new I18n(extendedTranslations);
try {
  i18n.locale = getLocales()[0].languageCode ?? 'en';
}
catch {
  // on web fails sometimes
  i18n.locale = 'en';
}
i18n.defaultLocale = 'en';
i18n.enableFallback = true;

// Function to load additional translations from JSON
export async function loadAdditionalTranslations(languageCode: string, translationsData: any) {
  log.storage.info("Loading additional translations", { languageCode });
  
  // Add the new language to the translations
  extendedTranslations = {
    ...extendedTranslations,
    [languageCode]: translationsData
  };
  
  // Update i18n with new translations
  i18n.translations = extendedTranslations;
  
  log.storage.info("Successfully loaded translations", { languageCode });
  return true;
}

// Function to get available languages (including dynamically loaded ones)
export function getAvailableLanguages() {
  return Object.keys(extendedTranslations);
}

type NestedKeyOf<T, Prefix extends string = ""> = T extends object
  ? {
    [K in keyof T]: T[K] extends object
    ? NestedKeyOf<T[K], `${Prefix}${K & string}.`> // Recursively build key paths
    : `${Prefix}${K & string}`; // Stop at values
  }[keyof T]
  : never;

// Type-safe translation function with optional parameter interpolation
export function tr<T extends TranslationKeys>(key: T, params?: Record<string, string | number>): string {
  return i18n.t(key, params);
}

export default i18n;

// replace with a language stub to check if there's anything missing in that dictionary
export type TranslationKeys = NestedKeyOf<typeof translations.en>;