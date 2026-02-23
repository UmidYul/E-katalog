import { create } from "zustand";

type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  role?: string;
};

type AuthState = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  setSession: (user: AuthUser) => void;
  clearSession: () => void;
};

export const authStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  setSession: (user) => set({ user, isAuthenticated: true }),
  clearSession: () => set({ user: null, isAuthenticated: false })
}));

