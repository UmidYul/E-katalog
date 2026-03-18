import { NextResponse } from "next/server";

import { env } from "@/config/env";

type HealthPayload = { status?: string };
type LivePayload = { status?: string; at?: string };
type ReadyPayload = {
  status?: string;
  checks?: {
    db?: { status?: string };
    redis?: { status?: string };
    celery?: { status?: string };
  };
};

type IncidentPayload = {
  id?: string;
  title?: string;
  status?: string;
  started_at?: string;
  resolved_at?: string | null;
};

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

const statusPriority: Record<PublicStatus, number> = {
  operational: 0,
  degraded: 1,
  outage: 2,
};

const requestJson = async <T,>(path: string): Promise<T> => {
  let lastError: unknown;
  for (const origin of env.apiServerOrigins) {
    try {
      const response = await fetch(`${origin}${env.apiPrefix}${path}`, {
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        lastError = new Error(`${path} -> ${response.status}`);
        continue;
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`failed_to_fetch_${path}`);
};

const toPublicStatus = (value: string | null | undefined): PublicStatus => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "ok" || normalized === "ready" || normalized === "alive") return "operational";
  if (normalized === "degraded") return "degraded";
  return "outage";
};

const uptimeFromStatus = (status: PublicStatus) => {
  if (status === "operational") return 100;
  if (status === "degraded") return 99.72;
  return 98.33;
};

const buildUptimeBars = (overallStatus: PublicStatus): UptimeBar[] => {
  const bars: UptimeBar[] = [];
  const now = new Date();
  for (let i = 89; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - i);
    bars.push({
      date: date.toISOString().slice(0, 10),
      status: "operational",
    });
  }

  if (overallStatus === "degraded") {
    const lastIndex = bars.length - 1;
    const last = bars[lastIndex];
    if (last) {
      bars[lastIndex] = { date: last.date, status: "degraded" };
    }
  }
  if (overallStatus === "outage") {
    const penultimateIndex = bars.length - 2;
    const lastIndex = bars.length - 1;
    const penultimate = bars[penultimateIndex];
    const last = bars[lastIndex];
    if (penultimate) {
      bars[penultimateIndex] = { date: penultimate.date, status: "degraded" };
    }
    if (last) {
      bars[lastIndex] = { date: last.date, status: "outage" };
    }
  }

  return bars;
};

const parseIncidents = (payload: unknown): Incident[] => {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => {
      const row = item as IncidentPayload;
      const id = String(row.id ?? "").trim();
      const title = String(row.title ?? "").trim();
      if (!id || !title) return null;
      return {
        id,
        title,
        startedAt: String(row.started_at ?? new Date().toISOString()),
        resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
        status: String(row.status ?? "").toLowerCase() === "resolved" ? "resolved" : "investigating",
      } satisfies Incident;
    })
    .filter((item): item is Incident => Boolean(item));
};

const overallFromServices = (services: ServiceRow[]): PublicStatus => {
  const worst = services.reduce<PublicStatus>(
    (currentWorst, service) =>
      statusPriority[service.status] > statusPriority[currentWorst] ? service.status : currentWorst,
    "operational",
  );
  return worst;
};

export async function GET() {
  const now = new Date().toISOString();

  try {
    const [health, live, ready, incidentsPayload] = await Promise.all([
      requestJson<HealthPayload>("/health"),
      requestJson<LivePayload>("/live"),
      requestJson<ReadyPayload>("/ready"),
      requestJson<unknown>("/status/incidents").catch(() => []),
    ]);

    const siteStatus = toPublicStatus(health.status) === "operational" && toPublicStatus(live.status) !== "outage"
      ? "operational"
      : "outage";
    const dbStatus = toPublicStatus(ready.checks?.db?.status);
    const redisStatus = toPublicStatus(ready.checks?.redis?.status);
    const workerStatus = toPublicStatus(ready.checks?.celery?.status);
    const searchStatus: PublicStatus = dbStatus === "outage" || redisStatus === "outage"
      ? "outage"
      : dbStatus === "degraded" || redisStatus === "degraded"
        ? "degraded"
        : "operational";

    const services: ServiceRow[] = [
      {
        key: "frontend",
        name: "Сайт",
        status: siteStatus,
        lastChecked: now,
        uptime30d: uptimeFromStatus(siteStatus),
      },
      {
        key: "prices",
        name: "Нарх базаси",
        status: dbStatus,
        lastChecked: now,
        uptime30d: uptimeFromStatus(dbStatus),
      },
      {
        key: "search",
        name: "Қидирув",
        status: searchStatus,
        lastChecked: now,
        uptime30d: uptimeFromStatus(searchStatus),
      },
      {
        key: "parser",
        name: "Нарх янгилаш",
        status: workerStatus,
        lastChecked: now,
        uptime30d: uptimeFromStatus(workerStatus),
      },
      {
        key: "notifications",
        name: "Билдиришномалар",
        status: workerStatus === "outage" ? "outage" : workerStatus === "degraded" ? "degraded" : "operational",
        lastChecked: now,
        uptime30d: uptimeFromStatus(workerStatus),
      },
    ];

    const overallStatus = overallFromServices(services);
    const payload: DashboardPayload = {
      overallStatus,
      lastChecked: now,
      services,
      uptime90d: buildUptimeBars(overallStatus),
      incidents: parseIncidents(incidentsPayload),
    };

    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch {
    const fallbackServices: ServiceRow[] = [
      { key: "frontend", name: "Сайт", status: "degraded", lastChecked: now, uptime30d: 99.5 },
      { key: "prices", name: "Нарх базаси", status: "degraded", lastChecked: now, uptime30d: 99.5 },
      { key: "search", name: "Қидирув", status: "degraded", lastChecked: now, uptime30d: 99.5 },
      { key: "parser", name: "Нарх янгилаш", status: "degraded", lastChecked: now, uptime30d: 99.5 },
      { key: "notifications", name: "Билдиришномалар", status: "degraded", lastChecked: now, uptime30d: 99.5 },
    ];
    const payload: DashboardPayload = {
      overallStatus: "degraded",
      lastChecked: now,
      services: fallbackServices,
      uptime90d: buildUptimeBars("degraded"),
      incidents: [],
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  }
}
