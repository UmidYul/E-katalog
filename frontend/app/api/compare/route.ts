import { NextResponse } from "next/server";

import {
  buildProductSlug,
  mapProductApiToPageData,
  type ProductApiResponse,
} from "@/features/product/product-types";
import { serverGet } from "@/lib/api/server";
import { formatSpecLabel, normalizeSpecKey, normalizeSpecsMap } from "@/lib/utils/specs";

type CompareSection =
  | "price"
  | "display"
  | "performance"
  | "camera"
  | "battery"
  | "memory"
  | "connectivity"
  | "design"
  | "other";

type CompareProductOffer = {
  shopId: string;
  shopName: string;
  price: number;
  deliveryDays: number | null;
  inStock: boolean;
  url: string | null;
};

type CompareProduct = {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  brand: string;
  category: string;
  minPrice: number;
  priceDrop: number;
  offerCount: number;
  offers: CompareProductOffer[];
  bestOfferUrl: string | null;
  specs: Record<string, string>;
};

type CompareSpecValue = {
  raw: string | number | null;
  display: string;
};

type CompareSpec = {
  key: string;
  label: string;
  section: CompareSection;
  unit?: string;
  higherIsBetter: boolean;
  values: Record<string, CompareSpecValue>;
};

const MAX_COMPARE_ITEMS = 4;

const SECTION_PRIORITY: Record<CompareSection, number> = {
  price: 0,
  display: 1,
  performance: 2,
  camera: 3,
  battery: 4,
  memory: 5,
  connectivity: 6,
  design: 7,
  other: 8,
};

const SPEC_ALIASES: Record<string, string> = {
  ram: "memory_ram",
  ozu: "memory_ram",
  оперативная_память: "memory_ram",
  operativnaya_pamyat: "memory_ram",
  ram_gb: "memory_ram",
  storage_gb: "memory_storage",
  display_inches: "display_size",
  refresh_rate_hz: "display_refresh_rate",
  screen_resolution: "display_resolution",
  cpu: "performance_cpu",
  cpu_frequency_mhz: "performance_cpu_frequency",
  gpu: "performance_gpu",
  main_camera_mp: "camera_main",
  front_camera_mp: "camera_front",
  camera_mp: "camera_main",
  battery_mah: "battery_capacity",
  charging_power_w: "battery_charging_power",
  wifi_standard: "connectivity_wifi",
  bluetooth_standard: "connectivity_bluetooth",
  network_standard: "connectivity_network",
  sim_count: "connectivity_sim_count",
  charging_connector: "connectivity_charging_port",
  dimensions_mm: "design_dimensions",
  weight_g: "design_weight",
  color: "design_color",
  os: "other_os",
  price_min: "price_min",
};

const SPEC_META: Record<
  string,
  {
    label: string;
    section: CompareSection;
    unit?: string;
    higherIsBetter: boolean;
  }
> = {
  price_min: { label: "Энг паст нарх", section: "price", higherIsBetter: false },
  memory_ram: { label: "Оператив хотира", section: "memory", unit: "ГБ", higherIsBetter: true },
  memory_storage: { label: "Ички хотира", section: "memory", unit: "ГБ", higherIsBetter: true },
  display_size: { label: "Диагональ", section: "display", unit: "дюйм", higherIsBetter: true },
  display_refresh_rate: { label: "Янгиланиш частотаси", section: "display", unit: "Гц", higherIsBetter: true },
  display_resolution: { label: "Экран аниқлиги", section: "display", higherIsBetter: true },
  performance_cpu: { label: "Процессор", section: "performance", higherIsBetter: true },
  performance_cpu_frequency: {
    label: "Процессор частотаси",
    section: "performance",
    unit: "МГц",
    higherIsBetter: true,
  },
  performance_gpu: { label: "График чип", section: "performance", higherIsBetter: true },
  camera_main: { label: "Асосий камера", section: "camera", unit: "Мп", higherIsBetter: true },
  camera_front: { label: "Олд камера", section: "camera", unit: "Мп", higherIsBetter: true },
  battery_capacity: { label: "Батарея сиғими", section: "battery", unit: "мАч", higherIsBetter: true },
  battery_charging_power: { label: "Заряд қуввати", section: "battery", unit: "Вт", higherIsBetter: true },
  connectivity_wifi: { label: "Wi-Fi", section: "connectivity", higherIsBetter: true },
  connectivity_bluetooth: { label: "Bluetooth", section: "connectivity", higherIsBetter: true },
  connectivity_network: { label: "Алоқа стандарти", section: "connectivity", higherIsBetter: true },
  connectivity_sim_count: { label: "SIM сони", section: "connectivity", higherIsBetter: true },
  connectivity_charging_port: { label: "Қувват порти", section: "connectivity", higherIsBetter: true },
  design_dimensions: { label: "Ўлчамлар", section: "design", higherIsBetter: false },
  design_weight: { label: "Оғирлик", section: "design", unit: "г", higherIsBetter: false },
  design_color: { label: "Ранг", section: "design", higherIsBetter: true },
  other_os: { label: "Операцион тизим", section: "other", higherIsBetter: true },
};

const parseIds = (value: string | null) => {
  if (!value) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of value.split(",")) {
    const id = part.trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= MAX_COMPARE_ITEMS) break;
  }
  return result;
};

