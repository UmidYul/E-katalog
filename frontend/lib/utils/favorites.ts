export const FAVORITES_STORAGE_KEY = "doxx_favorites";
export const FAVORITES_META_STORAGE_KEY = "doxx_favorites_meta";

export type FavoriteMeta = {
  savedPrice: number | null;
  addedAt: string;
};

export type FavoriteMetaMap = Record<string, FavoriteMeta>;

const normalizeId = (value: unknown) => String(value ?? "").trim().toLowerCase();

const normalizePrice = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
};

const normalizeDate = (value: unknown): string => {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
};

const readJson = <T>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
};

export const readFavoriteIds = (): string[] => {
  const parsed = readJson<unknown[]>(FAVORITES_STORAGE_KEY, []);
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of parsed) {
    const id = normalizeId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
};

export const writeFavoriteIds = (ids: string[]) => {
  const normalized = Array.from(new Set(ids.map((id) => normalizeId(id)).filter(Boolean)));
  writeJson(FAVORITES_STORAGE_KEY, normalized);
};

export const readFavoriteMetaMap = (): FavoriteMetaMap => {
  const parsed = readJson<Record<string, unknown>>(FAVORITES_META_STORAGE_KEY, {});
  if (!parsed || typeof parsed !== "object") return {};

  const result: FavoriteMetaMap = {};
  for (const [rawId, rawMeta] of Object.entries(parsed)) {
    const id = normalizeId(rawId);
    if (!id || !rawMeta || typeof rawMeta !== "object") continue;

    const meta = rawMeta as { savedPrice?: unknown; addedAt?: unknown };
    result[id] = {
      savedPrice: normalizePrice(meta.savedPrice),
      addedAt: normalizeDate(meta.addedAt),
    };
  }

  return result;
};

export const writeFavoriteMetaMap = (metaMap: FavoriteMetaMap) => {
  const normalized: FavoriteMetaMap = {};
  for (const [rawId, meta] of Object.entries(metaMap)) {
    const id = normalizeId(rawId);
    if (!id) continue;
    normalized[id] = {
      savedPrice: normalizePrice(meta.savedPrice),
      addedAt: normalizeDate(meta.addedAt),
    };
  }
  writeJson(FAVORITES_META_STORAGE_KEY, normalized);
};

export const addAnonymousFavorite = (productId: string, savedPrice?: number | null) => {
  const id = normalizeId(productId);
  if (!id) return;

  const ids = readFavoriteIds();
  if (!ids.includes(id)) {
    ids.unshift(id);
  }

  const meta = readFavoriteMetaMap();
  const existing = meta[id];
  meta[id] = {
    savedPrice: normalizePrice(savedPrice) ?? existing?.savedPrice ?? null,
    addedAt: existing?.addedAt ?? new Date().toISOString(),
  };

  writeFavoriteIds(ids);
  writeFavoriteMetaMap(meta);
};

export const removeAnonymousFavorite = (productId: string) => {
  const id = normalizeId(productId);
  if (!id) return;

  const ids = readFavoriteIds().filter((entry) => entry !== id);
  const meta = readFavoriteMetaMap();
  delete meta[id];

  writeFavoriteIds(ids);
  writeFavoriteMetaMap(meta);
};

export const clearAnonymousFavorites = () => {
  writeFavoriteIds([]);
  writeFavoriteMetaMap({});
};

export const isAnonymousFavorite = (productId: string) => {
  const id = normalizeId(productId);
  if (!id) return false;
  return readFavoriteIds().includes(id);
};
