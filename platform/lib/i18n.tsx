'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import fr from '../locales/fr.json';
import en from '../locales/en.json';
import { platformConfig } from '../config';

export type Language = 'fr' | 'en';

const translations: Record<Language, any> = {
  fr,
  en,
};

/**
 * Safely resolves a bilingual { en, fr } object or plain string to a displayable string.
 * - If value is null/undefined, returns defaultValue or ''
 * - If value is already a string, returns value unchanged
 * - If value is a number or boolean, returns String(value)
 * - If value is an object with { en, fr }, returns the string for current language,
 *   falls back to the other language if missing, or first available string.
 * - Prevents Minified React error #31 (objects are not valid as a React child).
 */
export function localize(
  value: any,
  language: string = 'fr',
  defaultValue: string = ''
): string {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    const lang = (language === 'en' ? 'en' : 'fr') as 'en' | 'fr';
    const altLang = lang === 'en' ? 'fr' : 'en';

    if (value[lang] !== undefined && value[lang] !== null) {
      if (typeof value[lang] === 'string') return value[lang];
      return String(value[lang]);
    }
    if (value[altLang] !== undefined && value[altLang] !== null) {
      if (typeof value[altLang] === 'string') return value[altLang];
      return String(value[altLang]);
    }
    // Search for any string property in the object
    for (const k of Object.keys(value)) {
      if (typeof value[k] === 'string') {
        return value[k];
      }
    }
  }
  return defaultValue;
}

/**
 * Safely resolves an array of bilingual items or a bilingual object of arrays into string[]
 */
export function localizeArray(
  value: any,
  language: string = 'fr'
): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => localize(item, language));
  }
  if (typeof value === 'object') {
    const lang = language === 'en' ? 'en' : 'fr';
    const altLang = lang === 'en' ? 'fr' : 'en';
    const list = value[lang] || value[altLang] || [];
    if (Array.isArray(list)) {
      return list.map((item) => localize(item, language));
    }
  }
  return [];
}

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  localize: (value: any, defaultValue?: string) => string;
}

const I18nContext = createContext<I18nContextType>({
  language: platformConfig.defaultLanguage as Language,
  setLanguage: () => {},
  t: (key) => key,
  localize: (value) => localize(value, 'fr'),
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(
    (platformConfig.defaultLanguage as Language) || 'fr'
  );

  useEffect(() => {
    // Load persisted language preference
    try {
      const saved = localStorage.getItem('kazibox_lang') as Language;
      if (saved && (saved === 'fr' || saved === 'en')) {
        setLanguageState(saved);
        document.documentElement.lang = saved;
      }
    } catch {
      // Ignore in restricted environments
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'kazibox_lang' && (e.newValue === 'fr' || e.newValue === 'en')) {
        setLanguageState(e.newValue as Language);
        document.documentElement.lang = e.newValue;
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem('kazibox_lang', lang);
      document.cookie = `kazibox_lang=${lang}; path=/; max-age=31536000; SameSite=Lax`;
      document.documentElement.lang = lang;
      window.dispatchEvent(new CustomEvent('kazibox:languageChanged', { detail: lang }));
    } catch (err) {
      console.warn('Could not persist language preference:', err);
    }
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      if (!key) return '';
      const keys = key.split('.');
      let current = translations[language] || translations.fr;

      for (const k of keys) {
        if (current && typeof current === 'object' && k in current) {
          current = current[k];
        } else {
          // Fallback to French if missing in current locale
          let fallback = translations.fr;
          for (const fbKey of keys) {
            if (fallback && typeof fallback === 'object' && fbKey in fallback) {
              fallback = fallback[fbKey];
            } else {
              return key;
            }
          }
          current = fallback;
          break;
        }
      }

      if (typeof current !== 'string') {
        return key;
      }

      let text = current;
      // Substitute {platformName} automatically
      text = text.replace(/{platformName}/g, platformConfig.platformName);

      if (params) {
        Object.entries(params).forEach(([pKey, pVal]) => {
          text = text.replace(new RegExp(`{${pKey}}`, 'g'), String(pVal));
          text = text.replace(new RegExp(`{{${pKey}}}`, 'g'), String(pVal));
        });
      }

      return text;
    },
    [language]
  );

  const localizer = useCallback(
    (value: any, defaultValue: string = '') => {
      return localize(value, language, defaultValue);
    },
    [language]
  );

  return (
    <I18nContext.Provider value={{ language, setLanguage, t, localize: localizer }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useTranslation = () => useContext(I18nContext);
