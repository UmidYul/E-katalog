import { z } from "zod";

export const categorySchema = z.object({
  name: z.string().min(2, "Name is required"),
  slug: z.string().min(2, "Slug is required"),
  parent_id: z.string().uuid().nullable().optional(),
});

export const settingsSchema = z.object({
  site_name: z.string().min(2),
  support_email: z.string().email(),
  branding_logo_url: z.string().url().nullable().optional(),
  feature_ai_enabled: z.boolean(),
});

export const adminStoreSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).optional(),
  provider: z.string().min(2).default("generic"),
  base_url: z.string().url().nullable().optional(),
  country_code: z.string().length(2).default("UZ"),
  trust_score: z.number().min(0).max(1).default(0.8),
  crawl_priority: z.number().int().min(1).max(10000).default(100),
  is_active: z.boolean().default(true),
});

export const scrapeSourceSchema = z.object({
  url: z.string().url(),
  source_type: z.string().min(2).default("category"),
  priority: z.number().int().min(1).max(10000).default(100),
  is_active: z.boolean().default(true),
});

export type CategoryFormValues = z.infer<typeof categorySchema>;
export type SettingsFormValues = z.infer<typeof settingsSchema>;
export type AdminStoreFormValues = z.infer<typeof adminStoreSchema>;
export type ScrapeSourceFormValues = z.infer<typeof scrapeSourceSchema>;
