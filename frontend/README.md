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
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_ORIGIN=http://localhost:8000
NEXT_PUBLIC_API_PREFIX=/api/v1
NEXT_PUBLIC_SITE_NAME=ZincMarket
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
- Protected routes: `middleware.ts` for `/profile`, `/favorites`, `/recently-viewed`.
- Server state: TanStack Query; UI/local state: Zustand.
- Catalog filters are URL-synced and support dynamic attribute filters from `/filters`.
- PDP injects Product schema.org structured data.

## Main Paths

- `app/(public)` home/catalog/category/product
- `app/(auth)` login/register
- `app/(account)` profile/favorites/recently-viewed

