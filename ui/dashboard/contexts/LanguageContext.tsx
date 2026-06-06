import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import {
  Language,
  translations,
  getInitialLanguage,
  saveLanguage,
  getDirection,
  isRTL as isRTLFn,
  languageNames,
  TranslationKeys,
} from '../i18n';

// Get nested value from object using dot notation. Returns `null` when the key
// is missing so callers can fall back to another language.
const getNestedValue = (obj: unknown, path: string): string | null => {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return null;
    }
  }

  return typeof current === 'string' ? current : null;
};

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  direction: 'ltr' | 'rtl';
  isRTL: boolean;
  languageNames: Record<Language, string>;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

interface LanguageProviderProps {
  children: ReactNode;
}

export const LanguageProvider: React.FC<LanguageProviderProps> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>('en');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setLanguageState(getInitialLanguage());
    setMounted(true);
  }, []);

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
    (key: string): string => {
      // Try the active language, then fall back to English so a not-yet-
      // translated key renders real (English) text instead of a raw "a.b.c"
      // path. Only if it's missing everywhere do we surface the key itself.
      return (
        getNestedValue(translations[language], key) ??
        getNestedValue(translations.en, key) ??
        key
      );
    },
    [language]
  );

  const value: LanguageContextValue = {
    language,
    setLanguage,
    t,
    direction: getDirection(language),
    isRTL: isRTLFn(language),
    languageNames,
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextValue => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

export default LanguageContext;
