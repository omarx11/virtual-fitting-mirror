/**
 * UI language: English or Arabic (Saudi Arabia). The choice is a harmless UI preference kept in
 * localStorage under its own key, so the mirror and the /research page share it.
 *
 * Priority: `?lang=en|ar` in the URL (handy for a kiosk shortcut; it is remembered) → the stored
 * choice → the browser's language → English.
 */
import { ar } from './ar';
import { en, type Messages } from './en';

export type Locale = 'en' | 'ar';

export const LOCALES: Record<Locale, { messages: Messages; dir: 'ltr' | 'rtl'; htmlLang: string }> = {
  en: { messages: en, dir: 'ltr', htmlLang: 'en' },
  ar: { messages: ar, dir: 'rtl', htmlLang: 'ar-SA' },
};

const KEY = 'virtual-fitting-mirror.locale.v1';

const isLocale = (v: unknown): v is Locale => v === 'en' || v === 'ar';

export function loadLocale(): Locale {
  try {
    const param = new URLSearchParams(globalThis.location?.search ?? '').get('lang');
    if (isLocale(param)) {
      saveLocale(param);
      return param;
    }
    const stored = globalThis.localStorage?.getItem(KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Storage unavailable: fall through to the browser language.
  }
  const languages = globalThis.navigator?.languages ?? [];
  return languages[0]?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export function saveLocale(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem(KEY, locale);
  } catch {
    // Storage unavailable: the choice simply is not remembered.
  }
}

/** Sets the document language, direction and title (also before first render, so nothing flips). */
export function applyLocale(locale: Locale): void {
  const { dir, htmlLang, messages } = LOCALES[locale];
  const root = document.documentElement;
  root.lang = htmlLang;
  root.dir = dir;
  document.title = messages.meta.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', messages.meta.description);
}
