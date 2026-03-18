import { env } from "@/config/env";

type BackendFavoriteItem = {
  product_id?: string;
  saved_price?: number | null;
  added_at?: string | null;
};

type BackendPriceAlert = {
  id: string;
  product_id: string;
  alerts_enabled?: boolean;
  baseline_price?: number | null;
  updated_at?: string | null;
};

type BackendProductOfferStore = {
  minimal_price?: number | null;
  offers_count?: number | null;
};

type BackendProductDetail = {
  id?: string;
  title?: string;
  category?: string;
  main_image?: string | null;
  offers_by_store?: BackendProductOfferStore[];
};

export type ApiFavoriteItem = {
  product_id: string;
  saved_price: number | null;
  added_at: string | null;
  current_min_price: number | null;
  price_delta: number | null;
  price_drop_percent: number | null;
  category: string | null;
  normalized_title: string | null;
  image_url: string | null;
  store_count: number;
  offers_count: number;
  alerts_enabled: boolean;
};

const normalizeId = (value: unknown) => String(value ?? "").trim().toLowerCase();

const normalizePrice = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
};

const normalizeDate = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const getRequestCookie = (request: Request) => request.headers.get("cookie") ?? "";

export const backendFetch = async (
  request: Request,
  path: string,
  init?: RequestInit,
) => {
  const response = await fetch(`${env.apiInternalOrigin}${env.apiPrefix}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      cookie: getRequestCookie(request),
      ...(init?.headers ?? {}),
    },
  });

  return response;
};

const getCurrentMinPrice = (product: BackendProductDetail): number | null => {
  const prices = (product.offers_by_store ?? [])
    .map((store) => normalizePrice(store.minimal_price))
    .filter((price): price is number => price != null);
  if (!prices.length) return null;
  return Math.min(...prices);
};

const getOffersCount = (product: BackendProductDetail): number =>
  (product.offers_by_store ?? [])
    .map((store) => Number(store.offers_count ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .reduce((acc, value) => acc + value, 0);

export const listFavoriteItemsWithDetails = async (
  request: Request,
): Promise<{ status: number; items: ApiFavoriteItem[] }> => {
  const favoritesResponse = await backendFetch(request, "/users/favorites");
  if (favoritesResponse.status === 401) return { status: 401, items: [] };
  if (!favoritesResponse.ok) return { status: favoritesResponse.status, items: [] };

  const rawFavorites = (await favoritesResponse.json().catch(() => [])) as BackendFavoriteItem[];
  const favorites = Array.isArray(rawFavorites)
    ? rawFavorites
        .map((item) => ({
          productId: normalizeId(item.product_id),
          savedPrice: normalizePrice(item.saved_price),
          addedAt: normalizeDate(item.added_at),
        }))
        .filter((item) => Boolean(item.productId))
    : [];

  const alertsResponse = await backendFetch(request, "/users/me/alerts?channel=telegram&limit=500");
  const alertsPayload = alertsResponse.ok
    ? ((await alertsResponse.json().catch(() => [])) as BackendPriceAlert[])
    : [];
  const alertsByProductId = new Map<string, BackendPriceAlert>();
  for (const alert of alertsPayload) {
    const productId = normalizeId(alert.product_id);
    if (!productId) continue;
    alertsByProductId.set(productId, alert);
  }

  const detailedItems = await Promise.all(
    favorites.map(async (favorite) => {
      const productResponse = await backendFetch(request, `/products/${favorite.productId}`);
      const product = productResponse.ok
        ? ((await productResponse.json().catch(() => ({}))) as BackendProductDetail)
        : ({} as BackendProductDetail);

      const alert = alertsByProductId.get(favorite.productId);
      const currentMinPrice = getCurrentMinPrice(product);
      const savedPrice = favorite.savedPrice ?? normalizePrice(alert?.baseline_price) ?? currentMinPrice;
      const priceDelta =
        currentMinPrice != null && savedPrice != null ? Math.round(currentMinPrice - savedPrice) : null;

      let priceDropPercent: number | null = null;
      if (priceDelta != null && savedPrice != null && savedPrice > 0) {
        const absPercent = Math.round((Math.abs(priceDelta) / savedPrice) * 100);
        if (priceDelta < 0) priceDropPercent = absPercent;
        else if (priceDelta > 0) priceDropPercent = -absPercent;
        else priceDropPercent = 0;
      }

      return {
        product_id: favorite.productId,
        saved_price: savedPrice,
        added_at: favorite.addedAt ?? normalizeDate(alert?.updated_at),
        current_min_price: currentMinPrice,
        price_delta: priceDelta,
        price_drop_percent: priceDropPercent,
        category: typeof product.category === "string" ? product.category : null,
        normalized_title: typeof product.title === "string" ? product.title : null,
        image_url: typeof product.main_image === "string" ? product.main_image : null,
        store_count: Math.max((product.offers_by_store ?? []).length, 0),
        offers_count: getOffersCount(product),
        alerts_enabled: Boolean(alert?.alerts_enabled),
      } satisfies ApiFavoriteItem;
    }),
  );

  return { status: 200, items: detailedItems };
};

const ensureFavoriteAddedOnBackend = async (
  request: Request,
  productId: string,
) => {
  const current = await backendFetch(request, "/users/favorites");
  if (!current.ok) return { ok: false, status: current.status };

  const payload = (await current.json().catch(() => [])) as BackendFavoriteItem[];
  const hasFavorite = Array.isArray(payload)
    ? payload.some((item) => normalizeId(item.product_id) === productId)
    : false;

  if (hasFavorite) return { ok: true, status: 200 };

  const toggleResponse = await backendFetch(request, `/users/favorites/${productId}`, {
    method: "POST",
  });
  return { ok: toggleResponse.ok, status: toggleResponse.status };
};

const ensureFavoriteRemovedOnBackend = async (
  request: Request,
  productId: string,
) => {
  const current = await backendFetch(request, "/users/favorites");
  if (!current.ok) return { ok: false, status: current.status };

  const payload = (await current.json().catch(() => [])) as BackendFavoriteItem[];
  const hasFavorite = Array.isArray(payload)
    ? payload.some((item) => normalizeId(item.product_id) === productId)
    : false;

  if (!hasFavorite) return { ok: true, status: 200 };

  const toggleResponse = await backendFetch(request, `/users/favorites/${productId}`, {
    method: "POST",
  });

  return { ok: toggleResponse.ok, status: toggleResponse.status };
};

const upsertFavoriteBaselineAlert = async (
  request: Request,
  productId: string,
  currentPrice: number | null,
) => {
  const alertsResponse = await backendFetch(request, "/users/me/alerts?channel=telegram&limit=500");
  const existingAlerts = alertsResponse.ok
    ? ((await alertsResponse.json().catch(() => [])) as BackendPriceAlert[])
    : [];

  const hasExisting = existingAlerts.some((alert) => normalizeId(alert.product_id) === productId);

  const payload: Record<string, unknown> = {
    channel: "telegram",
    baseline_price: currentPrice,
    current_price: currentPrice,
  };

  if (!hasExisting) {
    payload.alerts_enabled = false;
    payload.target_price = null;
  }

  await backendFetch(request, `/products/${productId}/alerts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

export const addFavoriteForUser = async (
  request: Request,
  productIdRaw: string,
  currentPriceRaw: unknown,
) => {
  const productId = normalizeId(productIdRaw);
  if (!productId) return { ok: false, status: 400 };

  const added = await ensureFavoriteAddedOnBackend(request, productId);
  if (!added.ok) return { ok: false, status: added.status || 502 };

  const currentPrice = normalizePrice(currentPriceRaw);
  if (currentPrice != null) {
    try {
      await upsertFavoriteBaselineAlert(request, productId, currentPrice);
    } catch {
      // ignore alert baseline sync failures
    }
  }

  return { ok: true, status: 200 };
};

export const removeFavoriteForUser = async (
  request: Request,
  productIdRaw: string,
) => {
  const productId = normalizeId(productIdRaw);
  if (!productId) return { ok: false, status: 400 };
  const removed = await ensureFavoriteRemovedOnBackend(request, productId);
  if (!removed.ok) return { ok: false, status: removed.status || 502 };
  return { ok: true, status: 200 };
};

export const toggleFavoriteForUser = async (
  request: Request,
  productIdRaw: string,
  currentPriceRaw: unknown,
) => {
  const productId = normalizeId(productIdRaw);
  if (!productId) return { ok: false, status: 400, favorited: false };

  const listResponse = await backendFetch(request, "/users/favorites");
  if (listResponse.status === 401) return { ok: false, status: 401, favorited: false };
  if (!listResponse.ok) return { ok: false, status: listResponse.status, favorited: false };

  const currentItems = (await listResponse.json().catch(() => [])) as BackendFavoriteItem[];
  const hasFavorite = Array.isArray(currentItems)
    ? currentItems.some((item) => normalizeId(item.product_id) === productId)
    : false;

  if (hasFavorite) {
    const removed = await ensureFavoriteRemovedOnBackend(request, productId);
    return { ok: removed.ok, status: removed.ok ? 200 : removed.status || 502, favorited: false };
  }

  const added = await ensureFavoriteAddedOnBackend(request, productId);
  if (!added.ok) return { ok: false, status: added.status || 502, favorited: false };

  const currentPrice = normalizePrice(currentPriceRaw);
  if (currentPrice != null) {
    try {
      await upsertFavoriteBaselineAlert(request, productId, currentPrice);
    } catch {
      // ignore alert baseline sync failures
    }
  }

  return { ok: true, status: 200, favorited: true };
};
