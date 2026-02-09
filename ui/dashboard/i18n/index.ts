import { en, TranslationKeys, TranslationSchema } from './translations/en';
import { he } from './translations/he';
import { ar } from './translations/ar';

export type Language = 'en' | 'he' | 'ar';

export const translations: Record<Language, TranslationSchema> = {
  en,
  he,
  ar,
};

export const languageNames: Record<Language, string> = {
  en: 'English',
  he: 'עברית',
  ar: 'العربية',
};

export const isRTL = (lang: Language): boolean => {
  return lang === 'he' || lang === 'ar';
};

export const getDirection = (lang: Language): 'ltr' | 'rtl' => {
  return isRTL(lang) ? 'rtl' : 'ltr';
};

// Detect browser language preference
export const detectBrowserLanguage = (): Language => {
  if (typeof window === 'undefined') return 'en';

  const browserLang = navigator.language || (navigator as unknown as { userLanguage?: string }).userLanguage || 'en';
  const langCode = browserLang.split('-')[0].toLowerCase();

  if (langCode === 'he' || langCode === 'iw') return 'he'; // iw is old Hebrew code
  if (langCode === 'ar') return 'ar';
  return 'en';
};

// Storage key for language preference
const LANGUAGE_STORAGE_KEY = 'tarasa_language';

export const getSavedLanguage = (): Language | null => {
  if (typeof window === 'undefined') return null;
  const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (saved && (saved === 'en' || saved === 'he' || saved === 'ar')) {
    return saved as Language;
  }
  return null;
};

export const saveLanguage = (lang: Language): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  }
};

export const getInitialLanguage = (): Language => {
  const saved = getSavedLanguage();
  if (saved) return saved;
  return detectBrowserLanguage();
};

export { en, he, ar };
export type { TranslationKeys };
