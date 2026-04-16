// Types
export type { LocaleInfo } from './constants.js';
export type { Locale, TranslationKey } from './types.js';

// Core i18n functions
export {
  getAvailableLocales,
  getLocale,
  getLocaleDisplayName,
  setLocale,
  t,
} from './i18n.js';

// Constants and utilities
export {
  DEFAULT_LOCALE,
  getLocaleDisplayString,
  getLocaleInfo,
  SUPPORTED_LOCALES,
} from './constants.js';