const parseNumericValue = (value: string | number | null | undefined): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const inferSection = (key: string): CompareSection => {
  if (key.startsWith("display")) return "display";
  if (key.startsWith("performance") || /cpu|gpu|chip/.test(key)) return "performance";
  if (key.startsWith("camera")) return "camera";
  if (key.startsWith("battery")) return "battery";
  if (key.startsWith("memory") || /ram|storage/.test(key)) return "memory";
  if (key.startsWith("connectivity") || /wifi|network|bluetooth|sim|charging/.test(key)) return "connectivity";
  if (key.startsWith("design") || /weight|dimension|color/.test(key)) return "design";
  if (key.includes("price")) return "price";
  return "other";
};

const inferUnit = (key: string): string | undefined => {
  if (key.includes("gb")) return "ГБ";
  if (key.includes("mah")) return "мАч";
  if (key.includes("hz")) return "Гц";
  if (key.includes("inch") || key.includes("display_size")) return "дюйм";
  if (key.includes("mp")) return "Мп";
  if (key.includes("_w")) return "Вт";
  if (key.includes("weight")) return "г";
  return undefined;
};

const inferHigherIsBetter = (key: string): boolean => !/price|weight|dimension|thickness|latency/.test(key);

const normalizeOfferList = (
  offers: Array<{
    id: string;
    shopId: string;
    shopName: string;
    price: number;
    deliveryDays: number | null;
    inStock: boolean;
    url: string;
  }>,
): CompareProductOffer[] => {
  const grouped = new Map<string, CompareProductOffer>();
  for (const offer of offers) {
    if (!offer.shopId || !Number.isFinite(offer.price) || offer.price <= 0) continue;
    const existing = grouped.get(offer.shopId);
    if (!existing || offer.price < existing.price) {
      grouped.set(offer.shopId, {
        shopId: offer.shopId,
        shopName: offer.shopName,
        price: Math.round(offer.price),
        deliveryDays: offer.deliveryDays ?? null,
        inStock: offer.inStock,
        url: offer.url || null,
      });
    }
  }
  return Array.from(grouped.values()).sort((left, right) => left.price - right.price);
};

const loadCompareProduct = async (id: string): Promise<CompareProduct | null> => {
  try {
    const product = await serverGet<ProductApiResponse>(`/products/${id}`);
    const mapped = mapProductApiToPageData(product, {
      slug: buildProductSlug(id, product.title ?? ""),
      reviews: [],
      similar: [],
    });

    const offers = normalizeOfferList(
      mapped.offers.map((offer) => ({
        id: offer.id,
        shopId: offer.shopId,
        shopName: offer.shopName,
        price: offer.price,
        deliveryDays: offer.deliveryDays,
        inStock: offer.inStock,
        url: offer.url,
      })),
    );

    return {
      id: mapped.id,
      slug: mapped.slug,
      name: mapped.name,
      image: mapped.images[0] ?? null,
      brand: mapped.brand,
      category: mapped.category,
      minPrice: mapped.minPrice,
      priceDrop: mapped.priceDrop,
      offerCount: offers.length || mapped.offerCount,
      offers,
      bestOfferUrl: offers[0]?.url ?? null,
      specs: normalizeSpecsMap(mapped.specs),
    };
  } catch {
    return null;
  }
};

const buildSpecs = (products: CompareProduct[]): CompareSpec[] => {
  const productIds = products.map((item) => item.id);
  const bucket = new Map<string, CompareSpec>();
  const priceMetaLabel = SPEC_META.price_min?.label ?? "Энг паст нарх";

  for (const product of products) {
    const priceValue = product.minPrice > 0 ? product.minPrice : null;
    if (!bucket.has("price_min")) {
      bucket.set("price_min", {
        key: "price_min",
        label: priceMetaLabel,
        section: "price",
        higherIsBetter: false,
        values: {},
      });
    }

    const priceSpec = bucket.get("price_min");
    if (priceSpec) {
      priceSpec.values[product.id] = {
        raw: priceValue,
        display: priceValue != null ? String(priceValue) : "—",
      };
    }

    for (const [rawKey, rawValue] of Object.entries(product.specs)) {
      const normalizedKey = normalizeSpecKey(rawKey);
      if (!normalizedKey) continue;

      const key = SPEC_ALIASES[normalizedKey] ?? normalizedKey;
      const meta = SPEC_META[key];

      if (!bucket.has(key)) {
        bucket.set(key, {
          key,
          label: meta?.label ?? formatSpecLabel(normalizedKey, "uz-Cyrl-UZ"),
          section: meta?.section ?? inferSection(key),
          unit: meta?.unit ?? inferUnit(key),
          higherIsBetter: meta?.higherIsBetter ?? inferHigherIsBetter(key),
          values: {},
        });
      }

      const spec = bucket.get(key);
      if (!spec) continue;

      const numeric = parseNumericValue(rawValue);
      spec.values[product.id] = {
        raw: numeric ?? rawValue,
        display: String(rawValue ?? "—"),
      };
    }
  }

  for (const spec of bucket.values()) {
    for (const productId of productIds) {
      if (!spec.values[productId]) {
        spec.values[productId] = { raw: null, display: "—" };
      }
    }
  }

  return Array.from(bucket.values()).sort((left, right) => {
    const leftPriority = SECTION_PRIORITY[left.section];
    const rightPriority = SECTION_PRIORITY[right.section];
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.label.localeCompare(right.label, "uz-Cyrl");
  });
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ids = parseIds(url.searchParams.get("ids"));
  if (!ids.length) {
    return NextResponse.json({ products: [], specs: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const loaded = await Promise.all(ids.map((id) => loadCompareProduct(id)));
  const products = loaded.filter((item): item is CompareProduct => Boolean(item));
  const specs = buildSpecs(products);

  return NextResponse.json(
    {
      products,
      specs,
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
