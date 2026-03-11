"use client";

import { Globe } from "lucide-react";

import { LOCALE_LABELS, LOCALE_SHORT_LABELS } from "@/lib/i18n/constants";
import { useLocale, useT } from "@/components/common/locale-provider";
import type { Locale } from "@/lib/i18n/types";

type LocaleSwitcherProps = {
  compact?: boolean;
  className?: string;
};

const OPTIONS: Locale[] = ["uz-Cyrl-UZ", "ru-RU"];

export function LocaleSwitcher({ compact = false, className }: LocaleSwitcherProps) {
  const { locale, setLocale } = useLocale();
  const t = useT("locale");

  return (
    <label className={className ? className : "inline-flex items-center gap-2"}>
      {!compact ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Globe className="h-3.5 w-3.5" />
          {t("switcherLabel")}
        </span>
      ) : null}
      <select
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        aria-label={t("switcherLabel")}
        className="h-8 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground"
      >
        {OPTIONS.map((option) => (
          <option key={option} value={option}>
            {compact ? LOCALE_SHORT_LABELS[option] : LOCALE_LABELS[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
