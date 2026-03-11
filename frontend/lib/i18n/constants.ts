import type { Locale } from "./types.ts";

export const LOCALE_COOKIE_NAME = "doxx_locale";
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const DEFAULT_LOCALE: Locale = "uz-Cyrl-UZ";
export const FALLBACK_LOCALE: Locale = "ru-RU";

export const LOCALE_LABELS: Record<Locale, string> = {
  "uz-Cyrl-UZ": "Узбекча (кирилл)",
  "ru-RU": "Русский",
};

export const LOCALE_SHORT_LABELS: Record<Locale, string> = {
  "uz-Cyrl-UZ": "ЎЗ",
  "ru-RU": "РУ",
};


