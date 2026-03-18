import { formatSpecLabel, normalizeSpecsMap } from "@/lib/utils/specs";

const UUID_PREFIX_PATTERN =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})(?:-|$)/;

const PAYMENT_ICON_MAP: Array<{ match: RegExp; key: "card" | "cash" | "installment" }> = [
  { match: /(installment|muddatli|рассроч)/i, key: "installment" },
  { match: /(cash|naqd|налич)/i, key: "cash" },
  { match: /(card|uzcard|humo|visa|mastercard|карта)/i, key: "card" },
];

const normalizeImage = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (/^https?:\/\//i.test(normalized) || normalized.startsWith("/")) return normalized;
  return null;
};

const uniqueStrings = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const extractPaymentMethods = (offer: ProductApiOffer): Array<"card" | "cash" | "installment"> => {
  const source = [
    String(offer.payment_options ?? ""),
    String(offer.link ?? ""),
    String(offer.seller_name ?? ""),
  ].join(" ");

  const result: Array<"card" | "cash" | "installment"> = [];
  for (const option of PAYMENT_ICON_MAP) {
    if (option.match.test(source)) result.push(option.key);
  }
  return result.length ? result : ["card", "cash"];
};

const toNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
};

const buildVariantGroups = (specs: Record<string, string>) => {
  const storage = specs.storage_gb ? [specs.storage_gb] : [];
  const color = specs.color ? [specs.color] : [];
  const groups: ProductVariantGroup[] = [];
  if (storage.length) groups.push({ key: "storage", label: "Хотира", values: storage });
  if (color.length) groups.push({ key: "color", label: "Ранг", values: color });
  return groups;
};

export type ProductApiOffer = {
  id: string;
  seller_id?: string | null;
  seller_name: string;
  price_amount: number;
  old_price_amount?: number | null;
  in_stock: boolean;
  currency: string;
  delivery_days?: number | null;
  scraped_at: string;
  link: string;
  payment_options?: string | null;
};

export type ProductApiOffersByStore = {
  store_id: string;
  store: string;
  minimal_price: number;
  offers_count: number;
  offers: ProductApiOffer[];
};

export type ProductApiResponse = {
  id: string;
  title: string;
  category: string;
  brand?: string | null;
  main_image?: string | null;
  gallery_images?: string[];
  short_description?: string | null;
  specs?: Record<string, string | number | boolean>;
  offers_by_store?: ProductApiOffersByStore[];
};

export type ProductPriceHistoryPoint = {
  date: string;
  price: number;
  shopId: string;
  shopName: string;
};

export type ProductReviewItem = {
  id: string;
  author: string;
  rating: number;
  comment: string;
  helpful_votes?: number;
  not_helpful_votes?: number;
  created_at: string;
};

export type ProductOfferView = {
  id: string;
  shopId: string;
  shopName: string;
  shopLogo?: string | null;
  price: number;
  oldPrice: number | null;
  inStock: boolean;
  deliveryDays: number | null;
  deliveryMethod: string;
  paymentMethods: Array<"card" | "cash" | "installment">;
  url: string;
  updatedAt: string;
};

export type ProductKeySpec = {
  key: string;
  label: string;
  value: string;
};

export type ProductVariantGroup = {
  key: "storage" | "color";
  label: string;
  values: string[];
};

export type SimilarProductItem = {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  minPrice: number;
  shopCount: number;
};

export type ProductPageData = {
  id: string;
  slug: string;
  name: string;
  category: string;
  brand: string;
  description: string;
  images: string[];
  minPrice: number;
  oldPrice: number | null;
  priceDrop: number;
  offerCount: number;
  minDelivery: number;
  lastUpdated: string | null;
  rating: number;
  reviewCount: number;
  isNew: boolean;
  offers: ProductOfferView[];
  specs: Record<string, string>;
  keySpecs: ProductKeySpec[];
  variants: ProductVariantGroup[];
  similar: SimilarProductItem[];
};

