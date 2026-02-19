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
  normalized_title: string;
  attributes: Record<string, string | number | boolean>;
  specs: Record<string, string | number | boolean>;
  status: string;
};

export type ProductOffer = {
  id: number;
  price_amount: number;
  old_price_amount?: number | null;
  in_stock: boolean;
  currency: string;
  scraped_at: string;
  store: { id: number; name: string };
  external_url: string;
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

