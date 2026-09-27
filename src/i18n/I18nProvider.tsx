import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import type { Messages } from './en';
import { applyLocale, LOCALES, type Locale, loadLocale, saveLocale } from './locale';

export interface I18n {
  locale: Locale;
  /** The active language's messages. */
  m: Messages;
  dir: 'ltr' | 'rtl';
  rtl: boolean;
  setLocale: (locale: Locale) => void;
  /** Switches between English and Arabic; returns the new locale. */
  toggleLocale: () => Locale;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setState] = useState<Locale>(() => initial ?? loadLocale());

  useLayoutEffect(() => applyLocale(locale), [locale]);

  const setLocale = useCallback((next: Locale) => {
    saveLocale(next);
    setState(next);
  }, []);

  const toggleLocale = useCallback(() => {
    const next: Locale = locale === 'en' ? 'ar' : 'en';
    setLocale(next);
    return next;
  }, [locale, setLocale]);

  const value = useMemo<I18n>(() => {
    const { messages, dir } = LOCALES[locale];
    return { locale, m: messages, dir, rtl: dir === 'rtl', setLocale, toggleLocale };
  }, [locale, setLocale, toggleLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
