import { getActiveClientLocale } from "../i18n/locale.ts";
import type { Locale } from "../i18n/types.ts";

const toIntlLocale = (locale: Locale) => (locale === "uz-Cyrl-UZ" ? "uz-Cyrl-UZ" : "ru-RU");

const isLocaleToken = (value: string): value is Locale => value === "uz-Cyrl-UZ" || value === "ru-RU";

export const formatPrice = (
  value: number,
  currencyOrLocale?: string,
  localeInput?: Locale,
) => {
  const rounded = Number.isFinite(value) ? Math.round(value) : 0;
  const locale = (currencyOrLocale && isLocaleToken(currencyOrLocale) ? currencyOrLocale : localeInput) ?? getActiveClientLocale();
  const formatted = new Intl.NumberFormat(toIntlLocale(locale), {
    maximumFractionDigits: 0,
  }).format(rounded);

  if (currencyOrLocale && !isLocaleToken(currencyOrLocale) && currencyOrLocale !== "UZS") {
    return `${formatted} ${currencyOrLocale}`;
  }

  return formatted;
};

export const formatNumber = (value: number, locale: Locale = getActiveClientLocale(), options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(toIntlLocale(locale), options).format(value);

export const formatDateTime = (value: Date | string, locale: Locale = getActiveClientLocale(), options?: Intl.DateTimeFormatOptions) => {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(toIntlLocale(locale), options ?? { dateStyle: "medium", timeStyle: "short" }).format(date);
};

export const formatRelativeTime = (value: Date | string) => {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";

  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "ҳозиргина";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} дақ. олдин`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} соат олдин`;
  return date.toLocaleDateString("ru-RU");
};

export const debounceMs = {
  search: 300,
  filters: 200,
} as const;
