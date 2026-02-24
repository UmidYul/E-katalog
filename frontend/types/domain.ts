export type SortOption = "relevance" | "price_asc" | "price_desc" | "popular" | "newest" | "price_drop_7d";

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

export type ProductReview = {
  id: string;
  product_id: string;
  author: string;
  rating: number;
  comment: string;
  pros?: string | null;
  cons?: string | null;
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

