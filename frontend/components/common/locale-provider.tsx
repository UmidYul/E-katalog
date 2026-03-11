"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { setActiveClientLocale, persistLocaleCookie, resolveLocale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translate";
import type { Locale, TranslationParams } from "@/lib/i18n/types";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string, params?: TranslationParams) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children, initialLocale }: { children: React.ReactNode; initialLocale: Locale }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(resolveLocale(initialLocale));

  useEffect(() => {
    const normalized = resolveLocale(initialLocale);
    setLocaleState(normalized);
    setActiveClientLocale(normalized);
  }, [initialLocale]);

  useEffect(() => {
    setActiveClientLocale(locale);
    persistLocaleCookie(locale);
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      const normalized = resolveLocale(next);
      setLocaleState((current) => {
        if (current === normalized) return current;
        return normalized;
      });
      persistLocaleCookie(normalized);
      router.refresh();
    },
    [router]
  );

  const t = useMemo(() => createTranslator(locale), [locale]);

  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used inside LocaleProvider");
  }
  return { locale: context.locale, setLocale: context.setLocale };
};

export const useT = (namespace?: string) => {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useT must be used inside LocaleProvider");
  }

  return useCallback(
    (key: string, params?: TranslationParams) => {
      const finalKey = namespace ? `${namespace}.${key}` : key;
      return context.t(finalKey, params);
    },
    [context, namespace]
  );
};
