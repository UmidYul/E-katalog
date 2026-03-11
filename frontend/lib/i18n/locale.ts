import { DEFAULT_LOCALE, LOCALE_COOKIE_MAX_AGE_SECONDS, LOCALE_COOKIE_NAME } from "./constants.ts";
import type { Locale } from "./types.ts";

const SUPPORTED = new Set<Locale>(["uz-Cyrl-UZ", "ru-RU"]);

export const isLocale = (value: unknown): value is Locale => typeof value === "string" && SUPPORTED.has(value as Locale);

export const resolveLocale = (value?: string | null): Locale => {
  if (!value) return DEFAULT_LOCALE;
  return isLocale(value) ? value : DEFAULT_LOCALE;
};

export const toHtmlLang = (locale: Locale): "uz-Cyrl" | "ru" => (locale === "uz-Cyrl-UZ" ? "uz-Cyrl" : "ru");

export const persistLocaleCookie = (locale: Locale) => {
  if (typeof document === "undefined") return;
  const encoded = encodeURIComponent(locale);
  document.cookie = `${LOCALE_COOKIE_NAME}=${encoded}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
};

let activeClientLocale: Locale = DEFAULT_LOCALE;

export const setActiveClientLocale = (locale: Locale) => {
  activeClientLocale = locale;
};

export const getActiveClientLocale = (): Locale => {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  return activeClientLocale;
};


