import { useCallback, useEffect, useState } from 'react';
import {
  Language,
  translations,
  getInitialLanguage,
  saveLanguage,
  getDirection,
  isRTL,
  TranslationKeys,
} from '../i18n';

type NestedKeyOf<T> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? `${K}.${NestedKeyOf<T[K]>}` | K
          : K
        : never;
    }[keyof T]
  : never;

type TranslationPath = NestedKeyOf<TranslationKeys>;

// Get nested value from object using dot notation
const getNestedValue = (obj: unknown, path: string): string => {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return path; // Return path if not found
    }
  }

  return typeof current === 'string' ? current : path;
};

interface UseTranslationReturn {
  t: (key: TranslationPath | string) => string;
  language: Language;
  setLanguage: (lang: Language) => void;
  direction: 'ltr' | 'rtl';
  isRTL: boolean;
  languages: Language[];
}

export const useTranslation = (): UseTranslationReturn => {
  const [language, setLanguageState] = useState<Language>('en');
  const [mounted, setMounted] = useState(false);

  // Initialize language on mount
  useEffect(() => {
    setLanguageState(getInitialLanguage());
    setMounted(true);
  }, []);

  // Update document direction when language changes
  useEffect(() => {
    if (mounted && typeof document !== 'undefined') {
      const dir = getDirection(language);
      document.documentElement.dir = dir;
      document.documentElement.lang = language;
    }
  }, [language, mounted]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    saveLanguage(lang);
  }, []);

  const t = useCallback(
    (key: TranslationPath | string): string => {
      return getNestedValue(translations[language], key);
    },
    [language]
  );

  return {
    t,
    language,
    setLanguage,
    direction: getDirection(language),
    isRTL: isRTL(language),
    languages: ['en', 'he', 'ar'],
  };
};

export default useTranslation;
