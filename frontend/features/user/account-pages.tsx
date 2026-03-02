"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Copy, Download, History, LogOut, Mail, Save, ShieldCheck, Sparkles, Trash2,
  UserRound, Camera, Globe, MapPin, Phone, MessageSquare, Key, LayoutGrid,
  Settings, Fingerprint, Activity, Clock, LogIn, ChevronRight, ExternalLink
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuthMe, useLogout } from "@/features/auth/use-auth";
import { useNotificationPreferences, useUpdateNotificationPreferences, useUpdateUserProfile, useUserProfile } from "@/features/user/use-profile";
import { useFavorites } from "@/features/user/use-favorites";
import { authApi, userApi } from "@/lib/api/openapi-client";
import { cn } from "@/lib/utils/cn";
import { formatPrice } from "@/lib/utils/format";
import { defaultProfilePreferences, type LocalProfileDraft, type ProfilePreferences, useProfileStore } from "@/store/profile.store";
import { useRecentlyViewedStore } from "@/store/recentlyViewed.store";

const emptyProfileForm: LocalProfileDraft = {
  display_name: "",
  phone: "",
  city: "",
  telegram: "",
  about: ""
};

const normalizeDraft = (draft: LocalProfileDraft): LocalProfileDraft => ({
  display_name: draft.display_name.trim(),
  phone: draft.phone.trim(),
  city: draft.city.trim(),
  telegram: draft.telegram.trim(),
  about: draft.about.trim()
});

const normalizeTelegram = (value: string, email?: string): string => {
  const normalized = value.trim();
  if (!normalized) return "";
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (normalizedEmail && normalized.toLowerCase() === normalizedEmail) {
    return "";
  }
  return normalized;
};

const formatShortAccountId = (value: string) => {
  const normalized = value.trim();
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
};

const formatDateTime = (value?: string) => {
  if (!value) return "Никогда";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Никогда";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
  }
  return fallback;
};

