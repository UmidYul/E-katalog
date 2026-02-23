/* eslint-disable */
// Generated-style OpenAPI types (can be replaced by openapi-typescript output)

export interface paths {
  "/api/v1/search": {
    get: {
      parameters: {
        query?: {
          q?: string;
          category_id?: string;
          brand_id?: string[];
          min_price?: number;
          max_price?: number;
          in_stock?: boolean;
          sort?: "relevance" | "price_asc" | "price_desc" | "popular" | "newest";
          limit?: number;
          cursor?: string;
        };
      };
      responses: {
        200: {
          content: {
            "application/json": {
              items: Array<Record<string, unknown>>;
              next_cursor?: string | null;
              request_id: string;
            };
          };
        };
      };
    };
  };
  "/api/v1/products": {
    get: {
      parameters: {
        query?: {
          category_id?: string;
          brand_id?: string[];
          min_price?: number;
          max_price?: number;
          in_stock?: boolean;
          sort?: "relevance" | "price_asc" | "price_desc" | "popular" | "newest";
          limit?: number;
          cursor?: string;
        };
      };
      responses: { 200: { content: { "application/json": unknown } } };
    };
  };
  "/api/v1/products/{product_id}": {
    get: {
      parameters: { path: { product_id: string } };
      responses: { 200: { content: { "application/json": Record<string, unknown> } } };
    };
  };
}

export type HttpMethod = "get" | "post" | "put" | "delete" | "patch";

