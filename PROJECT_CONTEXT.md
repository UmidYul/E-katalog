# E-katalog: стек, контекст, функционал, страницы

## 1) Контекст продукта
E-katalog - платформа-агрегатор цен на электронику с каноническим каталогом товаров и офферами от разных магазинов/продавцов.
В продукте есть несколько зон: публичная витрина, аккаунт пользователя, кабинеты продавцов, B2B-направление и админ-панель.

## 2) Технический стек (кратко)
- Frontend: Next.js 14 (App Router), React 18, TypeScript, TailwindCSS, TanStack Query, Zustand, React Hook Form + Zod.
- Backend API: FastAPI, SQLAlchemy, Pydantic, PostgreSQL (+ pgvector), Redis.
- Асинхронные пайплайны: Celery workers + beat, сервис парсинга (Playwright/selectolax), задачи нормализации/эмбеддингов/реиндексации.
- Инфраструктура: Docker Compose, Nginx reverse proxy, Alembic migrations, observability через Sentry.

## 3) Бизнес-функционал (кратко)
- Каталог и поиск: главная, каталог, категории, карточка товара, поиск, фильтры, сравнение товаров.
- Модель предложений: одна каноническая карточка товара + сгруппированные офферы по магазинам/продавцам.
- Пользовательская часть: регистрация/логин, профиль, избранное, недавно просмотренные.
- Продавцы: онбординг, управление товарами и фидами, кампании, биллинг, поддержка, инвентарь/модерация.
- B2B: партнерский intake/status, онбординг, фиды, кампании, биллинг, support/analytics-интеграции.
- Админка: управление пользователями/товарами/заказами/категориями, аналитика, обратная связь, управление продавцами и B2B, запуск фоновых операций (scrape/embeddings/dedupe/reindex).

## 4) Страницы

### Public
- `/`
- `/catalog`
- `/category/[slug]`
- `/product/[slug]`
- `/compare`
- `/contacts`
- `/for-shops`
- `/become-seller`
- `/become-seller/pending`
- `/become-seller/rejected`
- `/status`
- `/privacy`
- `/terms`
- `/cookies`
- `/403`

### Auth
- `/login`
- `/register`

### Account
- `/profile`
- `/favorites`
- `/recently-viewed`

### Admin dashboard
- `/dashboard/admin`
- `/dashboard/admin/users`
- `/dashboard/admin/users/[id]`
- `/dashboard/admin/products`
- `/dashboard/admin/products/[id]`
- `/dashboard/admin/categories`
- `/dashboard/admin/orders`
- `/dashboard/admin/orders/[id]`
- `/dashboard/admin/analytics`
- `/dashboard/admin/feedback`
- `/dashboard/admin/settings`
- `/dashboard/admin/sellers`

### Seller dashboard
- `/dashboard/seller`
- `/dashboard/seller/products`
- `/dashboard/seller/products/new`
- `/dashboard/seller/products/[id]`
- `/dashboard/seller/inventory`
- `/dashboard/seller/feeds`
- `/dashboard/seller/campaigns`
- `/dashboard/seller/billing`
- `/dashboard/seller/support`
- `/dashboard/seller/onboarding`
