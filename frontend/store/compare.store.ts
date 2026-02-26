import { create } from "zustand";
import { persist } from "zustand/middleware";

export const COMPARE_LIMIT = 4;
export const COMPARE_HISTORY_LIMIT = 12;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CompareItem = {
  id: string;
  title: string;
  slug: string;
  category?: string;
  addedAt: string;
};

export type CompareHistoryEntry = {
  id: string;
  createdAt: string;
  signature: string;
  category?: string;
  items: CompareItem[];
};

export type CompareToggleResult = "added" | "removed" | "limit_reached" | "category_mismatch" | "already_added";

type CompareState = {
  items: CompareItem[];
  history: CompareHistoryEntry[];
  add: (item: Omit<CompareItem, "addedAt">) => CompareToggleResult;
  replace: (items: Omit<CompareItem, "addedAt">[]) => void;
  remove: (id: string) => void;
  toggle: (item: Omit<CompareItem, "addedAt">) => CompareToggleResult;
  clear: () => void;
  saveSnapshot: (sourceItems?: CompareItem[]) => void;
  restoreSnapshot: (historyId: string) => void;
  clearHistory: () => void;
};

const normalizeText = (value: unknown): string | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
};

const normalizeUuid = (value: unknown): string | null => {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized || !UUID_PATTERN.test(normalized)) return null;
  return normalized;
};

const normalizeCategory = (value: unknown) => {
  const cleaned = normalizeText(value)?.toLowerCase();
  return cleaned || undefined;
};

const normalizeIsoDate = (value: unknown): string => {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
};

const getReferenceCategory = (items: CompareItem[]) => {
  for (const item of items) {
    const category = normalizeCategory(item.category);
    if (category) return category;
  }
  return undefined;
};

const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const sanitizeCompareItem = (value: unknown): CompareItem | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const id = normalizeUuid(candidate.id);
  if (!id) return null;
  return {
    id,
    title: normalizeText(candidate.title) ?? id,
    slug: normalizeText(candidate.slug) ?? id,
    category: normalizeCategory(candidate.category),
    addedAt: normalizeIsoDate(candidate.addedAt)
  };
};

const sanitizeCompareItems = (value: unknown): CompareItem[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeCompareItem(item))
    .filter((item): item is CompareItem => Boolean(item))
    .slice(0, COMPARE_LIMIT);
};

const sanitizeHistoryEntry = (value: unknown): CompareHistoryEntry | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const items = sanitizeCompareItems(candidate.items);
  if (items.length < 2) return null;
  const computedSignature = items
    .map((item) => item.id)
    .sort((a, b) => a.localeCompare(b))
    .join(":");
  return {
    id: normalizeText(candidate.id) ?? createId(),
    createdAt: normalizeIsoDate(candidate.createdAt),
    signature: normalizeText(candidate.signature) ?? computedSignature,
    category: normalizeCategory(candidate.category),
    items
  };
};

const sanitizeCompareHistory = (value: unknown): CompareHistoryEntry[] => {
  if (!Array.isArray(value)) return [];
  const dedupe = new Set<string>();
  const entries: CompareHistoryEntry[] = [];
  for (const candidate of value) {
    const normalized = sanitizeHistoryEntry(candidate);
    if (!normalized) continue;
    if (dedupe.has(normalized.signature)) continue;
    dedupe.add(normalized.signature);
    entries.push(normalized);
    if (entries.length >= COMPARE_HISTORY_LIMIT) break;
  }
  return entries;
};

const appendItem = (current: CompareItem[], next: Omit<CompareItem, "addedAt">) => {
  const nextId = normalizeUuid(next.id);
  if (!nextId) return { type: "already_added" as const, items: current };
  if (current.some((existing) => existing.id === nextId)) return { type: "already_added" as const, items: current };
  if (current.length >= COMPARE_LIMIT) return { type: "limit_reached" as const, items: current };
  const referenceCategory = getReferenceCategory(current);
  const nextCategory = normalizeCategory(next.category);
  if (referenceCategory && nextCategory && referenceCategory !== nextCategory) {
    return { type: "category_mismatch" as const, items: current };
  }
  const nextItems = [
    ...current,
    {
      id: nextId,
      title: normalizeText(next.title) ?? nextId,
      slug: normalizeText(next.slug) ?? nextId,
      category: nextCategory,
      addedAt: new Date().toISOString()
    },
  ];
  return { type: "added" as const, items: nextItems };
};

