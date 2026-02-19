# Frontend (Next.js 14)

Startup-grade marketplace frontend for the price aggregation backend.

## Stack

- Next.js 14 (App Router)
- TypeScript strict
- TailwindCSS
- shadcn/ui-style primitives
- TanStack Query
- Zustand
- React Hook Form + Zod
- Axios + interceptors
- OpenAPI typed client foundation

## Quick Start

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

App runs on `http://localhost:3000`.

## Environment

```env
NEXT_PUBLIC_APP_URL=http://localhost
NEXT_PUBLIC_API_ORIGIN=
NEXT_PUBLIC_API_PREFIX=/api/v1
NEXT_PUBLIC_SITE_NAME=ZincMarket
API_INTERNAL_ORIGIN=http://api:8000
```

## API Types

Generate OpenAPI types directly from backend:

```bash
npm run openapi:generate
```

This writes to `lib/api/openapi.ts`.

## Production Build

```bash
npm run typecheck
npm run lint
npm run build
npm run start
```

## Architecture Notes

- Auth strategy: cookie-based JWT (no localStorage token), refresh flow in `lib/api/interceptors.ts`.
- Backend auth endpoints used by frontend: `/api/v1/auth/{register,login,refresh,logout,me}`.
- Favorites endpoints used by frontend: `/api/v1/users/favorites`.
- Protected routes: `middleware.ts` for `/profile`, `/favorites`, `/recently-viewed`, `/dashboard`.
- Server state: TanStack Query; UI/local state: Zustand.
- Catalog filters are URL-synced and support dynamic attribute filters from `/filters`.
- PDP injects Product schema.org structured data.
- Admin panel uses the same UI Kit primitives from `components/ui`.
- Admin background operations are integrated with backend tasks:
  - `POST /api/v1/admin/scrape/run`
  - `POST /api/v1/admin/embeddings/rebuild`
  - `POST /api/v1/admin/dedupe/run`
  - `POST /api/v1/admin/reindex/products`

## Main Paths

- `app/(public)` home/catalog/category/product
- `app/(auth)` login/register
- `app/(account)` profile/favorites/recently-viewed
- `app/(dashboard)` admin panel:
  - `/dashboard`
  - `/dashboard/users`
  - `/dashboard/products`
  - `/dashboard/categories`
  - `/dashboard/orders`
  - `/dashboard/analytics`
  - `/dashboard/settings`

## Admin UI Kit

Reusable primitives under `components/ui`:

- Buttons, inputs, select, textarea, checkbox, switch, radio-group
- Modal, drawer, tabs, accordion
- Card, badge, table, avatar, tooltip, skeleton

Reusable admin building blocks:

- `components/layout/*` dashboard shell, sidebar, topbar, footer
- `components/tables/admin-table.tsx`
- `components/forms/search-form.tsx`
- `components/charts/mini-bar-chart.tsx`
- `components/modals/confirm-modal.tsx`

