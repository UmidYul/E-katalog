export type SortOption =
  | "relevance"
  | "price_asc"
  | "price_desc"
  | "popular"
  | "newest"
  | "price_drop_7d"
  | "discount"
  | "shop_count";

export type BrandListItem = {
  id: string;
  name: string;
  products_count?: number;
};

export type ProductListItem = {
  id: string;
  normalized_title: string;
  image_url?: string;
  min_price?: number | null;
  max_price?: number | null;
  store_count: number;
  in_stock?: boolean;
  score?: number;
  brand?: { id: string; name: string } | null;
  category?: { id: string; name: string } | null;
  is_new?: boolean;
  discount_pct?: number;
  price_drop_pct?: number;
};

export type ProductDetail = {
  id: string;
  title: string;
  category: string;
  brand?: string | null;
  main_image?: string | null;
  gallery_images?: string[];
  short_description?: string | null;
  whats_new?: string[];
  specs: Record<string, string | number | boolean>;
  offers_by_store: OffersByStore[];
};

export type ProductOffer = {
  id: string;
  seller_id?: string | null;
  seller_name: string;
  price_amount: number;
  old_price_amount?: number | null;
  in_stock: boolean;
  currency: string;
  delivery_days?: number | null;
  scraped_at: string;
  trust_score?: number | null;
  trust_freshness?: number | null;
  trust_seller_rating?: number | null;
  trust_price_anomaly?: number | null;
  trust_stock_consistency?: number | null;
  trust_band?: "high" | "medium" | "low" | string | null;
  best_value_score?: number | null;
  link: string;
};

export type OffersByStore = {
  store_id: string;
  store: string;
  minimal_price: number;
  offers_count: number;
  offers: ProductOffer[];
};

export type PriceHistoryPoint = {
  date: string;
  min_price?: number | null;
  max_price?: number | null;
};

export type Paginated<T> = {
  items: T[];
  total: number;
  next_cursor?: string | null;
  request_id: string;
};

export type FilterBucket = {
  key: string;
  label: string;
  values: Array<{ value: string; label: string; count?: number }>;
};

export type CompareMatrixItem = {
  id: string;
  normalized_title: string;
  main_image?: string | null;
  attributes?: Record<string, string | number | boolean | null>;
  specs: Record<string, string | number | boolean | null>;
};

export type CompareMatrixResponse = {
  items: CompareMatrixItem[];
  request_id: string;
};

export type CompareShareCreateResponse = {
  token: string;
  product_ids: string[];
  share_path: string;
  expires_at: string;
  request_id: string;
};

export type CompareShareResolveResponse = {
  product_ids: string[];
  expires_at: string;
  request_id: string;
};

export type ProductReview = {
  id: string;
  product_id: string;
  author: string;
  rating: number;
  comment: string;
  pros?: string | null;
  cons?: string | null;
  is_verified_purchase?: boolean;
  helpful_votes?: number;
  not_helpful_votes?: number;
  status: "published" | "pending" | "rejected" | string;
  created_at: string;
  updated_at: string;
  moderated_by?: string | null;
  moderated_at?: string | null;
};

export type ProductAnswer = {
  id: string;
  question_id: string;
  product_id: string;
  author: string;
  text: string;
  status: "published" | "pending" | "rejected" | string;
  is_official?: boolean;
  is_pinned?: boolean;
  pinned_at?: string | null;
  pinned_by?: string | null;
  created_at: string;
  updated_at: string;
  moderated_by?: string | null;
  moderated_at?: string | null;
};

export type ProductQuestion = {
  id: string;
  product_id: string;
  author: string;
  question: string;
  status: "published" | "pending" | "rejected" | string;
  created_at: string;
  updated_at: string;
  moderated_by?: string | null;
  moderated_at?: string | null;
  answers: ProductAnswer[];
};

export type WatchlistFilter = "all" | "drop" | "target_hit";

export type PriceAlertMeta = {
  product_id: string;
  alerts_enabled: boolean;
  baseline_price: number | null;
  target_price: number | null;
  last_seen_price: number | null;
  last_notified_at: string | null;
  updated_at: string;
};

export type PriceAlertSignal = {
  product_id: string;
  current_price: number | null;
  baseline_price: number | null;
  target_price: number | null;
  drop_amount: number;
  drop_pct: number;
  is_drop: boolean;
  is_target_hit: boolean;
};

