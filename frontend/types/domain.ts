export type SortOption = "relevance" | "price_asc" | "price_desc" | "popular" | "newest" | "price_drop_7d";

export type ProductListItem = {
  id: number;
  normalized_title: string;
  image_url?: string;
  min_price?: number | null;
  max_price?: number | null;
  store_count: number;
  in_stock?: boolean;
  score?: number;
  brand?: { id: number; name: string } | null;
  category?: { id: number; name: string } | null;
};

export type ProductDetail = {
  id: number;
  title: string;
  category: string;
  brand?: string | null;
  main_image?: string | null;
  specs: Record<string, string | number | boolean>;
  offers_by_store: OffersByStore[];
};

export type ProductOffer = {
  id: number;
  seller_id?: number | null;
  seller_name: string;
  price_amount: number;
  old_price_amount?: number | null;
  in_stock: boolean;
  currency: string;
  delivery_days?: number | null;
  scraped_at: string;
  link: string;
};

export type OffersByStore = {
  store_id: number;
  store: string;
  minimal_price: number;
  offers_count: number;
  offers: ProductOffer[];
};

export type Paginated<T> = {
  items: T[];
  next_cursor?: string | null;
  request_id: string;
};

export type FilterBucket = {
  key: string;
  label: string;
  values: Array<{ value: string; label: string; count?: number }>;
};