const sanitizeIncomingItems = (items: Omit<CompareItem, "addedAt">[]) => {
  const normalized: CompareItem[] = [];
  let referenceCategory: string | undefined;
  for (const raw of items) {
    const id = normalizeUuid(raw.id);
    if (!id) continue;
    if (normalized.some((item) => item.id === id)) continue;
    const category = normalizeCategory(raw.category);
    if (referenceCategory && category && category !== referenceCategory) continue;
    if (!referenceCategory && category) referenceCategory = category;
    normalized.push({
      id,
      title: normalizeText(raw.title) ?? id,
      slug: normalizeText(raw.slug) ?? id,
      category,
      addedAt: new Date().toISOString()
    });
    if (normalized.length >= COMPARE_LIMIT) break;
  }
  return normalized;
};

export const useCompareStore = create<CompareState>()(
  persist(
    (set, get) => ({
      items: [],
      history: [],
      add: (item) => {
        const current = get().items;
        const result = appendItem(current, item);
        if (result.type === "added") {
          set({ items: result.items });
        }
        return result.type;
      },
      replace: (items) => {
        set({ items: sanitizeIncomingItems(items) });
      },
      remove: (id) => {
        const normalizedId = normalizeText(id);
        if (!normalizedId) return;
        set((state) => ({ items: state.items.filter((item) => item.id !== normalizedId) }));
      },
      toggle: (item) => {
        const current = get().items;
        const normalizedId = normalizeText(item.id);
        if (normalizedId && current.some((existing) => existing.id === normalizedId)) {
          set({ items: current.filter((existing) => existing.id !== normalizedId) });
          return "removed";
        }
        const result = appendItem(current, item);
        if (result.type === "added") {
          set({ items: result.items });
        }
        return result.type;
      },
      clear: () => set({ items: [] }),
      saveSnapshot: (sourceItems) => {
        const items = sourceItems ?? get().items;
        if (items.length < 2) return;
        const signature = items
          .map((item) => String(item.id))
          .sort((a, b) => a.localeCompare(b))
          .join(":");
        set((state) => {
          if (state.history[0]?.signature === signature) return state;
          const normalizedCategory = getReferenceCategory(items);
          const nextHistory: CompareHistoryEntry = {
            id: createId(),
            createdAt: new Date().toISOString(),
            signature,
            category: normalizedCategory,
            items: items.slice(0, COMPARE_LIMIT).map((item) => ({
              ...item,
              id: normalizeUuid(item.id) ?? item.id,
              category: normalizeCategory(item.category)
            }))
          };
          return {
            history: [nextHistory, ...state.history.filter((entry) => entry.signature !== signature)].slice(0, COMPARE_HISTORY_LIMIT)
          };
        });
      },
      restoreSnapshot: (historyId) => {
        const snapshot = get().history.find((entry) => entry.id === historyId);
        if (!snapshot) return;
        set({
          items: snapshot.items.slice(0, COMPARE_LIMIT).map((item) => ({
            ...item,
            id: normalizeUuid(item.id) ?? item.id,
            addedAt: new Date().toISOString()
          }))
        });
      },
      clearHistory: () => set({ history: [] })
    }),
    {
      name: "compare-store-v1",
      version: 2,
      skipHydration: true,
      migrate: (persistedState) => {
        const state = persistedState as { items?: unknown; history?: unknown } | undefined;
        return {
          items: sanitizeCompareItems(state?.items),
          history: sanitizeCompareHistory(state?.history)
        };
      }
    }
  )
);
