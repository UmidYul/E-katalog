 "use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  const [activeIndex, setActiveIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setFailed(new Set());
    setActive(sourceList[0] ?? null);
    setActiveIndex(0);
  }, [sourceList]);

  const visibleList = useMemo(
    () => sourceList.filter((src) => !failed.has(src)),
    [sourceList, failed]
  );

  useEffect(() => {
    if (!visibleList.length) {
      if (active !== null) setActive(null);
      return;
    }
    if (!active || !visibleList.includes(active)) {
      setActive(visibleList[0] ?? null);
      setActiveIndex(0);
    } else {
      const idx = visibleList.indexOf(active);
      if (idx >= 0) setActiveIndex(idx);
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

  const handleCarouselScroll = useCallback(() => {
    const node = carouselRef.current;
    if (!node) return;
    const { scrollLeft, clientWidth } = node;
    if (!clientWidth) return;
    const index = Math.round(scrollLeft / clientWidth);
    if (index >= 0 && index < visibleList.length) {
      setActiveIndex(index);
      setActive(visibleList[index] ?? null);
    }
  }, [visibleList]);

  const handleDotClick = (index: number) => {
    setActiveIndex(index);
    const next = visibleList[index];
    setActive(next ?? null);
    const node = carouselRef.current;
    if (node) {
      node.scrollTo({
        left: index * node.clientWidth,
        behavior: "smooth"
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Mobile swipe carousel */}
      <div className="sm:hidden space-y-2">
        <div
          ref={carouselRef}
          onScroll={handleCarouselScroll}
          className="relative aspect-square max-h-[480px] overflow-x-auto rounded-2xl border border-border bg-card snap-x snap-mandatory"
        >
          <div className="flex h-full w-full">
            {visibleList.length ? (
              visibleList.map((src) => (
                <div
                  key={src}
                  className="relative h-full min-w-full snap-center overflow-hidden"
                >
                  <div className="group relative h-full w-full overflow-hidden">
                    <Image
                      src={src}
                      alt="Фото товара"
                      fill
                      className="h-full w-full object-contain p-4 transition-transform duration-300 group-hover:scale-105"
                      sizes="100vw"
                      onError={() => markFailed(src)}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
                <p className="text-sm font-medium text-muted-foreground">
                  Фото товара недоступно
                </p>
                <p className="text-xs text-muted-foreground/80">
                  Пробуем обновить карточку из проверенных источников.
                </p>
              </div>
            )}
          </div>
        </div>
        {visibleList.length > 1 ? (
          <div className="flex justify-center gap-1.5">
            {visibleList.map((src, index) => (
              <button
                key={src}
                type="button"
                onClick={() => handleDotClick(index)}
                className={`h-1.5 rounded-full transition-all ${
                  index === activeIndex
                    ? "w-5 bg-primary"
                    : "w-2 bg-border"
                }`}
                aria-label={`Перейти к изображению ${index + 1}`}
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* Desktop gallery with thumbnails */}
      <div className="hidden space-y-3 sm:block">
        <div className="group relative aspect-square max-h-[480px] overflow-hidden rounded-2xl border border-border bg-card">
          {active ? (
            <Image
              src={active}
              alt="Фото товара"
              fill
              className="h-full w-full object-contain p-4 transition-transform duration-300 group-hover:scale-105"
              sizes="(max-width: 1024px) 70vw, 40vw"
              onError={() => markFailed(active)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-muted-foreground">
                Фото товара недоступно
              </p>
              <p className="text-xs text-muted-foreground/80">
                Пробуем обновить карточку из проверенных источников.
              </p>
            </div>
          )}
        </div>
        {visibleList.length ? (
          <div className="flex gap-2 overflow-x-auto">
            {visibleList.map((src) => (
              <button
                key={src}
                type="button"
                className={`relative aspect-square h-18 w-18 overflow-hidden rounded-xl border ${
                  active === src ? "border-primary" : "border-border"
                }`}
                onClick={() => {
                  setActive(src);
                  const index = visibleList.indexOf(src);
                  if (index >= 0) setActiveIndex(index);
                }}
              >
                <Image
                  src={src}
                  alt="Превью товара"
                  fill
                  className="h-full w-full object-contain p-1.5"
                  sizes="72px"
                  onError={() => markFailed(src)}
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

