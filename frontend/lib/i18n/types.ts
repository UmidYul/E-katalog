export const SUPPORTED_LOCALES = ["uz-Cyrl-UZ", "ru-RU"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export type TranslationParams = Record<string, string | number>;
