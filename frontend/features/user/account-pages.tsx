"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, History, LogOut, Mail, Save, ShieldCheck, Sparkles, Trash2, UserRound } from "lucide-react";
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
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
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
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <Card className="relative overflow-hidden border-primary/25">
        <div className="pointer-events-none absolute -top-16 right-0 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-24 w-24 rounded-full bg-emerald-400/20 blur-2xl" />
        <CardContent className="relative p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <Avatar name={me.data.full_name} className="h-14 w-14 text-base" />
              <div className="space-y-1">
                <p className="text-xl font-semibold">{profileForm.display_name || me.data.full_name}</p>
                <p className="text-sm text-muted-foreground">{me.data.email}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-primary text-primary-foreground">Аккаунт {formatShortAccountId(me.data.id)}</Badge>
                  <Badge>{favoritesCount} в избранном</Badge>
                  <Badge>{recentCount} недавних просмотров</Badge>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="gap-2" onClick={exportAccountSnapshot}>
                <Download className="h-4 w-4" /> Экспорт данных
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => logout.mutate()} disabled={logout.isPending}>
                <LogOut className="h-4 w-4" /> {logout.isPending ? "Выходим..." : "Выйти"}
              </Button>
            </div>
          </div>
          {status ? <p className="mt-4 text-sm text-primary">{status}</p> : null}
          {copyStatus ? <p className="mt-1 text-sm text-primary">{copyStatus}</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-primary" /> Данные профиля
              </CardTitle>
              <Badge className="bg-secondary/80">Заполнено: {completionScore}%</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${completionScore}%` }} />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Отображаемое имя</label>
                  <Input value={profileForm.display_name} onChange={(e) => onDraftFieldChange("display_name", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Телефон</label>
                  <Input placeholder="+998 ..." value={profileForm.phone} onChange={(e) => onDraftFieldChange("phone", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Город</label>
                  <Input value={profileForm.city} onChange={(e) => onDraftFieldChange("city", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Telegram</label>
                  <Input
                    placeholder="@username"
                    value={profileForm.telegram}
                    autoComplete="off"
                    onChange={(e) => onDraftFieldChange("telegram", e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">О себе</label>
                <Textarea value={profileForm.about} onChange={(e) => onDraftFieldChange("about", e.target.value)} placeholder="Кратко о себе, интересах и любимых брендах..." />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">Изменения сохраняются через API, а локальная копия профиля хранится в этом браузере.</p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={resetProfileForm} disabled={!hasDraftChanges || updateProfile.isPending}>
                    Сбросить
                  </Button>
                  <Button size="sm" className="gap-2" onClick={saveServerProfile} disabled={!hasDraftChanges || updateProfile.isPending}>
                    <Save className="h-4 w-4" /> {updateProfile.isPending ? "Сохраняем..." : "Сохранить"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Настройки
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={onResetPreferences}>
                Сбросить
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <PreferenceRow
                title="Алерты снижения цены"
                description="Показывать сигналы, когда отслеживаемые товары дешевеют."
                checked={preferences.price_drop_alerts}
                onChange={(checked) => onPreferenceChange("price_drop_alerts", checked)}
              />
              <PreferenceRow
                title="Алерты наличия"
                description="Сообщать, когда товар снова доступен в наличии."
                checked={preferences.stock_alerts}
                onChange={(checked) => onPreferenceChange("stock_alerts", checked)}
              />
              <PreferenceRow
                title="Еженедельная сводка"
                description="Показывать еженедельный обзор обновлений каталога."
                checked={preferences.weekly_digest}
                onChange={(checked) => onPreferenceChange("weekly_digest", checked)}
              />
              <PreferenceRow
                title="Публичный профиль"
                description="Разрешить публикацию карточки профиля."
                checked={preferences.public_profile}
                onChange={(checked) => onPreferenceChange("public_profile", checked)}
              />
              <PreferenceRow
                title="Компактный вид"
                description="Использовать более плотный интерфейс в кабинете."
                checked={preferences.compact_view}
                onChange={(checked) => onPreferenceChange("compact_view", checked)}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Сводка аккаунта</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <StatRow label="Email" value={me.data.email} />
              <StatRow label="Полное имя" value={me.data.full_name || "-"} />
              <StatRow label="Избранное" value={String(favoritesCount)} />
              <StatRow label="Недавние просмотры" value={String(recentCount)} />
              <StatRow label="Профиль на сервере обновлён" value={formatDateTime(profileQuery.data?.updated_at ?? undefined)} />
              <StatRow label="Локальная копия обновлена" value={formatDateTime(storedDraft.updated_at)} />
              <StatRow label="Последний просмотр" value={latestViewed ? formatDateTime(latestViewed.viewedAt) : "Нет активности"} />
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Link href="/favorites">
                  <Button variant="outline" className="w-full justify-center">
                    Избранное
                  </Button>
                </Link>
                <Link href="/recently-viewed">
                  <Button variant="outline" className="w-full justify-center">
                    Просмотры
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>


          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <History className="h-4 w-4 text-primary" /> Недавняя активность
              </CardTitle>
              <Button variant="ghost" size="sm" className="gap-1" onClick={onClearRecent} disabled={!recentItems.length}>
                <Trash2 className="h-4 w-4" /> Очистить
              </Button>
            </CardHeader>
            <CardContent>
              {recentPreview.length === 0 ? (
                <p className="text-sm text-muted-foreground">Активности пока нет.</p>
              ) : (
                <div className="space-y-3">
                  {recentPreview.map((item) => (
                    <div key={item.id} className="rounded-xl border border-border p-3">
                      <Link href={`/product/${item.slug}`} className="line-clamp-2 text-sm font-medium hover:text-primary">
                        {item.title}
                      </Link>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">{formatDateTime(item.viewedAt)}</p>
                        {item.minPrice != null ? <Badge className="bg-secondary/70">{formatPrice(item.minPrice)}</Badge> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>


        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" /> Безопасность
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border border-border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Security posture</p>
                  <Badge className={securityScore >= 80 ? "bg-emerald-600 text-white" : securityScore >= 55 ? "bg-warning text-warning-foreground" : "bg-destructive text-destructive-foreground"}>
                    {securityScore}/100
                  </Badge>
                </div>
                <div className="grid gap-2 text-xs text-muted-foreground">
                  <p>2FA: {twoFactorEnabled ? "включена" : "выключена"}</p>
                  <p>Активные сессии: {sessionRiskSummary.total}</p>
                  <p>Риск-сессии: {sessionRiskSummary.highRisk}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-border p-3">
                <div>
                  <p className="text-sm font-medium">ID аккаунта</p>
                  <p className="text-xs text-muted-foreground">{me.data.id}</p>
                </div>
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => (me.data ? copyValue(String(me.data.id), "ID аккаунта") : undefined)}>
                  <Copy className="h-4 w-4" /> Копировать
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Email</p>
                  <p className="text-xs text-muted-foreground">{me.data.email}</p>
                </div>
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => (me.data ? copyValue(me.data.email, "Email") : undefined)}>
                  <Mail className="h-4 w-4" /> Копировать
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                В API уже доступны смена пароля, управление сессиями и 2FA. Для UI-расширения можно использовать <code>docs/PROFILE_FUTURE_FEATURES.md</code>.
              </p>
              <div className="rounded-xl border border-border p-3 space-y-3">
                <p className="text-sm font-medium">Change Password</p>
                <Input
                  type="password"
                  placeholder="Current password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
                <Input
                  type="password"
                  placeholder="New password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <Input
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmNewPassword}
                  onChange={(event) => setConfirmNewPassword(event.target.value)}
                />
                <div className="rounded-lg border border-border/70 p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Password strength</span>
                    <Badge className={newPasswordStrength.label === "strong" ? "bg-emerald-600 text-white" : newPasswordStrength.label === "medium" ? "bg-warning text-warning-foreground" : "bg-secondary text-foreground"}>
                      {newPasswordStrength.label}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <div
                        key={index}
                        className={index < newPasswordStrength.score ? "h-1.5 rounded bg-primary" : "h-1.5 rounded bg-secondary"}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 p-2">
                  <span className="text-xs text-muted-foreground">Revoke other sessions after password change</span>
                  <Switch checked={revokeOtherSessionsOnPasswordChange} onCheckedChange={setRevokeOtherSessionsOnPasswordChange} />
                </div>
                <Button
                  size="sm"
                  onClick={onChangePassword}
                  disabled={changePasswordMutation.isPending || !currentPassword || !newPassword || !confirmNewPassword}
                >
                  {changePasswordMutation.isPending ? "Updating..." : "Update Password"}
                </Button>
              </div>

            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold">Two-Factor Authentication (2FA)</CardTitle>
              <Badge className={twoFactorEnabled ? "bg-emerald-600 text-white" : "bg-secondary text-foreground"}>
                {twoFactorEnabled ? "Enabled" : "Disabled"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {!twoFactorEnabled ? (
                <Button size="sm" onClick={onStartTwoFactorSetup} disabled={setupTwoFactorMutation.isPending}>
                  {setupTwoFactorMutation.isPending ? "Preparing..." : "Enable 2FA"}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={onDisableTwoFactor} disabled={disableTwoFactorMutation.isPending}>
                  {disableTwoFactorMutation.isPending ? "Disabling..." : "Disable 2FA"}
                </Button>
              )}
              {twoFactorSetupPayload ? (
                <div className="space-y-3">
                  <div className="space-y-2 rounded-lg border border-border/70 p-3">
                    <p className="text-sm font-medium">1. Scan QR code</p>
                    <p className="text-xs text-muted-foreground">Open Google/Microsoft Authenticator and scan the QR.</p>
                    <div
                      className="overflow-hidden rounded-md bg-white p-2 [&>svg]:mx-auto [&>svg]:block [&>svg]:h-auto [&>svg]:max-w-full"
                      dangerouslySetInnerHTML={{ __html: twoFactorSetupPayload.qr_svg }}
                    />
                  </div>

                  <div className="space-y-2 rounded-lg border border-border/70 p-3">
                    <p className="text-sm font-medium">2. Enter one-time code</p>
                    <Input
                      placeholder="One-time code"
                      inputMode="numeric"
                      value={twoFactorCode}
                      onChange={(event) => setTwoFactorCode(event.target.value)}
                    />
                    <Button size="sm" onClick={onVerifyTwoFactorSetup} disabled={verifyTwoFactorMutation.isPending || !twoFactorCode.trim()}>
                      {verifyTwoFactorMutation.isPending ? "Verifying..." : "Verify and Enable"}
                    </Button>
                  </div>

                  <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">3. Recovery codes will be shown after verification</p>
                    </div>
                    <p className="text-xs text-muted-foreground">After "Verify and Enable" you will see codes in a separate modal window.</p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold">Active Sessions</CardTitle>
              <Button variant="outline" size="sm" onClick={onRevokeOtherSessions} disabled={revokeOtherSessionsMutation.isPending}>
                {revokeOtherSessionsMutation.isPending ? "Revoking..." : "Revoke Others"}
              </Button>
            </CardHeader>
            <CardContent>
              {sessionsQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">Loading sessions...</p>
              ) : sessionsQuery.data && sessionsQuery.data.length ? (
                <div className="space-y-2">
                  {sessionsQuery.data.map((session) => (
                    <div key={session.id} className="rounded-lg border border-border/70 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-medium">{session.device}</p>
                            {isHighRiskSession(session) ? <Badge className="bg-warning text-warning-foreground">Risk</Badge> : <Badge className="bg-emerald-600 text-white">Safe</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {session.ip_address} | {session.location}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Last seen: {formatDateTime(session.last_seen_at)}
                            {session.is_current ? " (current)" : ""}
                          </p>
                        </div>
                        {!session.is_current ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onRevokeSession(session.id)}
                            disabled={revokeSessionMutation.isPending}
                          >
                            Revoke
                          </Button>
                        ) : (
                          <Badge>Current</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No active sessions found.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Modal
        open={recoveryCodesModalOpen}
        onOpenChange={setRecoveryCodesModalOpen}
        title="Recovery codes"
        footer={
          <Button size="sm" onClick={() => setRecoveryCodesModalOpen(false)}>
            I saved these codes
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Save these recovery codes in a safe place. Each code can be used once if you lose access to your authenticator app.
          </p>
          <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            {latestRecoveryCodes.map((code) => (
              <code key={code} className="rounded bg-secondary px-2 py-1">
                {code}
              </code>
            ))}
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => copyValue(latestRecoveryCodes.join("\n"), "Recovery codes")}>
              Copy codes
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function PreferenceRow({
  title,
  description,
  checked,
  onChange
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/70 pb-2 last:border-none last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
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
