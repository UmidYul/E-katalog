import { create } from "zustand";

type DashboardFiltersState = {
  query: string;
  page: number;
  limit: number;
  setQuery: (query: string) => void;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  reset: () => void;
};

const defaults = {
  query: "",
  page: 1,
  limit: 20,
};

export const useDashboardFiltersStore = create<DashboardFiltersState>((set) => ({
  ...defaults,
  setQuery: (query) => set({ query, page: 1 }),
  setPage: (page) => set({ page }),
  setLimit: (limit) => set({ limit, page: 1 }),
  reset: () => set(defaults),
}));
