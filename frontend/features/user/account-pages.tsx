"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Copy, Download, History, LogOut, Mail, Save, ShieldCheck, Sparkles, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useLocale } from "@/components/common/locale-provider";
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
import { formatDateTime as formatLocalizedDateTime, formatPrice } from "@/lib/utils/format";
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

const formatDateTime = (value: string | undefined, locale: "uz-Cyrl-UZ" | "ru-RU") => {
  if (!value) return locale === "uz-Cyrl-UZ" ? "Ҳеч қачон" : "Никогда";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return locale === "uz-Cyrl-UZ" ? "Ҳеч қачон" : "Никогда";
  return formatLocalizedDateTime(date, locale);
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
  const { locale } = useLocale();
  const isUz = locale === "uz-Cyrl-UZ";
  const tr = (ru: string, uz: string) => (isUz ? uz : ru);

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
      .catch(() => setStatus(tr("Не удалось синхронизировать настройки уведомлений с сервером.", "Хабарнома созламаларини сервер билан синхронлаб бўлмади.")));
  };

  const onResetPreferences = () => {
    resetPreferences();
    void updateNotificationPreferences
      .mutateAsync(defaultProfilePreferences)
      .catch(() => setStatus(tr("Локальные настройки сброшены, но серверную синхронизацию выполнить не удалось.", "Локал созламалар тикланди, лекин сервер билан синхронлаб бўлмади.")));
  };

  const onClearRecent = () => {
    clearRecent();
    if (me.data?.id) {
      void userApi.clearRecentlyViewed().catch(() => undefined);
    }
  };

  const onChangePassword = async () => {
    if (newPassword.trim().length < 8) {
      setStatus(tr("Новый пароль должен содержать минимум 8 символов.", "Янги пароль камида 8 белгидан иборат бўлиши керак."));
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setStatus(tr("Подтверждение нового пароля не совпадает.", "Янги пароль тасдиғи мос келмади."));
      return;
    }
    if (newPasswordStrength.score < 3) {
      setStatus(
        tr(
          "Используйте более надежный пароль: 12+ символов, разные регистры, цифры и спецсимволы.",
          "Кучлироқ пароль ишлатинг: 12+ белги, катта-кичик ҳарфлар, рақамлар ва махсус белгилар."
        )
      );
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
          ? tr(
              `Пароль изменен. Завершено других сессий: ${result.revoked_sessions}.`,
              `Пароль ўзгартирилди. Якунланган бошқа сессиялар: ${result.revoked_sessions}.`
            )
          : tr("Пароль изменен.", "Пароль ўзгартирилди.")
      );
    } catch (error) {
      setStatus(getErrorMessage(error, tr("Не удалось изменить пароль.", "Парольни ўзгартириб бўлмади.")));
    }
  };

  const onStartTwoFactorSetup = async () => {
    try {
      const payload = await setupTwoFactorMutation.mutateAsync();
      setTwoFactorSetupPayload(payload);
      setTwoFactorCode("");
      setLatestRecoveryCodes([]);
      setRecoveryCodesModalOpen(false);
      setStatus(tr("Настройка 2FA создана. Сканируйте QR и подтвердите одноразовым кодом.", "2FA созламаси яратилди. QR кодни скан қилинг ва бир марталик код билан тасдиқланг."));
    } catch (error) {
      setStatus(getErrorMessage(error, tr("Не удалось начать настройку 2FA.", "2FA созлашни бошлаб бўлмади.")));
    }
  };

  const onVerifyTwoFactorSetup = async () => {
    if (!twoFactorCode.trim()) {
      setStatus(tr("Введите 2FA-код, чтобы завершить настройку.", "Созлашни якунлаш учун 2FA кодини киритинг."));
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
        setStatus(tr("2FA включена.", "2FA ёқилди."));
        await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      } else {
        setStatus(tr("Неожиданный ответ при подтверждении 2FA.", "2FA тасдиқлашда кутилмаган жавоб олинди."));
      }
    } catch (error) {
      setStatus(getErrorMessage(error, tr("Неверный 2FA-код.", "2FA коди нотўғри.")));
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
      setStatus(tr("2FA выключена.", "2FA ўчирилди."));
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    } catch (error) {
      setStatus(getErrorMessage(error, tr("Не удалось отключить 2FA.", "2FA ни ўчириб бўлмади.")));
    }
  };

  const onRevokeSession = async (sessionId: string) => {
    try {
      await revokeSessionMutation.mutateAsync(sessionId);
      setStatus(tr("Сессия завершена.", "Сессия якунланди."));
    } catch (error) {
      setStatus(getErrorMessage(error, tr("Не удалось завершить сессию.", "Сессияни якунлаб бўлмади.")));
    }
  };

  const onRevokeOtherSessions = async () => {
    try {
      const result = await revokeOtherSessionsMutation.mutateAsync();
      setStatus(
        result.revoked > 0
          ? tr(`Завершено сессий: ${result.revoked}.`, `Якунланган сессиялар: ${result.revoked}.`)
          : tr("Других сессий для завершения нет.", "Якунлаш учун бошқа сессия йўқ.")
      );
    } catch (error) {
      setStatus(getErrorMessage(error, tr("Не удалось завершить другие сессии.", "Бошқа сессияларни якунлаб бўлмади.")));
    }
  };

  const saveServerProfile = async () => {
    const normalized = {
      ...normalizeDraft(profileForm),
      telegram: normalizeTelegram(profileForm.telegram, me.data?.email)
    };
    if (normalized.display_name.length < 2) {
      setStatus(tr("Имя должно содержать минимум 2 символа.", "Исм камида 2 белгидан иборат бўлиши керак."));
      return;
    }
    try {
      await updateProfile.mutateAsync(normalized);
      saveDraft(normalized);
      setStatus(tr("Профиль сохранён.", "Профиль сақланди."));
    } catch (error) {
      saveDraft(normalized);
      setStatus(getErrorMessage(error, tr("Не удалось сохранить профиль на сервере. Локальная копия обновлена.", "Профильни серверда сақлаб бўлмади. Локал нусха янгиланди.")));
    }
  };

  const resetProfileForm = () => {
    if (!hasDraftChanges) return;
    setProfileForm(baselineDraft);
    resetDraft();
    setStatus(tr("Изменения сброшены.", "Ўзгаришлар бекор қилинди."));
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
    setStatus(tr("Снимок профиля экспортирован.", "Профиль снапшоти экспорт қилинди."));
  };

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(tr(`${label} скопирован.`, `${label} нусхаланди.`));
    } catch {
      setCopyStatus(tr(`Не удалось скопировать: ${label.toLowerCase()}.`, `Нусхалаб бўлмади: ${label.toLowerCase()}.`));
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
    return (
      <ErrorState
        title={tr("Профиль недоступен", "Профиль мавжуд эмас")}
        message={tr("Сейчас не удалось загрузить профиль. Попробуйте обновить страницу позже.", "Ҳозир профильни юклаб бўлмади. Кейинроқ саҳифани янгилаб кўринг.")}
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <Card className="relative overflow-hidden border-accent/20">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent" />
          <CardContent className="relative p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <Avatar name={me.data.full_name} className="h-16 w-16 text-lg" />
                <div className="space-y-1.5">
                  <p className="text-xl font-bold text-foreground">{profileForm.display_name || me.data.full_name}</p>
                  <p className="text-sm text-muted-foreground">{me.data.email}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-accent/10 text-accent">{tr("Аккаунт", "Аккаунт")} {formatShortAccountId(me.data.id)}</Badge>
                    <Badge>{tr(`${favoritesCount} в избранном`, `${favoritesCount} та сараланган`)}</Badge>
                    <Badge>{tr(`${recentCount} недавних просмотров`, `${recentCount} та яқинда кўрилган`)}</Badge>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="gap-2" onClick={exportAccountSnapshot}>
                  <Download className="h-4 w-4" /> {tr("Экспорт данных", "Маълумотларни экспорт қилиш")}
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => logout.mutate()} disabled={logout.isPending}>
                  <LogOut className="h-4 w-4" /> {logout.isPending ? tr("Выходим...", "Чиқилмоқда...") : tr("Выйти", "Чиқиш")}
                </Button>
              </div>
            </div>
            {status ? <p className="mt-4 text-sm text-accent">{status}</p> : null}
            {copyStatus ? <p className="mt-1 text-sm text-accent">{copyStatus}</p> : null}
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-primary" /> {tr("Данные профиля", "Профиль маълумотлари")}
              </CardTitle>
              <Badge className="bg-secondary/80">{tr("Заполнено", "Тўлдирилган")}: {completionScore}%</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${completionScore}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className="h-full rounded-full bg-accent"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">{tr("Отображаемое имя", "Кўринадиган исм")}</label>
                  <Input value={profileForm.display_name} onChange={(e) => onDraftFieldChange("display_name", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">{tr("Телефон", "Телефон")}</label>
                  <Input placeholder="+998 ..." value={profileForm.phone} onChange={(e) => onDraftFieldChange("phone", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">{tr("Город", "Шаҳар")}</label>
                  <Input value={profileForm.city} onChange={(e) => onDraftFieldChange("city", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">{tr("Telegram", "Telegram")}</label>
                  <Input
                    placeholder="@username"
                    value={profileForm.telegram}
                    autoComplete="off"
                    onChange={(e) => onDraftFieldChange("telegram", e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{tr("О себе", "Ўзингиз ҳақида")}</label>
                <Textarea
                  value={profileForm.about}
                  onChange={(e) => onDraftFieldChange("about", e.target.value)}
                  placeholder={tr("Кратко о себе, интересах и любимых брендах...", "Ўзингиз, қизиқишларингиз ва севимли брендлар ҳақида қисқача...")}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {tr(
                    "Изменения сохраняются через API, а локальная копия профиля хранится в этом браузере.",
                    "Ўзгаришлар API орқали сақланади, профильнинг локал нусхаси эса ушбу браузерда сақланади."
                  )}
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={resetProfileForm} disabled={!hasDraftChanges || updateProfile.isPending}>
                    {tr("Сбросить", "Бекор қилиш")}
                  </Button>
                  <Button size="sm" className="gap-2" onClick={saveServerProfile} disabled={!hasDraftChanges || updateProfile.isPending}>
                    <Save className="h-4 w-4" /> {updateProfile.isPending ? tr("Сохраняем...", "Сақланмоқда...") : tr("Сохранить", "Сақлаш")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> {tr("Настройки", "Созламалар")}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={onResetPreferences}>
                {tr("Сбросить", "Бекор қилиш")}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <PreferenceRow
                title={tr("Алерты снижения цены", "Нарх пасайиши алертлари")}
                description={tr("Показывать сигналы, когда отслеживаемые товары дешевеют.", "Кузатувдаги товарлар арзонлашганда сигнал кўрсатиш.")}
                checked={preferences.price_drop_alerts}
                onChange={(checked) => onPreferenceChange("price_drop_alerts", checked)}
              />
              <PreferenceRow
                title={tr("Алерты наличия", "Мавжудлик алертлари")}
                description={tr("Сообщать, когда товар снова доступен в наличии.", "Товар яна мавжуд бўлганда хабар бериш.")}
                checked={preferences.stock_alerts}
                onChange={(checked) => onPreferenceChange("stock_alerts", checked)}
              />
              <PreferenceRow
                title={tr("Еженедельная сводка", "Ҳафталик жамланма")}
                description={tr("Показывать еженедельный обзор обновлений каталога.", "Каталог янгиланишларининг ҳафталик шарҳини кўрсатиш.")}
                checked={preferences.weekly_digest}
                onChange={(checked) => onPreferenceChange("weekly_digest", checked)}
              />
              <PreferenceRow
                title={tr("Публичный профиль", "Оммавий профиль")}
                description={tr("Разрешить публикацию карточки профиля.", "Профиль карточкасини оммага чиқаришга рухсат бериш.")}
                checked={preferences.public_profile}
                onChange={(checked) => onPreferenceChange("public_profile", checked)}
              />
              <PreferenceRow
                title={tr("Компактный вид", "Ихчам кўриниш")}
                description={tr("Использовать более плотный интерфейс в кабинете.", "Кабинетда ихчам интерфейсдан фойдаланиш.")}
                checked={preferences.compact_view}
                onChange={(checked) => onPreferenceChange("compact_view", checked)}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{tr("Сводка аккаунта", "Аккаунт жамланмаси")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <StatRow label="Email" value={me.data.email} />
              <StatRow label={tr("Полное имя", "Тўлиқ исм")} value={me.data.full_name || "-"} />
              <StatRow label={tr("Избранное", "Сараланганлар")} value={String(favoritesCount)} />
              <StatRow label={tr("Недавние просмотры", "Яқинда кўрилганлар")} value={String(recentCount)} />
              <StatRow label={tr("Профиль на сервере обновлён", "Сервердаги профиль янгиланган")} value={formatDateTime(profileQuery.data?.updated_at ?? undefined, locale)} />
              <StatRow label={tr("Локальная копия обновлена", "Локал нусха янгиланган")} value={formatDateTime(storedDraft.updated_at, locale)} />
              <StatRow label={tr("Последний просмотр", "Охирги кўриш")} value={latestViewed ? formatDateTime(latestViewed.viewedAt, locale) : tr("Нет активности", "Фаоллик йўқ")} />
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Link href="/favorites">
                  <Button variant="outline" className="w-full justify-center">
                    {tr("Избранное", "Сараланганлар")}
                  </Button>
                </Link>
                <Link href="/recently-viewed">
                  <Button variant="outline" className="w-full justify-center">
                    {tr("Просмотры", "Кўришлар")}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>


          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <History className="h-4 w-4 text-primary" /> {tr("Недавняя активность", "Яқиндаги фаоллик")}
              </CardTitle>
              <Button variant="ghost" size="sm" className="gap-1" onClick={onClearRecent} disabled={!recentItems.length}>
                <Trash2 className="h-4 w-4" /> {tr("Очистить", "Тозалаш")}
              </Button>
            </CardHeader>
            <CardContent>
              {recentPreview.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tr("Активности пока нет.", "Ҳозирча фаоллик йўқ.")}</p>
              ) : (
                <div className="space-y-3">
                  {recentPreview.map((item) => (
                    <div key={item.id} className="rounded-xl border border-border p-3">
                      <Link href={`/product/${item.slug}`} className="line-clamp-2 text-sm font-medium hover:text-primary">
                        {item.title}
                      </Link>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">{formatDateTime(item.viewedAt, locale)}</p>
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
                <ShieldCheck className="h-4 w-4 text-primary" /> {tr("Безопасность", "Хавфсизлик")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border border-border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{tr("Состояние безопасности", "Хавфсизлик ҳолати")}</p>
                  <Badge className={securityScore >= 80 ? "bg-emerald-600 text-white" : securityScore >= 55 ? "bg-warning text-warning-foreground" : "bg-destructive text-destructive-foreground"}>
                    {securityScore}/100
                  </Badge>
                </div>
                <div className="grid gap-2 text-xs text-muted-foreground">
                  <p>2FA: {twoFactorEnabled ? tr("включена", "ёқилган") : tr("выключена", "ўчирилган")}</p>
                  <p>{tr("Активные сессии", "Фаол сессиялар")}: {sessionRiskSummary.total}</p>
                  <p>{tr("Риск-сессии", "Хавфли сессиялар")}: {sessionRiskSummary.highRisk}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-border p-3">
                <div>
                  <p className="text-sm font-medium">{tr("ID аккаунта", "Аккаунт ID")}</p>
                  <p className="text-xs text-muted-foreground">{me.data.id}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  onClick={() => (me.data ? copyValue(String(me.data.id), tr("ID аккаунта", "Аккаунт ID")) : undefined)}
                >
                  <Copy className="h-4 w-4" /> {tr("Копировать", "Нусхалаш")}
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Email</p>
                  <p className="text-xs text-muted-foreground">{me.data.email}</p>
                </div>
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => (me.data ? copyValue(me.data.email, "Email") : undefined)}>
                  <Mail className="h-4 w-4" /> {tr("Копировать", "Нусхалаш")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {tr(
                  "В API уже доступны смена пароля, управление сессиями и 2FA. Для UI-расширения можно использовать",
                  "API да паролни алмаштириш, сессияларни бошқариш ва 2FA аллақачон мавжуд. UI ни кенгайтириш учун"
                )}{" "}
                <code>docs/PROFILE_FUTURE_FEATURES.md</code>.
              </p>
              <div className="rounded-xl border border-border p-3 space-y-3">
                <p className="text-sm font-medium">{tr("Смена пароля", "Паролни ўзгартириш")}</p>
                <Input
                  type="password"
                  placeholder={tr("Текущий пароль", "Жорий пароль")}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
                <Input
                  type="password"
                  placeholder={tr("Новый пароль", "Янги пароль")}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <Input
                  type="password"
                  placeholder={tr("Подтвердите новый пароль", "Янги парольни тасдиқланг")}
                  value={confirmNewPassword}
                  onChange={(event) => setConfirmNewPassword(event.target.value)}
                />
                <div className="rounded-lg border border-border/70 p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{tr("Надежность пароля", "Пароль мустаҳкамлиги")}</span>
                    <Badge className={newPasswordStrength.label === "strong" ? "bg-emerald-600 text-white" : newPasswordStrength.label === "medium" ? "bg-warning text-warning-foreground" : "bg-secondary text-foreground"}>
                      {newPasswordStrength.label === "strong" ? tr("сильный", "кучли") : newPasswordStrength.label === "medium" ? tr("средний", "ўртача") : tr("слабый", "заиф")}
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
                  <span className="text-xs text-muted-foreground">{tr("Завершать другие сессии после смены пароля", "Пароль алмашганда бошқа сессияларни якунлаш")}</span>
                  <Switch checked={revokeOtherSessionsOnPasswordChange} onCheckedChange={setRevokeOtherSessionsOnPasswordChange} />
                </div>
                <Button
                  size="sm"
                  onClick={onChangePassword}
                  disabled={changePasswordMutation.isPending || !currentPassword || !newPassword || !confirmNewPassword}
                >
                  {changePasswordMutation.isPending ? tr("Обновляем...", "Янгиланмоқда...") : tr("Обновить пароль", "Паролни янгилаш")}
                </Button>
              </div>

            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold">{tr("Двухфакторная аутентификация (2FA)", "Икки босқичли аутентификация (2FA)")}</CardTitle>
              <Badge className={twoFactorEnabled ? "bg-emerald-600 text-white" : "bg-secondary text-foreground"}>
                {twoFactorEnabled ? tr("Включена", "Ёқилган") : tr("Выключена", "Ўчирилган")}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {!twoFactorEnabled ? (
                <Button size="sm" onClick={onStartTwoFactorSetup} disabled={setupTwoFactorMutation.isPending}>
                  {setupTwoFactorMutation.isPending ? tr("Подготавливаем...", "Тайёрланмоқда...") : tr("Включить 2FA", "2FA ни ёқиш")}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={onDisableTwoFactor} disabled={disableTwoFactorMutation.isPending}>
                  {disableTwoFactorMutation.isPending ? tr("Отключаем...", "Ўчирилмоқда...") : tr("Отключить 2FA", "2FA ни ўчириш")}
                </Button>
              )}
              {twoFactorSetupPayload ? (
                <div className="space-y-3">
                  <div className="space-y-2 rounded-lg border border-border/70 p-3">
                    <p className="text-sm font-medium">{tr("1. Сканируйте QR-код", "1. QR кодни скан қилинг")}</p>
                    <p className="text-xs text-muted-foreground">{tr("Откройте Google/Microsoft Authenticator и отсканируйте QR.", "Google/Microsoft Authenticator ни очиб, QR кодни скан қилинг.")}</p>
                    <div
                      className="overflow-hidden rounded-md bg-white p-2 [&>svg]:mx-auto [&>svg]:block [&>svg]:h-auto [&>svg]:max-w-full"
                      dangerouslySetInnerHTML={{ __html: twoFactorSetupPayload.qr_svg }}
                    />
                  </div>

                  <div className="space-y-2 rounded-lg border border-border/70 p-3">
                    <p className="text-sm font-medium">{tr("2. Введите одноразовый код", "2. Бир марталик кодни киритинг")}</p>
                    <Input
                      placeholder={tr("Одноразовый код", "Бир марталик код")}
                      inputMode="numeric"
                      value={twoFactorCode}
                      onChange={(event) => setTwoFactorCode(event.target.value)}
                    />
                    <Button size="sm" onClick={onVerifyTwoFactorSetup} disabled={verifyTwoFactorMutation.isPending || !twoFactorCode.trim()}>
                      {verifyTwoFactorMutation.isPending ? tr("Проверяем...", "Текширилмоқда...") : tr("Проверить и включить", "Текшириш ва ёқиш")}
                    </Button>
                  </div>

                  <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{tr("3. Коды восстановления появятся после проверки", "3. Тиклаш кодлари текширувдан кейин кўрсатилади")}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">{tr('После "Проверить и включить" коды появятся в отдельном окне.', '"Текшириш ва ёқиш" дан кейин тиклаш кодлари алоҳида ойнада кўринади.')}</p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold">{tr("Активные сессии", "Фаол сессиялар")}</CardTitle>
              <Button variant="outline" size="sm" onClick={onRevokeOtherSessions} disabled={revokeOtherSessionsMutation.isPending}>
                {revokeOtherSessionsMutation.isPending ? tr("Завершаем...", "Якунланмоқда...") : tr("Завершить остальные", "Қолганларини якунлаш")}
              </Button>
            </CardHeader>
            <CardContent>
              {sessionsQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">{tr("Загружаем сессии...", "Сессиялар юкланмоқда...")}</p>
              ) : sessionsQuery.data && sessionsQuery.data.length ? (
                <div className="space-y-2">
                  {sessionsQuery.data.map((session) => (
                    <div key={session.id} className="rounded-lg border border-border/70 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-medium">{session.device}</p>
                            {isHighRiskSession(session) ? <Badge className="bg-warning text-warning-foreground">{tr("Риск", "Хавф")}</Badge> : <Badge className="bg-emerald-600 text-white">{tr("Безопасно", "Хавфсиз")}</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {session.ip_address} | {session.location}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {tr("Последняя активность", "Охирги фаоллик")}: {formatDateTime(session.last_seen_at, locale)}
                            {session.is_current ? tr(" (текущая)", " (жорий)") : ""}
                          </p>
                        </div>
                        {!session.is_current ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onRevokeSession(session.id)}
                            disabled={revokeSessionMutation.isPending}
                          >
                            {tr("Завершить", "Якунлаш")}
                          </Button>
                        ) : (
                          <Badge>{tr("Текущая", "Жорий")}</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{tr("Активные сессии не найдены.", "Фаол сессиялар топилмади.")}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Modal
        open={recoveryCodesModalOpen}
        onOpenChange={setRecoveryCodesModalOpen}
        title={tr("Коды восстановления", "Тиклаш кодлари")}
        footer={
          <Button size="sm" onClick={() => setRecoveryCodesModalOpen(false)}>
            {tr("Я сохранил эти коды", "Бу кодларни сақладим")}
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {tr(
              "Сохраните эти коды восстановления в надежном месте. Каждый код можно использовать один раз, если вы потеряете доступ к приложению-аутентификатору.",
              "Бу тиклаш кодларини хавфсиз жойда сақланг. Аутентификатор иловасига кириш йўқолса, ҳар бир коддан бир марта фойдаланиш мумкин."
            )}
          </p>
          <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            {latestRecoveryCodes.map((code) => (
              <code key={code} className="rounded bg-secondary px-2 py-1">
                {code}
              </code>
            ))}
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => copyValue(latestRecoveryCodes.join("\n"), tr("Коды восстановления", "Тиклаш кодлари"))}>
              {tr("Скопировать коды", "Кодларни нусхалаш")}
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
  const { locale } = useLocale();
  const isUz = locale === "uz-Cyrl-UZ";
  const tr = (ru: string, uz: string) => (isUz ? uz : ru);

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
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-extrabold">{tr("Недавно просмотренные", "Яқинда кўрилганлар")}</h1>
        <Button variant="ghost" onClick={clearAll} disabled={items.length === 0}>
          {tr("Очистить", "Тозалаш")}
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState title={tr("Пока нет просмотров", "Ҳозирча кўрилганлар йўқ")} message={tr("Откройте товар из каталога, и он появится в этом списке.", "Каталогдан товар очинг, у ушбу рўйхатда чиқади.")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="space-y-2 p-4">
                <Link href={`/product/${item.slug}`} className="line-clamp-2 text-sm font-semibold text-primary hover:underline">
                  {item.title}
                </Link>
                <p className="text-xs text-muted-foreground">{tr("Просмотрено", "Кўрилган вақти")}: {formatDateTime(item.viewedAt, locale)}</p>
                {item.minPrice != null ? <Badge className="bg-secondary/80">{formatPrice(item.minPrice)}</Badge> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
