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
      clear: () => set({ items: [] })
    }),
    {
      name: "recently-viewed-store",
      skipHydration: true
    }
  )
);

