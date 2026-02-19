import { create } from "zustand";

type UiState = {
  mobileFilterOpen: boolean;
  dashboardSidebarOpen: boolean;
  theme: "light" | "dark";
  setMobileFilterOpen: (open: boolean) => void;
  setDashboardSidebarOpen: (open: boolean) => void;
  toggleDashboardSidebar: () => void;
  toggleTheme: () => void;
};

export const useUiStore = create<UiState>((set, get) => ({
  mobileFilterOpen: false,
  dashboardSidebarOpen: true,
  theme: "light",
  setMobileFilterOpen: (mobileFilterOpen) => set({ mobileFilterOpen }),
  setDashboardSidebarOpen: (dashboardSidebarOpen) => set({ dashboardSidebarOpen }),
  toggleDashboardSidebar: () => set({ dashboardSidebarOpen: !get().dashboardSidebarOpen }),
  toggleTheme: () => set({ theme: get().theme === "dark" ? "light" : "dark" })
}));

