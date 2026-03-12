import { create } from "zustand";
import { persist } from "zustand/middleware";

type RecentlyViewedItem = {
  id: string;
  slug: string;
  title: string;
  imageUrl?: string | null;
  minPrice?: number | null;
  viewedAt: string;
};

type RecentlyViewedState = {
  items: RecentlyViewedItem[];
  push: (item: Omit<RecentlyViewedItem, "viewedAt">) => void;
  mergeRemote: (items: Array<{ id: string; slug: string; title: string; image_url?: string | null; min_price?: number | null; viewed_at: string }>) => void;
  clear: () => void;
};

export const useRecentlyViewedStore = create<RecentlyViewedState>()(
  persist(
    (set, get) => ({
      items: [],
      push: (item) => {
        const normalizedId = String(item.id);
        const next = [
          { ...item, id: normalizedId, viewedAt: new Date().toISOString() },
          ...get().items.filter((existing) => String(existing.id) !== normalizedId),
        ].slice(0, 30);
        set({ items: next });
      },
      mergeRemote: (items) => {
        const local = get().items;
        const map = new Map<string, RecentlyViewedItem>();

        const toItem = (entry: { id: string; slug: string; title: string; image_url?: string | null; min_price?: number | null; viewed_at: string }): RecentlyViewedItem => ({
          id: String(entry.id),
          slug: entry.slug,
          title: entry.title,
          imageUrl: entry.image_url ?? null,
          minPrice: entry.min_price ?? null,
          viewedAt: entry.viewed_at,
        });

        for (const item of local) {
          map.set(String(item.id), item);
        }
        for (const remote of items) {
          const normalized = toItem(remote);
          const current = map.get(normalized.id);
          const merged = !normalized.imageUrl && current?.imageUrl ? { ...normalized, imageUrl: current.imageUrl } : normalized;
          if (!current || new Date(merged.viewedAt).getTime() > new Date(current.viewedAt).getTime()) {
            map.set(merged.id, merged);
          }
        }

        const merged = Array.from(map.values())
          .sort((a, b) => new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime())
          .slice(0, 30);

        set({ items: merged });
      },
      clear: () => set({ items: [] })
    }),
    {
      name: "recently-viewed-store",
      skipHydration: true
    }
  )
);

