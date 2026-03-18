"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { PriceAlertModal } from "@/components/common/price-alert-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useAuthMe, useLogout } from "@/features/auth/use-auth";
import { authApi } from "@/lib/api/openapi-client";
import { cn } from "@/lib/utils/cn";
import { formatDateTime, formatPrice, formatRelativeTime } from "@/lib/utils/format";
import { useRecentlyViewedStore } from "@/store/recentlyViewed.store";

type TabKey = "profile" | "alerts" | "notifications" | "security";
type Profile = { id: string; email: string; full_name: string; display_name: string; phone?: string; city?: string; created_at?: string | null; last_login_at?: string | null };
type UserAlert = { id: string; productId: string; productName: string; image?: string | null; currentPrice: number | null; targetPrice: number | null; priceDelta: number | null; priceDropPercent: number | null; status: "active" | "fired" | "cancelled"; updatedAt?: string | null; history30d: Array<{ date: string; price: number }> };
type NotificationPrefs = {
  channels: { email: boolean; telegram: boolean };
  matrix: {
    price_drop: { email: boolean; telegram: boolean };
    new_offers: { email: boolean; telegram: boolean };
    weekly_digest: { email: boolean; telegram: boolean };
    daily_deals: { email: boolean; telegram: boolean };
    marketing: { email: boolean; telegram: boolean };
  };
  digest_frequency: "daily" | "weekly" | "monthly";
  sms_alerts: boolean;
};
type Session = { id: string; device: string; location: string; ip_address: string; last_seen_at: string; is_current: boolean };
type SearchItem = { id: string; name: string; image?: string | null; minPrice?: number };

const CITIES = ["Тошкент", "Самарқанд", "Бухоро", "Андижон", "Наманган", "Фарғона", "Қарши", "Навоий", "Урганч", "Нукус"];
const EMPTY_NOTIF: NotificationPrefs = {
  channels: { email: true, telegram: false },
  matrix: {
    price_drop: { email: true, telegram: true },
    new_offers: { email: true, telegram: false },
    weekly_digest: { email: true, telegram: false },
    daily_deals: { email: false, telegram: true },
    marketing: { email: false, telegram: false },
  },
  digest_frequency: "weekly",
  sms_alerts: false,
};

const api = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; detail?: string };
  if (!res.ok) throw new Error(String(data.error ?? data.detail ?? "request_failed"));
  return data as T;
};

const sum = (v: number | null | undefined) => (v && v > 0 ? `${formatPrice(v)} сўм` : "—");
const initials = (value: string) => {
  const p = String(value).trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "DX";
  const first = p[0] ?? "";
  if (p.length === 1) return first.slice(0, 2).toUpperCase();
  const second = p[1] ?? "";
  return `${first[0] ?? ""}${second[0] ?? ""}`.toUpperCase();
};

function Sparkline({ points }: { points: Array<{ date: string; price: number }> }) {
  if (!points.length) return <span className="text-xs text-muted-foreground">Маълумот йўқ</span>;
  const values = points.map((p) => p.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const width = 140;
  const height = 30;
  const path = points.map((p, i) => `${(i / Math.max(1, points.length - 1)) * width},${height - ((p.price - min) / range) * height}`).join(" ");
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}><polyline fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-600" points={path} /></svg>;
}

