import { NextResponse } from "next/server";

import { safeParseJson, userBackendFetch } from "@/app/api/user/_helpers";

type BackendAlert = {
  id: string;
  product_id: string;
  channel?: string;
  alerts_enabled?: boolean;
  baseline_price?: number | null;
  target_price?: number | null;
  last_seen_price?: number | null;
  last_notified_at?: string | null;
  updated_at?: string | null;
};

type BackendOfferStore = {
  minimal_price?: number | null;
  offers_count?: number | null;
};

type BackendProduct = {
  id?: string;
  title?: string;
  main_image?: string | null;
  category?: string | null;
  offers_by_store?: BackendOfferStore[];
};

type BackendHistoryPoint = {
  date?: string;
  price?: number | null;
  min_price?: number | null;
  max_price?: number | null;
};

const toNumberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
};

const toCurrentPrice = (product: BackendProduct): number | null => {
  const prices = (product.offers_by_store ?? [])
    .map((store) => toNumberOrNull(store.minimal_price))
    .filter((price): price is number => price != null);
  if (!prices.length) return null;
  return Math.min(...prices);
};

const toStatus = (alert: BackendAlert, currentPrice: number | null) => {
  if (!alert.alerts_enabled) return "cancelled";
  const targetPrice = toNumberOrNull(alert.target_price);
  if (alert.last_notified_at) return "fired";
  if (targetPrice != null && currentPrice != null && currentPrice <= targetPrice) return "fired";
  return "active";
};

const toHistory = (points: BackendHistoryPoint[]) =>
  points
    .map((point) => ({
      date: String(point.date ?? ""),
      price: toNumberOrNull(point.price ?? point.min_price ?? point.max_price),
    }))
    .filter((point) => point.date && point.price != null)
    .map((point) => ({ date: point.date, price: point.price as number }));

export async function GET(request: Request) {
  const alertsResponse = await userBackendFetch(request, "/users/me/alerts?limit=200");
  if (!alertsResponse.ok) {
    return NextResponse.json([], {
      status: alertsResponse.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const alerts = await safeParseJson<BackendAlert[]>(alertsResponse, []);
  const enriched = await Promise.all(
    alerts.map(async (alert) => {
      const productId = String(alert.product_id ?? "").trim();
      if (!productId) return null;

      const [productResponse, historyResponse] = await Promise.all([
        userBackendFetch(request, `/products/${productId}`),
        userBackendFetch(request, `/products/${productId}/price-history?days=30`),
      ]);

      const product = productResponse.ok ? await safeParseJson<BackendProduct>(productResponse, {}) : {};
      const historyPoints = historyResponse.ok ? await safeParseJson<BackendHistoryPoint[]>(historyResponse, []) : [];

      const currentPrice = toCurrentPrice(product);
      const baselinePrice = toNumberOrNull(alert.baseline_price) ?? currentPrice;
      const targetPrice = toNumberOrNull(alert.target_price);
      const priceDelta =
        currentPrice != null && baselinePrice != null ? Math.round(currentPrice - baselinePrice) : null;
      const priceDropPercent =
        priceDelta != null && baselinePrice != null && baselinePrice > 0
          ? Math.round((Math.abs(priceDelta) / baselinePrice) * 100) * (priceDelta <= 0 ? 1 : -1)
          : null;

      return {
        id: String(alert.id),
        productId,
        productName: String(product.title ?? productId),
        image: product.main_image ?? null,
        category: product.category ?? null,
        currentPrice,
        baselinePrice,
        targetPrice,
        priceDelta,
        priceDropPercent,
        status: toStatus(alert, currentPrice),
        channel: String(alert.channel ?? "telegram"),
        updatedAt: alert.updated_at ?? null,
        lastNotifiedAt: alert.last_notified_at ?? null,
        history30d: toHistory(historyPoints),
      };
    }),
  );

  return NextResponse.json(enriched.filter(Boolean), {
    headers: { "Cache-Control": "no-store" },
  });
}
