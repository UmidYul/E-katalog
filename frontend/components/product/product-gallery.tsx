"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils/cn";

type ProductGalleryProps = {
  images: string[];
  priceDrop?: number;
  isNew?: boolean;
  categoryLabel?: string;
  actions?: ReactNode;
};

const CategoryFallbackIcon = ({ label }: { label?: string }) => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-secondary/20 text-center">
    <svg viewBox="0 0 48 48" className="h-16 w-16 text-muted-foreground" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="13" y="4" width="22" height="40" rx="4" stroke="currentColor" strokeWidth="2" />
      <rect x="19" y="9" width="10" height="1.5" rx="0.75" fill="currentColor" />
      <circle cx="24" cy="37" r="2" fill="currentColor" />
    </svg>
    <p className="px-3 text-sm text-muted-foreground">{label ? `${label} расми` : "Товар расми мавжуд эмас"}</p>
  </div>
);

const normalizeImages = (images: string[]) => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const image of images) {
    const value = String(image ?? "").trim();
    if (!value || seen.has(value)) continue;
    if (!/^https?:\/\//i.test(value) && !value.startsWith("/")) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
};

export function ProductGallery({ images, priceDrop = 0, isNew = false, categoryLabel, actions }: ProductGalleryProps) {
  const gallery = useMemo(() => normalizeImages(images), [images]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const touchStart = useRef<number | null>(null);

  const safeIndex = Math.min(activeIndex, Math.max(gallery.length - 1, 0));
  const activeImage = gallery[safeIndex] ?? null;

  const move = (direction: 1 | -1) => {
    if (gallery.length <= 1) return;
    setActiveIndex((current) => {
      const next = current + direction;
      if (next < 0) return gallery.length - 1;
      if (next >= gallery.length) return 0;
      return next;
    });
  };

  return (
    <section className="space-y-3">
      <div
        className="relative h-[300px] overflow-hidden rounded-2xl border border-border bg-white"
        onTouchStart={(event) => {
          touchStart.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          if (touchStart.current == null) return;
          const delta = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current;
          touchStart.current = null;
          if (Math.abs(delta) < 40) return;
          move(delta < 0 ? 1 : -1);
        }}
      >
        {priceDrop > 0 ? (
          <span className="absolute left-3 top-3 z-10 rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
            ↓ {priceDrop}%
          </span>
        ) : null}

        {isNew ? (
          <span className="absolute left-3 top-10 z-10 rounded-full bg-accent/10 px-2 py-1 text-xs font-semibold text-accent">Янги</span>
        ) : null}

        {activeImage ? (
          <button
            type="button"
            className="relative block h-full w-full cursor-zoom-in"
            onClick={() => setLightboxOpen(true)}
            aria-label="Расмни катта очиш"
          >
            <Image
              src={activeImage}
              alt="Товар расми"
              fill
              className="object-contain p-3"
              sizes="(max-width: 768px) 100vw, 260px"
              priority
            />
          </button>
        ) : (
          <CategoryFallbackIcon label={categoryLabel} />
        )}
      </div>

      {gallery.length > 1 ? (
        <div className="grid grid-cols-5 gap-2">
          {gallery.slice(0, 5).map((image, index) => (
            <button
              key={image}
              type="button"
              className={cn(
                "relative h-14 overflow-hidden rounded-lg border bg-white",
                safeIndex === index ? "border-accent" : "border-border"
              )}
              onClick={() => setActiveIndex(index)}
              aria-label={`Расм ${index + 1}`}
            >
              <Image src={image} alt="Миниатюра" fill className="object-contain p-1" sizes="72px" />
            </button>
          ))}
        </div>
      ) : null}

      {actions ? <div className="grid grid-cols-2 gap-2">{actions}</div> : null}

      <Modal
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        title="Товар галереяси"
      >
        <div className="space-y-3">
          <div className="relative h-[340px] overflow-hidden rounded-xl border border-border bg-white">
            {activeImage ? <Image src={activeImage} alt="Товар" fill className="object-contain p-4" sizes="80vw" /> : <CategoryFallbackIcon />}
          </div>
          {gallery.length > 1 ? (
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => move(-1)} className="rounded-md border border-border px-3 py-1 text-sm">
                Олдинги
              </button>
              <span className="text-xs text-muted-foreground">
                {safeIndex + 1} / {gallery.length}
              </span>
              <button type="button" onClick={() => move(1)} className="rounded-md border border-border px-3 py-1 text-sm">
                Кейинги
              </button>
            </div>
          ) : null}
        </div>
      </Modal>
    </section>
  );
}
