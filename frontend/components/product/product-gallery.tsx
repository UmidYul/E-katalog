"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useLocale } from "@/components/common/locale-provider";

const UI_ICON_URL_PATTERNS: RegExp[] = [
  /(^|[\/_.-])(icon|icons|sprite|glyph|pictogram|logo)([\/_.-]|$)/i,
  /(^|[\/_.-])(cart|basket|shopping-cart|shopping-card|phone|call|location|map-marker|marker|pin)([\/_.-]|$)/i,
  /(^|[\/_.-])(telegram|whatsapp)([\/_.-]|$)/i,
];

const isLikelyUiIconAsset = (url: string) => {
  let normalized = String(url || "").trim();
  if (!normalized) return true;
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep raw URL if it cannot be decoded.
  }
  const lowered = normalized.toLowerCase();
  return UI_ICON_URL_PATTERNS.some((pattern) => pattern.test(lowered));
};

export function ProductGallery({ images }: { images: string[] }) {
  const { locale } = useLocale();
  const imageAlt = locale === "uz-Cyrl-UZ" ? "Товар расми" : "Изображение товара";
  const thumbAlt = locale === "uz-Cyrl-UZ" ? "Товар миниатюраси" : "Миниатюра товара";

  const sourceList = useMemo(() => {
    const unique = new Set<string>();
    for (const raw of images) {
      const value = String(raw ?? "").trim();
      if (!value) continue;
      if (!/^https?:\/\//i.test(value)) continue;
      if (/\.svg(?:[?#].*)?$/i.test(value)) continue;
      if (isLikelyUiIconAsset(value)) continue;
      unique.add(value);
    }
    return Array.from(unique);
  }, [images]);

  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(sourceList[0] ?? null);

  useEffect(() => {
    setFailed(new Set());
    setActive(sourceList[0] ?? null);
  }, [sourceList]);

  const visibleList = useMemo(() => sourceList.filter((src) => !failed.has(src)), [sourceList, failed]);

  useEffect(() => {
    if (!visibleList.length) {
      if (active !== null) setActive(null);
      return;
    }
    if (!active || !visibleList.includes(active)) {
      setActive(visibleList[0] ?? null);
    }
  }, [active, visibleList]);

  const markFailed = useCallback((src: string) => {
    setFailed((previous) => {
      if (previous.has(src)) return previous;
      const next = new Set(previous);
      next.add(src);
      return next;
    });
  }, []);

  return (
    <div className="space-y-3">
      <div className="relative aspect-square overflow-hidden rounded-xl border border-border bg-card">
        {active ? (
          <Image
            src={active}
            alt={imageAlt}
            fill
            className="object-contain p-3"
            sizes="(max-width: 768px) 100vw, 40vw"
            onError={() => markFailed(active)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium text-muted-foreground">{locale === "uz-Cyrl-UZ" ? "Товар расми мавжуд эмас" : "Фото товара недоступно"}</p>
            <p className="text-xs text-muted-foreground/80">
              {locale === "uz-Cyrl-UZ" ? "Маълумот янгилангандан кейин карточкани қайта очиб кўринг." : "Попробуйте открыть карточку позже, когда данные обновятся."}
            </p>
          </div>
        )}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {visibleList.slice(0, 5).map((src) => (
          <button
            key={src}
            type="button"
            className={`relative aspect-square overflow-hidden rounded-lg border ${active === src ? "border-accent" : "border-border"}`}
            onClick={() => setActive(src)}
          >
            <Image src={src} alt={thumbAlt} fill className="object-contain p-1" sizes="120px" onError={() => markFailed(src)} />
          </button>
        ))}
      </div>
    </div>
  );
}
