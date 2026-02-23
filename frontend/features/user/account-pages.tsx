"use client";

import { Copy, Download, History, LogOut, Mail, Save, ShieldCheck, Sparkles, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuthMe, useLogout } from "@/features/auth/use-auth";
import { useFavorites, useToggleFavorite } from "@/features/user/use-favorites";
import { catalogApi } from "@/lib/api/openapi-client";
import { useUpdateUserProfile, useUserProfile } from "@/features/user/use-profile";
import { formatPrice } from "@/lib/utils/format";
import { COMPARE_LIMIT, useCompareStore } from "@/store/compare.store";
import { type LocalProfileDraft, useProfileStore } from "@/store/profile.store";
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

const formatShortAccountId = (value: string) => {
  const normalized = value.trim();
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
};

const formatDateTime = (value?: string) => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown };
    if (typeof candidate.message === "string") {
      return candidate.message;
    }
  }
  return fallback;
};

export function ProfileClient() {
  const me = useAuthMe();
  const profileQuery = useUserProfile();
  const updateProfile = useUpdateUserProfile();
  const logout = useLogout();
  const favorites = useFavorites();
  const { items: recentItems, clear: clearRecent } = useRecentlyViewedStore();
  const storedDraft = useProfileStore((s) => s.draft);
  const preferences = useProfileStore((s) => s.preferences);
  const saveDraft = useProfileStore((s) => s.saveDraft);
  const resetDraft = useProfileStore((s) => s.resetDraft);
  const setPreference = useProfileStore((s) => s.setPreference);
  const resetPreferences = useProfileStore((s) => s.resetPreferences);
  const [profileForm, setProfileForm] = useState<LocalProfileDraft>(() => ({ ...emptyProfileForm, ...storedDraft }));
  const [hydratedFromServer, setHydratedFromServer] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!profileQuery.data || hydratedFromServer) return;
    const serverDraft: LocalProfileDraft = {
      display_name: profileQuery.data.display_name || profileQuery.data.full_name || "",
      phone: profileQuery.data.phone || "",
      city: profileQuery.data.city || "",
      telegram: profileQuery.data.telegram || "",
      about: profileQuery.data.about || ""
    };
    const normalizedStored = normalizeDraft(storedDraft);
    const hasLocalBackup = Object.values(normalizedStored).some((value) => Boolean(value));
    const serverUpdatedAt = profileQuery.data.updated_at ? new Date(profileQuery.data.updated_at).getTime() : 0;
    const localUpdatedAt = storedDraft.updated_at ? new Date(storedDraft.updated_at).getTime() : 0;
    const preferLocalBackup = hasLocalBackup && localUpdatedAt > serverUpdatedAt;
    setProfileForm(preferLocalBackup ? { ...serverDraft, ...normalizedStored } : serverDraft);
    setHydratedFromServer(true);
  }, [hydratedFromServer, profileQuery.data, storedDraft]);

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
      telegram: profileQuery.data?.telegram || "",
      about: profileQuery.data?.about || ""
    }),
    [me.data?.full_name, profileQuery.data?.about, profileQuery.data?.city, profileQuery.data?.display_name, profileQuery.data?.phone, profileQuery.data?.telegram]
  );

  const hasDraftChanges = useMemo(() => {
    return JSON.stringify(normalizeDraft(profileForm)) !== JSON.stringify(normalizeDraft(baselineDraft));
  }, [baselineDraft, profileForm]);

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

  const onDraftFieldChange = (field: keyof LocalProfileDraft, value: string) => {
    setProfileForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveServerProfile = async () => {
    const normalized = normalizeDraft(profileForm);
    if (normalized.display_name.length < 2) {
      setStatus("Display name must be at least 2 characters");
      return;
    }
    try {
      await updateProfile.mutateAsync(normalized);
      saveDraft(normalized);
      setStatus("Profile saved");
    } catch (error) {
      saveDraft(normalized);
      setStatus(getErrorMessage(error, "Failed to save profile on server. Backup saved locally."));
    }
  };

  const resetProfileForm = () => {
    if (!hasDraftChanges) return;
    setProfileForm(baselineDraft);
    resetDraft();
    setStatus("Changes reset");
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
    setStatus("Snapshot exported");
  };

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`${label} copied`);
    } catch {
      setCopyStatus(`Failed to copy ${label.toLowerCase()}`);
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
    return <ErrorState title="Profile unavailable" message="Unable to load your profile right now." />;
  }

  return (
    <div className="container space-y-6 py-6">
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
                  <Badge className="bg-primary text-primary-foreground">Account {formatShortAccountId(me.data.id)}</Badge>
                  <Badge>{favoritesCount} favorites</Badge>
                  <Badge>{recentCount} recent views</Badge>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="gap-2" onClick={exportAccountSnapshot}>
                <Download className="h-4 w-4" /> Export data
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => logout.mutate()} disabled={logout.isPending}>
                <LogOut className="h-4 w-4" /> {logout.isPending ? "Logging out..." : "Logout"}
              </Button>
            </div>
          </div>
          {status ? <p className="mt-4 text-sm text-primary">{status}</p> : null}
          {copyStatus ? <p className="mt-1 text-sm text-primary">{copyStatus}</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-primary" /> Profile details
              </CardTitle>
              <Badge className="bg-secondary/80">{completionScore}% complete</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${completionScore}%` }} />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Display name</label>
                  <Input value={profileForm.display_name} onChange={(e) => onDraftFieldChange("display_name", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Phone</label>
                  <Input placeholder="+998 ..." value={profileForm.phone} onChange={(e) => onDraftFieldChange("phone", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">City</label>
                  <Input value={profileForm.city} onChange={(e) => onDraftFieldChange("city", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Telegram</label>
                  <Input placeholder="@username" value={profileForm.telegram} onChange={(e) => onDraftFieldChange("telegram", e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">About</label>
                <Textarea value={profileForm.about} onChange={(e) => onDraftFieldChange("about", e.target.value)} placeholder="Short bio, interests, preferred brands..." />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">Changes are saved to your account via API. Local backup is kept in this browser.</p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={resetProfileForm} disabled={!hasDraftChanges || updateProfile.isPending}>
                    Reset
                  </Button>
                  <Button size="sm" className="gap-2" onClick={saveServerProfile} disabled={!hasDraftChanges || updateProfile.isPending}>
                    <Save className="h-4 w-4" /> {updateProfile.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Preferences
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={resetPreferences}>
                Reset
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <PreferenceRow
                title="Price drop alerts"
                description="Notify when tracked products get cheaper."
                checked={preferences.price_drop_alerts}
                onChange={(checked) => setPreference("price_drop_alerts", checked)}
              />
              <PreferenceRow
                title="Back in stock alerts"
                description="Notify when unavailable products return to stock."
                checked={preferences.stock_alerts}
                onChange={(checked) => setPreference("stock_alerts", checked)}
              />
              <PreferenceRow
                title="Weekly digest"
                description="Receive a weekly summary of catalog changes."
                checked={preferences.weekly_digest}
                onChange={(checked) => setPreference("weekly_digest", checked)}
              />
              <PreferenceRow
                title="Public profile"
                description="Allow sharing your public profile card."
                checked={preferences.public_profile}
                onChange={(checked) => setPreference("public_profile", checked)}
              />
              <PreferenceRow
                title="Compact cards"
                description="Use tighter spacing in account widgets."
                checked={preferences.compact_view}
                onChange={(checked) => setPreference("compact_view", checked)}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <StatRow label="Email" value={me.data.email} />
              <StatRow label="Full name" value={me.data.full_name || "-"} />
              <StatRow label="Favorites" value={String(favoritesCount)} />
              <StatRow label="Recent views" value={String(recentCount)} />
              <StatRow label="Server profile updated" value={formatDateTime(profileQuery.data?.updated_at ?? undefined)} />
              <StatRow label="Local backup updated" value={formatDateTime(storedDraft.updated_at)} />
              <StatRow label="Last viewed item" value={latestViewed ? formatDateTime(latestViewed.viewedAt) : "No activity"} />
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Link href="/favorites">
                  <Button variant="outline" className="w-full justify-center">
                    Favorites
                  </Button>
                </Link>
                <Link href="/recently-viewed">
                  <Button variant="outline" className="w-full justify-center">
                    Recently viewed
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <History className="h-4 w-4 text-primary" /> Recent activity
              </CardTitle>
              <Button variant="ghost" size="sm" className="gap-1" onClick={clearRecent} disabled={!recentItems.length}>
                <Trash2 className="h-4 w-4" /> Clear
              </Button>
            </CardHeader>
            <CardContent>
              {recentPreview.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent activity yet.</p>
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" /> Security
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Account UUID</p>
                  <p className="text-xs text-muted-foreground">{me.data.id}</p>
                </div>
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => (me.data ? copyValue(String(me.data.id), "Account UUID") : undefined)}>
                  <Copy className="h-4 w-4" /> Copy
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Email</p>
                  <p className="text-xs text-muted-foreground">{me.data.email}</p>
                </div>
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => (me.data ? copyValue(me.data.email, "Email") : undefined)}>
                  <Mail className="h-4 w-4" /> Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Planned advanced security features (password rotation, active sessions, 2FA) are prepared in{" "}
                <code>docs/PROFILE_FUTURE_FEATURES.md</code>.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
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
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}

export function FavoritesClient() {
  const favorites = useFavorites();
  const toggleFavorite = useToggleFavorite();
  const compareItems = useCompareStore((s) => s.items);
  const toggleCompare = useCompareStore((s) => s.toggle);
  const compareSet = useMemo(() => new Set(compareItems.map((item) => item.id)), [compareItems]);
  const compareFull = compareItems.length >= COMPARE_LIMIT;
  const referenceCompareCategory = useMemo(() => getReferenceCategory(compareItems.map((item) => item.category)), [compareItems]);
  const favoriteIds = useMemo(() => (favorites.data ?? []).map((item) => item.product_id), [favorites.data]);
  const productQueries = useQueries({
    queries: favoriteIds.map((productId) => ({
      queryKey: ["catalog", "product", productId],
      queryFn: () => catalogApi.getProduct(productId),
      staleTime: 60_000
    }))
  });

  const favoriteQueryItems = useMemo(
    () =>
      productQueries.flatMap((query, index) => {
        const id = favoriteIds[index];
        if (typeof id !== "string") return [];
        return [{ id, data: query.data, error: query.error }] as const;
      }),
    [favoriteIds, productQueries]
  );
  const products = useMemo(
    () =>
      favoriteQueryItems.flatMap((item) => {
        if (!item.data) return [];
        return [{ id: item.id, data: item.data }];
      }),
    [favoriteQueryItems]
  );
  const unresolvedIds = useMemo(
    () =>
      favoriteQueryItems
        .filter((item) => !item.data && !item.error)
        .map((item) => item.id),
    [favoriteQueryItems]
  );
  const failedIds = useMemo(
    () =>
      favoriteQueryItems
        .filter((item) => !item.data && item.error)
        .map((item) => item.id),
    [favoriteQueryItems]
  );
  const isLoadingProducts = productQueries.some((query) => query.isLoading || query.isFetching);

  if (favorites.isLoading) {
    return (
      <div className="container space-y-4 py-6">
        <h1 className="text-2xl font-semibold">Favorites</h1>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="container py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Favorites</h1>
        <Badge>{favoriteIds.length} saved</Badge>
      </div>
      {(favorites.data?.length ?? 0) === 0 ? (
        <EmptyState title="Favorites are empty" message="Save products to compare them later." />
      ) : (
        <>
          {isLoadingProducts && !products.length ? <p className="mb-3 text-sm text-muted-foreground">Loading favorite products...</p> : null}
          <div className="space-y-3">
            {products.map(({ id, data }) => {
              const minPrice = data.offers_by_store.reduce((acc, store) => Math.min(acc, store.minimal_price), Number.POSITIVE_INFINITY);
              const offersCount = data.offers_by_store.reduce((acc, store) => acc + store.offers_count, 0);
              const productSlug = `${id}-${slugify(data.title)}`;
              const inCompare = compareSet.has(id);
              const categoryMismatch = Boolean(referenceCompareCategory && normalizeCategory(data.category) && normalizeCategory(data.category) !== referenceCompareCategory);
              const compareDisabled = !inCompare && (compareFull || categoryMismatch);
              const compareDisabledReason = compareFull ? `Limit is ${COMPARE_LIMIT} products` : categoryMismatch ? "Compare works only within one category" : undefined;
              return (
                <Card key={id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="space-y-1">
                      <Link href={`/product/${productSlug}`} className="text-sm font-semibold text-primary hover:underline">
                        {data.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {data.brand ? `${data.brand} · ` : ""}
                        {data.category}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {Number.isFinite(minPrice) ? <Badge className="bg-secondary/80">{formatPrice(minPrice)}</Badge> : null}
                        <Badge>{data.offers_by_store.length} stores</Badge>
                        <Badge>{offersCount} offers</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link href={`/product/${productSlug}`}>
                        <Button variant="outline" size="sm">
                          Open product
                        </Button>
                      </Link>
                      <Button
                        variant={inCompare ? "default" : "outline"}
                        size="sm"
                        onClick={() =>
                          toggleCompare({
                            id,
                            title: data.title,
                            slug: productSlug,
                            category: data.category
                          })
                        }
                        disabled={compareDisabled}
                        title={compareDisabled ? compareDisabledReason : undefined}
                      >
                        {inCompare ? "Compared" : "Compare"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleFavorite.mutate(id)} disabled={toggleFavorite.isPending}>
                        Remove
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {failedIds.map((id) => (
              <Card key={id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <p className="text-sm text-muted-foreground">Product #{id} is unavailable.</p>
                  <Button variant="ghost" size="sm" onClick={() => toggleFavorite.mutate(id)} disabled={toggleFavorite.isPending}>
                    Remove
                  </Button>
                </CardContent>
              </Card>
            ))}
            {unresolvedIds.map((id) => (
              <Card key={id}>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Loading product #{id}...</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const normalizeCategory = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
};

const getReferenceCategory = (categories: Array<string | undefined>) => {
  for (const category of categories) {
    const normalized = normalizeCategory(category);
    if (normalized) return normalized;
  }
  return undefined;
};

export function RecentlyViewedClient() {
  const { items, clear } = useRecentlyViewedStore();

  return (
    <div className="container py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Recently viewed</h1>
        <Button variant="ghost" onClick={clear}>
          Clear
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No recent views" message="Your visited products will appear here." />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="p-4">
                <Link href={`/product/${item.slug}`} className="text-sm font-medium">
                  {item.title}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