export const extractProductRefFromSlug = (slug: string) => {
  const match = String(slug ?? "").match(UUID_PREFIX_PATTERN);
  return match?.[1]?.toLowerCase() ?? null;
};

export const buildProductSlug = (id: string, name: string) => {
  const suffix = String(name ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, "")
    .trim()
    .replace(/\s+/g, "-");
  return suffix ? `${id}-${suffix}` : id;
};

export const mapProductApiToPageData = (
  product: ProductApiResponse,
  options?: {
    slug?: string;
    reviews?: ProductReviewItem[];
    similar?: SimilarProductItem[];
  },
): ProductPageData => {
  const grouped = product.offers_by_store ?? [];
  const offers: ProductOfferView[] = grouped
    .flatMap((group) =>
      (group.offers ?? []).map((offer) => ({
        id: String(offer.id),
        shopId: String(offer.seller_id ?? group.store_id),
        shopName: String(group.store || offer.seller_name || "Дўкон"),
        shopLogo: null,
        price: Number(offer.price_amount ?? group.minimal_price ?? 0),
        oldPrice: toNumber(offer.old_price_amount),
        inStock: Boolean(offer.in_stock),
        deliveryDays: toNumber(offer.delivery_days),
        deliveryMethod: toNumber(offer.delivery_days) === 0 ? "Бугун" : "Курьер",
        paymentMethods: extractPaymentMethods(offer),
        url: String(offer.link ?? ""),
        updatedAt: String(offer.scraped_at ?? ""),
      })),
    )
    .filter((offer) => offer.price > 0)
    .sort((left, right) => left.price - right.price);

  const minPrice = offers[0]?.price ?? 0;
  const oldPriceCandidate = offers
    .map((offer) => offer.oldPrice)
    .filter((value): value is number => Number.isFinite(value as number) && (value as number) > 0)
    .sort((left, right) => right - left)[0];
  const oldPrice = oldPriceCandidate && oldPriceCandidate > minPrice ? oldPriceCandidate : null;
  const priceDrop = oldPrice ? Math.max(1, Math.round(((oldPrice - minPrice) / oldPrice) * 100)) : 0;

  const images = uniqueStrings([...(product.gallery_images ?? []), product.main_image]).map((image) => normalizeImage(image)).filter((image): image is string => Boolean(image));
  const normalizedSpecs = normalizeSpecsMap(product.specs ?? {});
  const keySpecs = Object.entries(normalizedSpecs)
    .slice(0, 6)
    .map(([key, value]) => ({
      key,
      value,
      label: formatSpecLabel(key, "uz-Cyrl-UZ"),
    }));

  const reviews = options?.reviews ?? [];
  const reviewCount = reviews.length;
  const rating = reviewCount
    ? Number((reviews.reduce((acc, item) => acc + Number(item.rating || 0), 0) / reviewCount).toFixed(1))
    : 0;

  const lastUpdated = offers
    .map((offer) => offer.updatedAt)
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;

  const minDelivery = offers
    .map((offer) => offer.deliveryDays)
    .filter((value): value is number => Number.isFinite(value as number))
    .sort((left, right) => left - right)[0] ?? 1;

  const slug = options?.slug ?? buildProductSlug(product.id, product.title);

  return {
    id: String(product.id),
    slug,
    name: String(product.title ?? "Товар"),
    category: String(product.category ?? "Категория"),
    brand: String(product.brand ?? "Бренд"),
    description: String(product.short_description ?? `${product.title} учун таклифлар ва нархлар.`),
    images,
    minPrice,
    oldPrice,
    priceDrop,
    offerCount: grouped.length || offers.length,
    minDelivery,
    lastUpdated,
    rating,
    reviewCount,
    isNew: false,
    offers,
    specs: normalizedSpecs,
    keySpecs,
    variants: buildVariantGroups(normalizedSpecs),
    similar: options?.similar ?? [],
  };
};
