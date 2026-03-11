import { getActiveClientLocale } from "../i18n/locale.ts";
import type { Locale } from "../i18n/types.ts";

const toIntlLocale = (locale: Locale) => (locale === "uz-Cyrl-UZ" ? "uz-Cyrl-UZ" : "ru-RU");

export const formatPrice = (value: number, currency: string = "UZS", locale: Locale = getActiveClientLocale()) =>
  new Intl.NumberFormat(toIntlLocale(locale), {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(value);

export const formatNumber = (value: number, locale: Locale = getActiveClientLocale(), options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(toIntlLocale(locale), options).format(value);

export const formatDateTime = (value: Date | string, locale: Locale = getActiveClientLocale(), options?: Intl.DateTimeFormatOptions) => {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(toIntlLocale(locale), options ?? { dateStyle: "medium", timeStyle: "short" }).format(date);
};

export const debounceMs = {
  search: 300,
  filters: 200
} as const;



