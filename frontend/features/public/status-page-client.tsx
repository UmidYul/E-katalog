"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/utils/format";

type PublicStatus = "operational" | "degraded" | "outage";

type ServiceRow = {
  key: string;
  name: string;
  status: PublicStatus;
  lastChecked: string;
  uptime30d: number;
};

type UptimeBar = {
  date: string;
  status: PublicStatus;
};

type Incident = {
  id: string;
  title: string;
  startedAt: string;
  resolvedAt: string | null;
  status: "resolved" | "investigating";
};

type DashboardPayload = {
  overallStatus: PublicStatus;
  lastChecked: string;
  services: ServiceRow[];
  uptime90d: UptimeBar[];
  incidents: Incident[];
};

const STATUS_META: Record<
  PublicStatus,
  { label: string; dotClass: string; pillClass: string; textClass: string }
> = {
  operational: {
    label: "Ишламоқда",
    dotClass: "bg-emerald-500",
    pillClass: "border-emerald-300 bg-emerald-50 text-emerald-700",
    textClass: "text-emerald-700",
  },
  degraded: {
    label: "Секинлашган",
    dotClass: "bg-amber-500",
    pillClass: "border-amber-300 bg-amber-50 text-amber-700",
    textClass: "text-amber-700",
  },
  outage: {
    label: "Носоз",
    dotClass: "bg-rose-500",
    pillClass: "border-rose-300 bg-rose-50 text-rose-700",
    textClass: "text-rose-700",
  },
};

const secondsSince = (isoDate: string) => {
  const parsed = new Date(isoDate).getTime();
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.floor((Date.now() - parsed) / 1000));
};

export function StatusPageClient() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((prev) => prev + 1), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const query = useQuery({
    queryKey: ["status-dashboard"],
    queryFn: async (): Promise<DashboardPayload> => {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) throw new Error("status_fetch_failed");
      return (await response.json()) as DashboardPayload;
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    staleTime: 30_000,
  });

  const data = query.data;
  const secondsAgo = useMemo(() => {
    if (!data?.lastChecked) return 0;
    return secondsSince(data.lastChecked);
  }, [data?.lastChecked, tick]);

  if (query.isLoading) {
    return (
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-8">
        <div className="h-12 animate-pulse rounded-xl bg-secondary/40" />
        <div className="h-64 animate-pulse rounded-xl bg-secondary/40" />
        <div className="h-28 animate-pulse rounded-xl bg-secondary/40" />
      </main>
    );
  }

  if (query.isError || !data) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <EmptyState
          title="Статус маълумотини юклаб бўлмади"
          description="Илтимос, бироздан сўнг қайта уриниб кўринг."
        />
      </main>
    );
  }

  const overallOperational = data.overallStatus === "operational";
  const overallLabel = overallOperational ? "Барча тизимлар ишламоқда" : "Носозлик аниқланди";
  const overallStyle = STATUS_META[data.overallStatus].pillClass;

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-8">
      <header className="space-y-2">
        <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium", overallStyle)}>
          <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_META[data.overallStatus].dotClass)} />
          {overallLabel}
        </span>
        <p className="text-sm text-muted-foreground">Янгиланди: {secondsAgo} сония олдин</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Хизматлар ҳолати</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-muted-foreground">
                <th className="px-2 py-2">Хизмат</th>
                <th className="px-2 py-2">Ҳолат</th>
                <th className="px-2 py-2">Охирги текширув</th>
                <th className="px-2 py-2">30 кунлик uptime</th>
              </tr>
            </thead>
            <tbody>
              {data.services.map((service) => {
                const meta = STATUS_META[service.status];
                return (
                  <tr key={service.key} className="border-b border-border/70 last:border-b-0">
                    <td className="px-2 py-3 font-medium">{service.name}</td>
                    <td className="px-2 py-3">
                      <span className={cn("inline-flex items-center gap-2", meta.textClass)}>
                        <span className={cn("h-2.5 w-2.5 rounded-full", meta.dotClass)} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-muted-foreground">
                      {formatDateTime(service.lastChecked, "uz-Cyrl-UZ", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-2 py-3 font-medium">{service.uptime30d.toFixed(2)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Охирги 90 кун uptime</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-1 overflow-x-auto pb-2">
            {data.uptime90d.map((bar) => (
              <span
                key={bar.date}
                className={cn(
                  "h-9 w-1.5 shrink-0 rounded-sm",
                  bar.status === "operational" && "bg-emerald-500",
                  bar.status === "degraded" && "bg-amber-500",
                  bar.status === "outage" && "bg-rose-500",
                )}
                title={`${bar.date}: ${STATUS_META[bar.status].label}`}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              Ишламоқда
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              Секинлашган
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
              Носоз
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Инцидентлар</CardTitle>
        </CardHeader>
        <CardContent>
          {data.incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Охирги 90 кунда инцидент бўлмаган</p>
          ) : (
            <div className="space-y-3">
              {data.incidents.map((incident) => (
                <article key={incident.id} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-sm font-medium">{incident.title}</h3>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        incident.status === "resolved" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
                      )}
                    >
                      {incident.status === "resolved" ? "Ҳал қилинган" : "Текширилмоқда"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Бошланган: {formatDateTime(incident.startedAt, "uz-Cyrl-UZ", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {incident.resolvedAt
                      ? `Якунланган: ${formatDateTime(incident.resolvedAt, "uz-Cyrl-UZ", { dateStyle: "medium", timeStyle: "short" })}`
                      : `Янгиланган: ${formatRelativeTime(incident.startedAt)}`}
                  </p>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
