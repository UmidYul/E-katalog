import { create } from "zustand";
import { persist } from "zustand/middleware";

export type LocalProfileDraft = {
  display_name: string;
  phone: string;
  city: string;
  telegram: string;
  about: string;
  updated_at?: string;
};

export type ProfilePreferences = {
  price_drop_alerts: boolean;
  stock_alerts: boolean;
  weekly_digest: boolean;
  public_profile: boolean;
  compact_view: boolean;
};

type ProfileStore = {
  draft: LocalProfileDraft;
  preferences: ProfilePreferences;
  saveDraft: (payload: LocalProfileDraft) => void;
  resetDraft: () => void;
  setPreference: <K extends keyof ProfilePreferences>(key: K, value: ProfilePreferences[K]) => void;
  resetPreferences: () => void;
};

const emptyDraft: LocalProfileDraft = {
  display_name: "",
  phone: "",
  city: "",
  telegram: "",
  about: ""
};

export const defaultProfilePreferences: ProfilePreferences = {
  price_drop_alerts: true,
  stock_alerts: true,
  weekly_digest: false,
  public_profile: false,
  compact_view: false
};

export const useProfileStore = create<ProfileStore>()(
  persist(
    (set) => ({
      draft: emptyDraft,
      preferences: defaultProfilePreferences,
      saveDraft: (payload) => set({ draft: { ...payload, updated_at: new Date().toISOString() } }),
      resetDraft: () => set({ draft: emptyDraft }),
      setPreference: (key, value) => set((state) => ({ preferences: { ...state.preferences, [key]: value } })),
      resetPreferences: () => set({ preferences: defaultProfilePreferences })
    }),
    {
      name: "profile-store-v1",
      skipHydration: true
    }
  )
);
