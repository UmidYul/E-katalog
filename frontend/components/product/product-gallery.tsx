"use client";

import Image from "next/image";
import { useState } from "react";

export function ProductGallery({ images }: { images: string[] }) {
  const fallback = "https://images.unsplash.com/photo-1526738549149-8e07eca6c147?auto=format&fit=crop&w=1000&q=80";
  const list = images.length ? images : [fallback];
  const [active, setActive] = useState<string>(list[0] ?? fallback);

  return (
    <div className="space-y-3">
      <div className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-card">
        <Image src={active} alt="Product image" fill className="object-contain p-3" sizes="(max-width: 768px) 100vw, 40vw" />
      </div>
      <div className="grid grid-cols-5 gap-2">
        {list.slice(0, 5).map((src) => (
          <button key={src} className={`relative aspect-square overflow-hidden rounded-xl border ${active === src ? "border-primary" : "border-border"}`} onClick={() => setActive(src)}>
            <Image src={src} alt="Product thumbnail" fill className="object-contain p-1" sizes="120px" />
          </button>
        ))}
      </div>
    </div>
  );
}

