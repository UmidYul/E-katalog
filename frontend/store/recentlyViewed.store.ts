import { create } from "zustand";
import { persist } from "zustand/middleware";

type RecentlyViewedItem = {
  id: string;
  slug: string;
  title: string;
  minPrice?: number | null;
  viewedAt: string;
};

type RecentlyViewedState = {
  items: RecentlyViewedItem[];
  push: (item: Omit<RecentlyViewedItem, "viewedAt">) => void;
  mergeRemote: (items: Array<{ id: string; slug: string; title: string; min_price?: number | null; viewed_at: string }>) => void;
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

        const toItem = (entry: { id: string; slug: string; title: string; min_price?: number | null; viewed_at: string }): RecentlyViewedItem => ({
          id: String(entry.id),
          slug: entry.slug,
          title: entry.title,
          minPrice: entry.min_price ?? null,
          viewedAt: entry.viewed_at,
        });

        for (const item of local) {
          map.set(String(item.id), item);
        }
        for (const remote of items) {
          const normalized = toItem(remote);
          const current = map.get(normalized.id);
          if (!current || new Date(normalized.viewedAt).getTime() > new Date(current.viewedAt).getTime()) {
            map.set(normalized.id, normalized);
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