const parseDateMs = (value?: string) => {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const evaluatePasswordStrength = (value: string) => {
  const password = value.trim();
  const checks = {
    minLength12: password.length >= 12,
    hasUpper: /[A-Z]/.test(password),
    hasLower: /[a-z]/.test(password),
    hasDigit: /\d/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const label = score >= 5 ? "strong" : score >= 3 ? "medium" : "weak";
  return { score, label, checks };
};

const isHighRiskSession = (session: { ip_address: string; location: string; last_seen_at: string }) => {
  const location = String(session.location || "").trim().toLowerCase();
  const ip = String(session.ip_address || "").trim().toLowerCase();
  const staleMs = Date.now() - parseDateMs(session.last_seen_at);
  const staleDays = staleMs > 0 ? staleMs / (1000 * 60 * 60 * 24) : 0;
  return location === "unknown" || ip === "unknown" || staleDays >= 45;
};

export function ProfileClient() {
  const queryClient = useQueryClient();
  const me = useAuthMe();
  const profileQuery = useUserProfile();
  const updateProfile = useUpdateUserProfile();
  const notificationPreferences = useNotificationPreferences();
  const updateNotificationPreferences = useUpdateNotificationPreferences();
  const logout = useLogout();
  const favorites = useFavorites();
  const recentItems = useRecentlyViewedStore((s) => s.items);
  const clearRecent = useRecentlyViewedStore((s) => s.clear);
  const mergeRemoteRecent = useRecentlyViewedStore((s) => s.mergeRemote);
  const storedDraft = useProfileStore((s) => s.draft);
  const preferences = useProfileStore((s) => s.preferences);
  const saveDraft = useProfileStore((s) => s.saveDraft);
  const resetDraft = useProfileStore((s) => s.resetDraft);
  const setPreference = useProfileStore((s) => s.setPreference);
  const resetPreferences = useProfileStore((s) => s.resetPreferences);
  const remoteRecentlyViewed = useQuery({
    queryKey: ["user", "recently-viewed"],
    enabled: Boolean(me.data?.id),
    queryFn: async () => {
      const { data } = await userApi.recentlyViewed();
      return data;
    }
  });
  const [profileForm, setProfileForm] = useState<LocalProfileDraft>(() => ({ ...emptyProfileForm, ...storedDraft }));
  const [hydratedFromServer, setHydratedFromServer] = useState(false);
  const [hydratedPreferences, setHydratedPreferences] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [revokeOtherSessionsOnPasswordChange, setRevokeOtherSessionsOnPasswordChange] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(Boolean(me.data?.twofa_enabled));
  const [twoFactorSetupPayload, setTwoFactorSetupPayload] = useState<{
    secret: string;
    qr_svg: string;
    recovery_codes: string[];
    otpauth_url: string;
  } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [recoveryCodesModalOpen, setRecoveryCodesModalOpen] = useState(false);
  const [latestRecoveryCodes, setLatestRecoveryCodes] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const sessionsQuery = useQuery({
    queryKey: ["auth", "sessions"],
    enabled: Boolean(me.data?.id),
    queryFn: async () => {
      const { data } = await authApi.sessions();
      return data;
    }
  });

  const changePasswordMutation = useMutation({
    mutationFn: async (payload: { current_password: string; new_password: string; revoke_other_sessions: boolean }) => {
      const { data } = await authApi.changePassword(payload);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
    }
  });

  const setupTwoFactorMutation = useMutation({
    mutationFn: async () => {
      const { data } = await authApi.twoFactorSetup();
      return data;
    }
  });

  const verifyTwoFactorMutation = useMutation({
    mutationFn: async (code: string) => {
      const { data } = await authApi.twoFactorVerify({ code });
      return data;
    }
  });

  const disableTwoFactorMutation = useMutation({
    mutationFn: async () => {
      const { data } = await authApi.twoFactorDisable();
      return data;
    }
  });

  const revokeSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const { data } = await authApi.revokeSession(sessionId);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    }
  });

  const revokeOtherSessionsMutation = useMutation({
    mutationFn: async () => {
      const { data } = await authApi.revokeOtherSessions();
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
    }
  });

  useEffect(() => {
    if (!profileQuery.data || hydratedFromServer) return;
    const serverDraft: LocalProfileDraft = {
      display_name: profileQuery.data.display_name || profileQuery.data.full_name || "",
      phone: profileQuery.data.phone || "",
      city: profileQuery.data.city || "",
      telegram: normalizeTelegram(profileQuery.data.telegram || "", me.data?.email),
      about: profileQuery.data.about || ""
    };
    const normalizedStored = {
      ...normalizeDraft(storedDraft),
      telegram: normalizeTelegram(storedDraft.telegram || "", me.data?.email)
    };
    const hasLocalBackup = Object.values(normalizedStored).some((value) => Boolean(value));
    const serverUpdatedAt = profileQuery.data.updated_at ? new Date(profileQuery.data.updated_at).getTime() : 0;
    const localUpdatedAt = storedDraft.updated_at ? new Date(storedDraft.updated_at).getTime() : 0;
    const preferLocalBackup = hasLocalBackup && localUpdatedAt > serverUpdatedAt;
    setProfileForm(preferLocalBackup ? { ...serverDraft, ...normalizedStored } : serverDraft);
    setHydratedFromServer(true);
  }, [hydratedFromServer, me.data?.email, profileQuery.data, storedDraft]);

  useEffect(() => {
    if (!remoteRecentlyViewed.data?.length) return;
    mergeRemoteRecent(remoteRecentlyViewed.data);
  }, [mergeRemoteRecent, remoteRecentlyViewed.data]);

  useEffect(() => {
    if (!notificationPreferences.data || hydratedPreferences) return;
    setPreference("price_drop_alerts", notificationPreferences.data.price_drop_alerts);
    setPreference("stock_alerts", notificationPreferences.data.stock_alerts);
    setPreference("weekly_digest", notificationPreferences.data.weekly_digest);
    setPreference("public_profile", notificationPreferences.data.public_profile);
    setPreference("compact_view", notificationPreferences.data.compact_view);
    setHydratedPreferences(true);
  }, [hydratedPreferences, notificationPreferences.data, setPreference]);

  useEffect(() => {
    setTwoFactorEnabled(Boolean(me.data?.twofa_enabled));
  }, [me.data?.twofa_enabled]);

  useEffect(() => {
    if (!status && !copyStatus) return;
    const timeout = setTimeout(() => {
      setStatus(null);
      setCopyStatus(null);
    }, 2400);
    return () => clearTimeout(timeout);
  }, [copyStatus, status]);

  const baselineDraft = useMemo<LocalProfileDraft>(
    () => ({
      display_name: profileQuery.data?.display_name || me.data?.full_name || "",
      phone: profileQuery.data?.phone || "",
      city: profileQuery.data?.city || "",
      telegram: normalizeTelegram(profileQuery.data?.telegram || "", me.data?.email),
      about: profileQuery.data?.about || ""
    }),
    [me.data?.email, me.data?.full_name, profileQuery.data?.about, profileQuery.data?.city, profileQuery.data?.display_name, profileQuery.data?.phone, profileQuery.data?.telegram]
  );

  const hasDraftChanges = useMemo(
    () =>
      JSON.stringify({ ...normalizeDraft(profileForm), telegram: normalizeTelegram(profileForm.telegram, me.data?.email) }) !==
      JSON.stringify({ ...normalizeDraft(baselineDraft), telegram: normalizeTelegram(baselineDraft.telegram, me.data?.email) }),
    [baselineDraft, me.data?.email, profileForm]
  );

  const completionScore = useMemo(() => {
    const checks = [
      Boolean(me.data?.email),
      Boolean(me.data?.full_name),
      Boolean(profileForm.display_name.trim()),
      Boolean(profileForm.phone.trim()),
      Boolean(profileForm.city.trim()),
      Boolean(profileForm.about.trim())
    ];
    const filled = checks.filter(Boolean).length;
    return Math.round((filled / checks.length) * 100);
  }, [me.data?.email, me.data?.full_name, profileForm.about, profileForm.city, profileForm.display_name, profileForm.phone]);

  const latestViewed = recentItems[0];
  const recentPreview = recentItems.slice(0, 5);
  const favoritesCount = favorites.data?.length ?? 0;
  const recentCount = recentItems.length;
  const newPasswordStrength = useMemo(() => evaluatePasswordStrength(newPassword), [newPassword]);
  const sessionRiskSummary = useMemo(() => {
    const sessions = sessionsQuery.data ?? [];
    const highRisk = sessions.filter((session) => isHighRiskSession(session)).length;
    return { total: sessions.length, highRisk };
  }, [sessionsQuery.data]);
  const securityScore = useMemo(() => {
    let score = 0;
    if (twoFactorEnabled) score += 45;
    if (sessionRiskSummary.total > 0) {
      const safeShare = (sessionRiskSummary.total - sessionRiskSummary.highRisk) / sessionRiskSummary.total;
      score += Math.round(safeShare * 35);
      if (sessionRiskSummary.total <= 2) score += 20;
    }
    return Math.max(0, Math.min(100, score));
  }, [sessionRiskSummary.highRisk, sessionRiskSummary.total, twoFactorEnabled]);

  const onDraftFieldChange = (field: keyof LocalProfileDraft, value: string) => {
    setProfileForm((prev) => ({ ...prev, [field]: value }));
  };

  const onPreferenceChange = <K extends keyof ProfilePreferences>(key: K, value: ProfilePreferences[K]) => {
    setPreference(key, value);
    void updateNotificationPreferences
      .mutateAsync({ [key]: value } as Pick<ProfilePreferences, K>)
      .catch(() => setStatus("Не удалось синхронизировать настройки уведомлений с сервером."));
  };

  const onResetPreferences = () => {
    resetPreferences();
    void updateNotificationPreferences
      .mutateAsync(defaultProfilePreferences)
      .catch(() => setStatus("Локальные настройки сброшены, но серверную синхронизацию выполнить не удалось."));
  };

  const onClearRecent = () => {
    clearRecent();
    if (me.data?.id) {
      void userApi.clearRecentlyViewed().catch(() => undefined);
    }
  };

  const onChangePassword = async () => {
    if (newPassword.trim().length < 8) {
      setStatus("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setStatus("New password confirmation does not match.");
      return;
    }
    if (newPasswordStrength.score < 3) {
      setStatus("Use a stronger password: 12+ chars, mixed case, digits and special symbols.");
      return;
    }
    try {
      const result = await changePasswordMutation.mutateAsync({
        current_password: currentPassword,
        new_password: newPassword,
        revoke_other_sessions: revokeOtherSessionsOnPasswordChange
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setStatus(
        result.revoked_sessions > 0
          ? `Password changed. Revoked ${result.revoked_sessions} other sessions.`
          : "Password changed."
      );
    } catch (error) {
      setStatus(getErrorMessage(error, "Failed to change password."));
    }
  };

  const onStartTwoFactorSetup = async () => {
    try {
      const payload = await setupTwoFactorMutation.mutateAsync();
      setTwoFactorSetupPayload(payload);
      setTwoFactorCode("");
      setLatestRecoveryCodes([]);
      setRecoveryCodesModalOpen(false);
      setStatus("2FA setup created. Scan QR and confirm with one-time code.");
    } catch (error) {
      setStatus(getErrorMessage(error, "Failed to initialize 2FA setup."));
    }
  };

  const onVerifyTwoFactorSetup = async () => {
    if (!twoFactorCode.trim()) {
      setStatus("Enter 2FA code to complete setup.");
      return;
    }
    try {
      const result = await verifyTwoFactorMutation.mutateAsync(twoFactorCode.trim());
      if ("enabled" in result && result.enabled) {
        const recoveryCodes = twoFactorSetupPayload?.recovery_codes ?? [];
        setTwoFactorEnabled(true);
        setTwoFactorSetupPayload(null);
        setTwoFactorCode("");
        setLatestRecoveryCodes(recoveryCodes);
        setRecoveryCodesModalOpen(recoveryCodes.length > 0);
        setStatus("2FA enabled.");
        await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      } else {
        setStatus("Unexpected 2FA verification response.");
      }
    } catch (error) {
      setStatus(getErrorMessage(error, "Invalid 2FA code."));
    }
  };

  const onDisableTwoFactor = async () => {
    try {
      await disableTwoFactorMutation.mutateAsync();
      setTwoFactorEnabled(false);
      setTwoFactorSetupPayload(null);
      setTwoFactorCode("");
      setLatestRecoveryCodes([]);
      setRecoveryCodesModalOpen(false);
      setStatus("2FA disabled.");
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    } catch (error) {
      setStatus(getErrorMessage(error, "Failed to disable 2FA."));
    }
  };

  const onRevokeSession = async (sessionId: string) => {
    try {
      await revokeSessionMutation.mutateAsync(sessionId);
      setStatus("Session revoked.");
    } catch (error) {
      setStatus(getErrorMessage(error, "Failed to revoke session."));
    }
  };

  const onRevokeOtherSessions = async () => {
    try {
      const result = await revokeOtherSessionsMutation.mutateAsync();
      setStatus(result.revoked > 0 ? `Revoked ${result.revoked} sessions.` : "No other sessions to revoke.");
    } catch (error) {
      setStatus(getErrorMessage(error, "Failed to revoke other sessions."));
    }
  };

  const saveServerProfile = async () => {
    const normalized = {
      ...normalizeDraft(profileForm),
      telegram: normalizeTelegram(profileForm.telegram, me.data?.email)
    };
    if (normalized.display_name.length < 2) {
      setStatus("Имя должно содержать минимум 2 символа.");
      return;
    }
    try {
      await updateProfile.mutateAsync(normalized);
      saveDraft(normalized);
      setStatus("Профиль сохранён.");
    } catch (error) {
      saveDraft(normalized);
      setStatus(getErrorMessage(error, "Не удалось сохранить профиль на сервере. Локальная копия обновлена."));
    }
  };

  const resetProfileForm = () => {
    if (!hasDraftChanges) return;
    setProfileForm(baselineDraft);
    resetDraft();
    setStatus("Изменения сброшены.");
  };

  const exportAccountSnapshot = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      account: me.data ?? null,
      server_profile: profileQuery.data ?? null,
      local_profile: normalizeDraft(profileForm),
      preferences,
      favorites: favorites.data ?? [],
      recently_viewed: recentItems
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const emailPart = me.data?.email?.split("@")[0] ?? "account";
    anchor.href = url;
    anchor.download = `profile_snapshot_${emailPart}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    setStatus("Снимок профиля экспортирован.");
  };

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`${label} скопирован.`);
    } catch {
      setCopyStatus(`Не удалось скопировать: ${label.toLowerCase()}.`);
    }
  };

  if (me.isLoading || (profileQuery.isLoading && !profileQuery.data)) {
    return (
      <div className="container space-y-4 py-6">
        <Skeleton className="h-40 w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  if (me.error || !me.data) {
    return <ErrorState title="Профиль недоступен" message="Сейчас не удалось загрузить профиль. Попробуйте обновить страницу позже." />;
  }

  return (
    <div className="container min-h-screen space-y-12 py-12">
      {/* Immersive Header Card */}
      <motion.section
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[3rem] border border-border/40 bg-card p-1 shadow-2xl"
      >
        <div className="absolute inset-0 bg-gradient-to-tr from-primary/[0.04] to-secondary/10 pointer-events-none" />
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-8 p-8 md:p-12">
          <div className="flex flex-wrap items-center gap-8">
            <div className="relative group">
              <div className="absolute -inset-1 rounded-[2.5rem] bg-gradient-to-tr from-primary to-secondary opacity-30 blur group-hover:opacity-50 transition-all" />
              <Avatar name={me.data.full_name} className="relative h-28 w-28 rounded-[2rem] border-4 border-white shadow-xl text-3xl font-black" />
              <button className="absolute -bottom-2 -right-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-white shadow-lg text-primary hover:scale-110 active:scale-95 transition-all">
                <Camera className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="space-y-1">
                <h1 className="font-heading text-4xl font-[900] tracking-tighter">
                  {profileForm.display_name || me.data.full_name}
                </h1>
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm font-bold text-muted-foreground">{me.data.email}</p>
                  <div className="h-1 w-1 rounded-full bg-border" />
                  <Badge className="bg-primary/5 text-primary border-primary/20 px-4 py-1.5 font-black rounded-full text-[10px] uppercase shadow-none">
                    ID: {formatShortAccountId(me.data.id)}
                  </Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-secondary/40 px-4 py-1.5 font-black rounded-full text-[10px] uppercase shadow-none">
                  {favoritesCount} ИЗБРАННОЕ
                </Badge>
                <Badge className="bg-secondary/40 px-4 py-1.5 font-black rounded-full text-[10px] uppercase shadow-none tracking-widest leading-none">
                  {recentCount} ПРОСМОТРОВ
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" className="h-14 rounded-2xl px-6 font-bold border-2 transition-all hover:bg-secondary" onClick={exportAccountSnapshot}>
              <Download className="mr-2 h-5 w-5" /> Экспорт
            </Button>
            <Button
              variant="destructive"
              className="h-14 rounded-2xl px-6 font-bold shadow-xl shadow-destructive/20"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              <LogOut className="mr-2 h-5 w-5" /> {logout.isPending ? "Выход..." : "Выйти"}
            </Button>
          </div>
        </div>
      </motion.section>

      {status && (
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="fixed bottom-8 right-8 z-50 rounded-2xl bg-primary px-6 py-4 font-bold text-white shadow-2xl shadow-primary/40">
          {status}
        </motion.div>
      )}

      <div className="grid gap-10 lg:grid-cols-[1fr_400px]">
        {/* Left Column: Essential Settings */}
        <div className="space-y-10">
          {/* Profile Information */}
          <section className="space-y-6">
            <div className="flex items-end justify-between px-4">
              <div className="space-y-1">
                <h2 className="text-2xl font-black italic tracking-tight">Public Profile</h2>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Основная информация</p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={resetProfileForm} disabled={!hasDraftChanges || updateProfile.isPending} className="font-bold">
                  Сбросить
                </Button>
                <Button size="sm" onClick={saveServerProfile} disabled={!hasDraftChanges || updateProfile.isPending} className="h-10 rounded-xl px-6 font-black shadow-lg shadow-primary/20">
                  {updateProfile.isPending ? "Сохранение..." : "Сохранить изменения"}
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="group relative rounded-[2rem] border border-border/40 bg-secondary/10 p-6 transition-all hover:bg-secondary/20">
                <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Отображаемое имя</label>
                <Input
                  value={profileForm.display_name}
                  onChange={(e) => onDraftFieldChange("display_name", e.target.value)}
                  className="border-none bg-transparent p-0 text-lg font-black focus-visible:ring-0"
                />
                <UserRound className="absolute right-6 top-6 h-5 w-5 text-muted-foreground/20 group-hover:text-primary/40 transition-colors" />
              </div>
              <div className="group relative rounded-[2rem] border border-border/40 bg-secondary/10 p-6 transition-all hover:bg-secondary/20">
                <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Телефон</label>
                <Input
                  placeholder="+998 ..."
                  value={profileForm.phone}
                  onChange={(e) => onDraftFieldChange("phone", e.target.value)}
                  className="border-none bg-transparent p-0 text-lg font-black focus-visible:ring-0"
                />
                <Phone className="absolute right-6 top-6 h-5 w-5 text-muted-foreground/20 group-hover:text-primary/40 transition-colors" />
              </div>
              <div className="group relative rounded-[2rem] border border-border/40 bg-secondary/10 p-6 transition-all hover:bg-secondary/20">
                <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Город</label>
                <Input
                  value={profileForm.city}
                  onChange={(e) => onDraftFieldChange("city", e.target.value)}
                  className="border-none bg-transparent p-0 text-lg font-black focus-visible:ring-0"
                />
                <MapPin className="absolute right-6 top-6 h-5 w-5 text-muted-foreground/20 group-hover:text-primary/40 transition-colors" />
              </div>
              <div className="group relative rounded-[2rem] border border-border/40 bg-secondary/10 p-6 transition-all hover:bg-secondary/20">
                <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Telegram</label>
                <Input
                  placeholder="@username"
                  value={profileForm.telegram}
                  onChange={(e) => onDraftFieldChange("telegram", e.target.value)}
                  className="border-none bg-transparent p-0 text-lg font-black focus-visible:ring-0"
                />
                <MessageSquare className="absolute right-6 top-6 h-5 w-5 text-muted-foreground/20 group-hover:text-primary/40 transition-colors" />
              </div>
            </div>

            <div className="group relative rounded-[2.5rem] border border-border/40 bg-secondary/10 p-8 transition-all hover:bg-secondary/20">
              <label className="mb-4 block text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Биография</label>
              <Textarea
                value={profileForm.about}
                onChange={(e) => onDraftFieldChange("about", e.target.value)}
                placeholder="Расскажите немного о себе..."
                className="min-h-[120px] resize-none border-none bg-transparent p-0 text-base font-bold leading-relaxed focus-visible:ring-0"
              />
            </div>
          </section>

          {/* Preferences */}
          <section className="space-y-6">
            <div className="px-4 space-y-1">
              <h2 className="text-2xl font-black italic tracking-tight">System Preferences</h2>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Управление уведомлениями и опытом</p>
            </div>
            <div className="grid gap-4">
              <PreferenceRow
                title="Price Radar"
                description="Алерты о снижении цены на отслеживаемые товары."
                checked={preferences.price_drop_alerts}
                onChange={(checked) => onPreferenceChange("price_drop_alerts", checked)}
                icon={Activity}
              />
              <PreferenceRow
                title="Stock Guardian"
                description="Уведомления о пополнении запасов в магазинах."
                checked={preferences.stock_alerts}
                onChange={(checked) => onPreferenceChange("stock_alerts", checked)}
                icon={Sparkles}
              />
              <PreferenceRow
                title="Weekly Intel"
                description="Еженедельный дайджест лучших предложений и акций."
                checked={preferences.weekly_digest}
                onChange={(checked) => onPreferenceChange("weekly_digest", checked)}
                icon={Clock}
              />
            </div>
          </section>
        </div>

        {/* Right Column: Security & Metrics */}
        <div className="space-y-10">
          {/* Security Hub */}
          <section className="relative overflow-hidden rounded-[2.5rem] border border-border/40 bg-card p-8 shadow-xl">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-primary via-secondary to-primary pointer-events-none" />
            <div className="mb-8 flex items-center justify-between">
              <div className="space-y-1">
                <h2 className="text-xl font-bold italic tracking-tight">Security Hub</h2>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Защита аккаунта</p>
              </div>
              <div className={cn(
                "flex h-12 w-12 items-center justify-center rounded-2xl font-black text-white shadow-lg",
                securityScore >= 80 ? "bg-emerald-500 shadow-emerald-500/20" : securityScore >= 50 ? "bg-amber-500 shadow-amber-500/20" : "bg-destructive shadow-destructive-20"
              )}>
                {securityScore}
              </div>
            </div>

            <div className="space-y-6">
              <div className="space-y-4 rounded-3xl bg-secondary/20 p-6">
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-border/20">
                    <Fingerprint className="h-5 w-5 text-primary" />
                  </div>
                  <p className="text-sm font-black">2FA Status</p>
                  <Badge className={cn("rounded-full px-4 font-black shadow-none", twoFactorEnabled ? "bg-emerald-500/10 text-emerald-600 border-none px-4" : "bg-warning/10 text-warning-foreground border-none px-4")}>
                    {twoFactorEnabled ? "ВКЛ" : "ОТКЛ"}
                  </Badge>
                </div>
                {!twoFactorEnabled ? (
                  <Button size="sm" onClick={onStartTwoFactorSetup} className="h-10 w-full rounded-xl font-black shadow-lg shadow-primary/20">
                    Настроить 2FA
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={onDisableTwoFactor} className="h-10 w-full rounded-xl font-bold text-muted-foreground">
                    Отключить 2FA
                  </Button>
                )}
              </div>

              {twoFactorSetupPayload && (
                <div className="space-y-4 pt-2">
                  <div className="rounded-3xl border-2 border-primary/20 bg-primary/5 p-6 space-y-4">
                    <div className="mx-auto flex h-40 w-40 items-center justify-center rounded-2xl bg-white p-4 shadow-inner" dangerouslySetInnerHTML={{ __html: twoFactorSetupPayload.qr_svg }} />
                    <div className="space-y-2">
                      <Input placeholder="6-значный код..." inputMode="numeric" value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value)} className="h-12 rounded-2xl border-none bg-white shadow-inner font-black text-center tracking-[0.5em] text-lg" />
                      <Button size="sm" onClick={onVerifyTwoFactorSetup} className="h-12 w-full rounded-2xl font-black shadow-xl shadow-primary/20">
                        Подтвердить и активировать
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 text-center">Active Sessions</p>
                <div className="space-y-2">
                  {sessionsQuery.data?.slice(0, 3).map((session) => (
                    <div key={session.id} className="flex items-center justify-between rounded-2xl border border-border/30 bg-background/50 p-4 transition-all hover:border-primary/20">
                      <div className="space-y-1">
                        <p className="text-xs font-black">{session.device} {session.is_current && <span className="text-[10px] text-primary">(текущая)</span>}</p>
                        <p className="text-[10px] font-medium text-muted-foreground">{session.ip_address} · {session.location}</p>
                      </div>
                      {!session.is_current && (
                        <button onClick={() => onRevokeSession(session.id)} className="text-muted-foreground/40 hover:text-destructive transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {sessionsQuery.data && sessionsQuery.data.length > 3 && (
                    <Button variant="ghost" className="w-full text-[10px] font-black uppercase text-primary">Показать все сессии</Button>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Metrics & Identity */}
          <section className="rounded-[2.5rem] bg-secondary/10 p-8 space-y-6">
            <div className="space-y-1">
              <h2 className="text-lg font-bold italic tracking-tight">Identity Vault</h2>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Квалификационные данные</p>
            </div>
            <div className="space-y-1">
              <StatRow label="Account Email" value={me.data.email} icon={Mail} />
              <StatRow label="Account Status" value="Verified" icon={ShieldCheck} />
              <StatRow label="Language" value="Russian (RU)" icon={Globe} />
              <StatRow label="Timezone" value="Asia/Tashkent" icon={Clock} />
            </div>

            <div className="pt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white p-4 shadow-sm border border-border/20 text-center">
                <p className="text-[10px] font-black uppercase text-muted-foreground/60 mb-1 leading-none">Избранное</p>
                <p className="text-2xl font-black italic text-primary">{favoritesCount}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm border border-border/20 text-center">
                <p className="text-[10px] font-black uppercase text-muted-foreground/60 mb-1 leading-none">Недавнее</p>
                <p className="text-2xl font-black italic text-secondary-foreground">{recentCount}</p>
              </div>
            </div>
          </section>

          <div className="rounded-[2.5rem] bg-gradient-to-br from-primary to-secondary p-8 text-white shadow-2xl">
            <h3 className="text-xl font-black italic tracking-tight mb-2">Need Assistance?</h3>
            <p className="text-xs font-bold opacity-80 mb-6 leading-relaxed">Наша команда поддержки готова помочь вам в любое время дня и ночи.</p>
            <Button className="h-12 w-full rounded-2xl bg-white text-primary font-black hover:bg-white/90 shadow-lg shadow-black/10 transition-colors">
              Связаться с нами
            </Button>
          </div>
        </div>
      </div>

      <Modal
        open={recoveryCodesModalOpen}
        onOpenChange={setRecoveryCodesModalOpen}
        title="Recovery codes"
        footer={
          <Button size="sm" onClick={() => setRecoveryCodesModalOpen(false)} className="rounded-xl font-bold px-6">
            I saved these codes
          </Button>
        }
      >
        <div className="space-y-6">
          <div className="flex items-center gap-4 rounded-2xl bg-amber-500/10 p-4 border border-amber-500/20">
            <Key className="h-6 w-6 text-amber-600" />
            <p className="text-xs font-bold text-amber-800 leading-relaxed">
              Сохраните эти коды восстановления в надежном месте. Каждый код можно использовать один раз, если вы потеряете доступ к приложению аутентификации.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {latestRecoveryCodes.map((code) => (
              <code key={code} className="rounded-xl bg-secondary/40 px-4 py-3 text-center text-xs font-black tracking-widest">
                {code}
              </code>
            ))}
          </div>
          <Button variant="outline" className="w-full h-12 rounded-xl font-bold" onClick={() => copyValue(latestRecoveryCodes.join("\n"), "Recovery codes")}>
            <Copy className="mr-2 h-4 w-4" /> Скопировать все коды
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function PreferenceRow({
  title,
  description,
  checked,
  onChange,
  icon: Icon
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon?: any;
}) {
  return (
    <div className="group flex items-center justify-between gap-4 rounded-2xl border border-border/40 bg-secondary/10 p-4 transition-all hover:bg-secondary/20">
      <div className="flex items-center gap-4">
        {Icon && (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-border/20">
            <Icon className="h-5 w-5 text-primary/80" />
          </div>
        )}
        <div className="space-y-0.5">
          <p className="text-sm font-black tracking-tight">{title}</p>
          <p className="text-xs font-bold text-muted-foreground leading-none">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function StatRow({ label, value, icon: Icon }: { label: string; value: string; icon?: any }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border/30 last:border-none">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />}
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">{label}</span>
      </div>
      <span className="text-xs font-bold">{value}</span>
    </div>
  );
}

export function RecentlyViewedClient() {
  const me = useAuthMe();
  const items = useRecentlyViewedStore((s) => s.items);
  const clear = useRecentlyViewedStore((s) => s.clear);
  const mergeRemote = useRecentlyViewedStore((s) => s.mergeRemote);
  const remoteRecentlyViewed = useQuery({
    queryKey: ["user", "recently-viewed"],
    enabled: Boolean(me.data?.id),
    queryFn: async () => {
      const { data } = await userApi.recentlyViewed();
      return data;
    }
  });

  useEffect(() => {
    if (!remoteRecentlyViewed.data?.length) return;
    mergeRemote(remoteRecentlyViewed.data);
  }, [mergeRemote, remoteRecentlyViewed.data]);

  const clearAll = () => {
    clear();
    if (me.data?.id) {
      void userApi.clearRecentlyViewed().catch(() => undefined);
    }
  };

  return (
    <div className="container space-y-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-extrabold">Недавно просмотренные</h1>
        <Button variant="ghost" onClick={clearAll} disabled={items.length === 0}>
          Очистить
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState title="Пока нет просмотров" message="Откройте товар из каталога, и он появится в этом списке." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="space-y-2 p-4">
                <Link href={`/product/${item.slug}`} className="line-clamp-2 text-sm font-semibold text-primary hover:underline">
                  {item.title}
                </Link>
                <p className="text-xs text-muted-foreground">Просмотрено: {formatDateTime(item.viewedAt)}</p>
                {item.minPrice != null ? <Badge className="bg-secondary/80">{formatPrice(item.minPrice)}</Badge> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
