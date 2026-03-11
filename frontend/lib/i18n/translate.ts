import { FALLBACK_LOCALE } from "./constants.ts";
import { messages, ruMessages } from "./messages.ts";
import type { Locale, TranslationParams } from "./types.ts";

type MessageTree = Record<string, unknown>;

const interpolate = (template: string, params?: TranslationParams): string => {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? `{${key}}` : String(value);
  });
};

const readByPath = (dictionary: MessageTree, path: string): unknown => {
  const segments = path.split(".").filter(Boolean);
  let current: unknown = dictionary;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || !(segment in current)) return undefined;
    current = (current as MessageTree)[segment];
  }
  return current;
};

export const translate = (locale: Locale, key: string, params?: TranslationParams): string => {
  const localized = readByPath(messages[locale] as unknown as MessageTree, key);
  if (typeof localized === "string") return interpolate(localized, params);

  const fallback = readByPath(messages[FALLBACK_LOCALE] as unknown as MessageTree, key);
  if (typeof fallback === "string") return interpolate(fallback, params);

  const ru = readByPath(ruMessages as unknown as MessageTree, key);
  if (typeof ru === "string") return interpolate(ru, params);

  return key;
};

export const createTranslator = (locale: Locale) => (key: string, params?: TranslationParams) => translate(locale, key, params);


