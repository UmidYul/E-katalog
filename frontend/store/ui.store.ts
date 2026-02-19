import { create } from "zustand";

type UiState = {
  mobileFilterOpen: boolean;
  theme: "light" | "dark";
  setMobileFilterOpen: (open: boolean) => void;
  toggleTheme: () => void;
};

export const useUiStore = create<UiState>((set, get) => ({
  mobileFilterOpen: false,
  theme: "light",
  setMobileFilterOpen: (mobileFilterOpen) => set({ mobileFilterOpen }),
  toggleTheme: () => set({ theme: get().theme === "dark" ? "light" : "dark" })
}));