function SearchModal({ open, onOpenChange, onSelect }: { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (item: SearchItem) => void }) {
  const [q, setQ] = useState("");
  const query = useQuery({ queryKey: ["alert-search", q], queryFn: () => api<SearchItem[]>(`/api/compare/search?q=${encodeURIComponent(q.trim())}`), enabled: open && q.trim().length >= 2 });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Товар қидириш">
      <div className="space-y-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Товар номи ёки модели..." />
        <div className="max-h-[320px] space-y-2 overflow-auto">
          {(query.data ?? []).map((item) => (
            <button key={item.id} type="button" className="flex w-full items-center gap-3 rounded-lg border border-border p-2 text-left hover:bg-secondary/30" onClick={() => { onSelect(item); onOpenChange(false); }}>
              <div className="relative h-10 w-10 overflow-hidden rounded border border-border bg-white">{item.image ? <Image src={item.image} alt={item.name} fill className="object-contain p-1" sizes="40px" /> : null}</div>
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">{sum(item.minPrice ?? null)}</p>
              </div>
            </button>
          ))}
          {q.trim().length >= 2 && !query.isFetching && (query.data?.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">Натижа топилмади</p> : null}
        </div>
      </div>
    </Modal>
  );
}

export function ProfileClient() {
  const qc = useQueryClient();
  const me = useAuthMe();
  const logout = useLogout();
  const [tab, setTab] = useState<TabKey>("alerts");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertModal, setAlertModal] = useState<{ productId: string; currentPrice: number | null } | null>(null);
  const [pwdCurrent, setPwdCurrent] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const profileQ = useQuery({ queryKey: ["profile-v3"], queryFn: () => api<Profile>("/api/user/profile"), enabled: Boolean(me.data?.id) });
  const notifQ = useQuery({
    queryKey: ["notif-v3"],
    queryFn: async () => ({ ...EMPTY_NOTIF, ...(await api<Partial<NotificationPrefs>>("/api/user/notifications")) }),
    enabled: Boolean(me.data?.id),
  });
  const alertsQ = useQuery({ queryKey: ["alerts-v3"], queryFn: () => api<UserAlert[]>("/api/user/alerts"), enabled: Boolean(me.data?.id) && tab === "alerts" });
  const sessionsQ = useQuery({ queryKey: ["sessions-v3"], queryFn: () => api<Session[]>("/api/user/sessions"), enabled: Boolean(me.data?.id) && tab === "security" });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("doxx_profile_avatar");
    if (saved) setAvatar(saved);
  }, []);

  const patchProfile = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api<Profile>("/api/user/profile", { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: (data) => { qc.setQueryData(["profile-v3"], data); toast.success("Профиль янгиланди"); },
    onError: () => toast.error("Профильни сақлаб бўлмади"),
  });
  const patchNotif = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api<NotificationPrefs>("/api/user/notifications", { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: (data) => { qc.setQueryData(["notif-v3"], data); toast.success("Созламалар сақланди"); },
  });
  const deleteAlert = useMutation({
    mutationFn: (id: string) => api(`/api/user/alerts/${id}`, { method: "DELETE" }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["alerts-v3"] }); toast.success("Огоҳлантириш ўчирилди"); },
  });
  const connectTg = useMutation({
    mutationFn: () => api<{ deep_link: string }>("/api/user/telegram-connect", { method: "POST", body: "{}" }),
    onSuccess: (d) => { if (typeof window !== "undefined") window.open(d.deep_link, "_blank", "noopener,noreferrer"); },
  });
  const revokeSession = useMutation({ mutationFn: (id: string) => api(`/api/user/sessions?id=${encodeURIComponent(id)}`, { method: "DELETE" }), onSuccess: async () => qc.invalidateQueries({ queryKey: ["sessions-v3"] }) });
  const revokeAll = useMutation({ mutationFn: () => api("/api/user/sessions?all=1", { method: "DELETE" }), onSuccess: async () => qc.invalidateQueries({ queryKey: ["sessions-v3"] }) });
  const changePassword = useMutation({
    mutationFn: () => authApi.changePassword({ current_password: pwdCurrent, new_password: pwdNew, revoke_other_sessions: false }),
    onSuccess: () => { setPwdCurrent(""); setPwdNew(""); setPwdConfirm(""); toast.success("Парол янгиланди"); },
  });
  const deleteAccount = useMutation({ mutationFn: () => api("/api/user/account", { method: "DELETE", body: JSON.stringify({ confirmation: deleteConfirm }) }), onSuccess: () => { if (typeof window !== "undefined") window.location.assign("/"); } });

  const profile = profileQ.data;
  const notif = notifQ.data ?? EMPTY_NOTIF;
  const alerts = alertsQ.data ?? [];
  const sessions = sessionsQ.data ?? [];
  const active = alerts.filter((a) => a.status === "active").length;
  const fired = alerts.filter((a) => a.status === "fired").length;

  if (me.isLoading || profileQ.isLoading) return <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-muted-foreground">Юкланмоқда...</div>;
  if (!me.data) return <div className="mx-auto max-w-3xl px-4 py-8"><EmptyState title="Аввал киринг" description="Профильга кириш учун аккаунтга кириш керак." action={<Link href="/login" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Кириш</Link>} /></div>;

  const label = profile?.display_name || profile?.full_name || me.data.full_name || me.data.email;
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <div className="overflow-x-auto rounded-xl border border-border bg-card p-2 md:hidden">
        <div className="flex min-w-max items-center gap-2">
          {[{ key: "profile", label: "Профиль маълумотлари" }, { key: "alerts", label: "Нарх огоҳлантиришлари" }, { href: "/favorites", label: "Сараланганлар" }, { href: "/recently-viewed", label: "Кўрилган товарлар" }, { key: "notifications", label: "Билдиришнома созламалари" }, { key: "security", label: "Хавфсизлик" }].map((item) => "href" in item ? <Link key={item.href} href={item.href as string} className="rounded-lg border border-border px-3 py-2 text-sm">{item.label}</Link> : <button key={item.key} type="button" onClick={() => setTab(item.key as TabKey)} className={cn("rounded-lg border px-3 py-2 text-sm", tab === item.key ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{item.label}</button>)}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <aside className="hidden rounded-2xl border border-border bg-card p-3 md:block">
          <div className="space-y-2">
            <button className={cn("w-full rounded-lg px-3 py-2 text-left text-sm", tab === "profile" ? "bg-primary text-primary-foreground" : "hover:bg-secondary")} onClick={() => setTab("profile")}>Профиль маълумотлари</button>
            <button className={cn("w-full rounded-lg px-3 py-2 text-left text-sm", tab === "alerts" ? "bg-primary text-primary-foreground" : "hover:bg-secondary")} onClick={() => setTab("alerts")}>Нарх огоҳлантиришлари</button>
            <Link href="/favorites" className="block rounded-lg px-3 py-2 text-sm hover:bg-secondary">Сараланганлар</Link>
            <Link href="/recently-viewed" className="block rounded-lg px-3 py-2 text-sm hover:bg-secondary">Кўрилган товарлар</Link>
            <button className={cn("w-full rounded-lg px-3 py-2 text-left text-sm", tab === "notifications" ? "bg-primary text-primary-foreground" : "hover:bg-secondary")} onClick={() => setTab("notifications")}>Билдиришнома созламалари</button>
            <button className={cn("w-full rounded-lg px-3 py-2 text-left text-sm", tab === "security" ? "bg-primary text-primary-foreground" : "hover:bg-secondary")} onClick={() => setTab("security")}>Хавфсизлик</button>
          </div>
        </aside>

        <section className="space-y-4">
          {tab === "profile" ? (
            <Card>
              <CardHeader><CardTitle>Профиль маълумотлари</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
                  <div className="relative h-14 w-14 overflow-hidden rounded-full bg-secondary">{avatar ? <Image src={avatar} alt="avatar" fill className="object-cover" sizes="56px" /> : <div className="flex h-full w-full items-center justify-center text-sm font-semibold">{initials(label)}</div>}</div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{label}</p>
                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-primary">
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { const val = String(r.result ?? ""); if (!val) return; setAvatar(val); if (typeof window !== "undefined") window.localStorage.setItem("doxx_profile_avatar", val); }; r.readAsDataURL(f); }} />
                      Расм юклаш
                    </label>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Исм</p><Input className="mt-2" defaultValue={profile?.display_name || ""} onBlur={(e) => patchProfile.mutate({ display_name: e.target.value })} /></div>
                  <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Email</p><Input className="mt-2" defaultValue={profile?.email || ""} onBlur={(e) => patchProfile.mutate({ email: e.target.value })} /></div>
                  <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Телефон</p><Input className="mt-2" defaultValue={profile?.phone || ""} onBlur={(e) => patchProfile.mutate({ phone: e.target.value })} /></div>
                  <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Шаҳар</p><select className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-sm" defaultValue={profile?.city || CITIES[0]} onChange={(e) => patchProfile.mutate({ city: e.target.value })}>{CITIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
                </div>
                <div className="grid gap-2 rounded-xl border border-border p-3 text-sm md:grid-cols-2">
                  <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Аккаунт яратилган сана</span><span>{profile?.created_at ? formatDateTime(profile.created_at) : "—"}</span></div>
                  <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Охирги кириш</span><span>{profile?.last_login_at ? formatDateTime(profile.last_login_at) : "—"}</span></div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {tab === "alerts" ? (
            <Card>
              <CardHeader className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>Нарх огоҳлантиришлари</CardTitle>
                  <Badge>{active} та фаол</Badge>
                  <Badge>{fired} та ишга тушди</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setSearchOpen(true)}>Огоҳлантириш қўшиш</Button>
                  <Button size="sm" variant="outline" onClick={() => alertsQ.refetch()}>Янгилаш</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border border-border p-3">
                  <p className="mb-2 text-sm font-medium">Хабар бериш каналлари</p>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={notif.channels.email} onChange={(e) => patchNotif.mutate({ channels: { ...notif.channels, email: e.target.checked } })} /> Email</label>
                    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={notif.channels.telegram} onChange={(e) => patchNotif.mutate({ channels: { ...notif.channels, telegram: e.target.checked } })} /> Telegram</label>
                    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={notif.sms_alerts} onChange={(e) => patchNotif.mutate({ sms_alerts: e.target.checked })} /> SMS</label>
                    {!notif.channels.telegram ? <Button size="sm" variant="outline" onClick={() => connectTg.mutate()}>Telegram улаш</Button> : null}
                  </div>
                </div>
                {!alertsQ.isLoading && alerts.length === 0 ? <EmptyState title="Огоҳлантиришлар ҳозирча йўқ" description="Товар танланг ва нарх тушганда хабар олинг." /> : null}
                {alerts.map((a) => (
                  <article key={a.id} className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="relative h-14 w-14 overflow-hidden rounded-md border border-border bg-white">{a.image ? <Image src={a.image} alt={a.productName} fill className="object-contain p-1" sizes="56px" /> : null}</div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="line-clamp-2 text-sm font-medium">{a.productName}</p>
                        <p className="text-xs text-muted-foreground">Жорий: <span className="text-foreground">{sum(a.currentPrice)}</span> · Мақсад: <span className="text-foreground">{sum(a.targetPrice)}</span></p>
                        <p className={cn("text-xs", (a.priceDelta ?? 0) <= 0 ? "text-emerald-600" : "text-rose-600")}>{(a.priceDelta ?? 0) <= 0 ? `↓ ${Math.abs(a.priceDropPercent ?? 0)}% — ҳали мақсадга етмаган` : `↑ ${Math.abs(a.priceDropPercent ?? 0)}% — нарх ошган`}</p>
                        <div className="flex items-center gap-2 text-xs"><Badge className={cn(a.status === "active" && "bg-emerald-100 text-emerald-700", a.status === "fired" && "bg-blue-100 text-blue-700", a.status === "cancelled" && "bg-secondary text-muted-foreground")}>{a.status === "active" ? "Фаол" : a.status === "fired" ? "Ишга тушди" : "Бекор қилинган"}</Badge><span className="text-muted-foreground">Янгиланган: {a.updatedAt ? formatRelativeTime(a.updatedAt) : "—"}</span></div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => deleteAlert.mutate(a.id)}>Ўчириш</Button>
                    </div>
                    <div className="mt-3"><Sparkline points={a.history30d} /></div>
                  </article>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {tab === "notifications" ? (
            <Card>
              <CardHeader><CardTitle>Билдиришнома созламалари</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[{ key: "price_drop", label: "Нарх тушди" }, { key: "new_offers", label: "Янги таклифлар" }, { key: "weekly_digest", label: "Ҳафталик дайджест" }, { key: "daily_deals", label: "Энг яхши таклифлар" }, { key: "marketing", label: "Маркетинг хатлари" }].map((row) => (
                  <div key={row.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl border border-border p-3 text-sm">
                    <span>{row.label}</span>
                    <label className="inline-flex items-center gap-2"><input type="checkbox" checked={Boolean(notif.matrix?.[row.key as keyof NotificationPrefs["matrix"]]?.email)} onChange={(e) => patchNotif.mutate({ matrix: { [row.key]: { ...notif.matrix?.[row.key as keyof NotificationPrefs["matrix"]], email: e.target.checked } } })} /> Email</label>
                    <label className="inline-flex items-center gap-2"><input type="checkbox" checked={Boolean(notif.matrix?.[row.key as keyof NotificationPrefs["matrix"]]?.telegram)} onChange={(e) => patchNotif.mutate({ matrix: { [row.key]: { ...notif.matrix?.[row.key as keyof NotificationPrefs["matrix"]], telegram: e.target.checked } } })} /> Telegram</label>
                  </div>
                ))}
                <div className="rounded-xl border border-border p-3"><p className="mb-2 text-sm font-medium">Дайджест частотаси</p><select className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" value={notif.digest_frequency} onChange={(e) => patchNotif.mutate({ digest_frequency: e.target.value })}><option value="daily">Ҳар куни</option><option value="weekly">Ҳафтасига</option><option value="monthly">Ойига бир марта</option></select></div>
              </CardContent>
            </Card>
          ) : null}

          {tab === "security" ? (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle>Паролни ўзгартириш</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <Input type="password" placeholder="Жорий парол" value={pwdCurrent} onChange={(e) => setPwdCurrent(e.target.value)} />
                  <Input type="password" placeholder="Янги парол" value={pwdNew} onChange={(e) => setPwdNew(e.target.value)} />
                  <Input type="password" placeholder="Янги паролни тасдиқланг" value={pwdConfirm} onChange={(e) => setPwdConfirm(e.target.value)} />
                  <Button onClick={() => { if (pwdNew !== pwdConfirm) { toast.error("Парол тасдиғи мос эмас"); return; } changePassword.mutate(); }} disabled={changePassword.isPending || !pwdCurrent || !pwdNew || !pwdConfirm}>Янгилаш</Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between"><CardTitle>Фаол сеанслар</CardTitle><Button size="sm" variant="outline" onClick={() => revokeAll.mutate()}>Барча қурилмалардан чиқиш</Button></CardHeader>
                <CardContent className="space-y-2">
                  {sessions.map((s) => (
                    <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm">
                      <div><p className="font-medium">{s.device}</p><p className="text-xs text-muted-foreground">{s.location} · {s.ip_address}</p><p className="text-xs text-muted-foreground">Охирги фаоллик: {formatDateTime(s.last_seen_at)}</p></div>
                      {s.is_current ? <Badge>Жорий</Badge> : <Button size="sm" variant="outline" onClick={() => revokeSession.mutate(s.id)}>Чиқиш</Button>}
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-rose-600">Аккаунтни ўчириш</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">Тасдиқлаш учун <code>ЎЧИРИШ</code> сўзини киритинг</p>
                  <Input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="ЎЧИРИШ" />
                  <Button variant="destructive" disabled={deleteConfirm.trim().toUpperCase() !== "ЎЧИРИШ" || deleteAccount.isPending} onClick={() => deleteAccount.mutate()}>Аккаунтни ўчириш</Button>
                </CardContent>
              </Card>
              <Button variant="outline" onClick={() => logout.mutate(undefined)}>Чиқиш</Button>
            </div>
          ) : null}
        </section>
      </div>

      <SearchModal open={searchOpen} onOpenChange={setSearchOpen} onSelect={(item) => setAlertModal({ productId: item.id, currentPrice: Number(item.minPrice ?? 0) || null })} />
      <PriceAlertModal open={Boolean(alertModal)} onOpenChange={(open) => { if (!open) setAlertModal(null); }} productId={alertModal?.productId ?? ""} currentPrice={alertModal?.currentPrice ?? null} onSuccess={() => qc.invalidateQueries({ queryKey: ["alerts-v3"] })} />
    </div>
  );
}

export function RecentlyViewedClient() {
  const me = useAuthMe();
  const items = useRecentlyViewedStore((s) => s.items);
  const clear = useRecentlyViewedStore((s) => s.clear);
  const mergeRemote = useRecentlyViewedStore((s) => s.mergeRemote);
  const remote = useQuery({
    queryKey: ["recent-v3"],
    enabled: Boolean(me.data?.id),
    queryFn: () => api<Array<{ id: string; slug: string; title: string; image_url?: string | null; min_price?: number | null; viewed_at: string }>>("/api/user/recently-viewed"),
  });

  useEffect(() => {
    if (!remote.data?.length) return;
    mergeRemote(remote.data);
  }, [mergeRemote, remote.data]);

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Кўрилган товарлар</h1>
        <Button variant="outline" onClick={async () => { clear(); await fetch("/api/user/recently-viewed", { method: "DELETE" }).catch(() => undefined); }}>Тозалаш</Button>
      </div>
      {items.length === 0 ? <EmptyState title="Ҳозирча кўрилган товарлар йўқ" description="Каталогдан товар очганингизда бу ерда сақланади." /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Link key={item.id} href={`/product/${item.slug || item.id}`} className="rounded-xl border border-border p-3 hover:bg-secondary/30">
              <p className="line-clamp-2 text-sm font-medium">{item.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(item.viewedAt)}</p>
              {item.minPrice ? <p className="mt-2 text-sm font-semibold text-primary">{formatPrice(item.minPrice)} сўм</p> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
