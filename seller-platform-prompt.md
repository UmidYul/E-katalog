# ПРОМТ: Фича "Локальные продавцы" — добавление к существующему проекту

---

## 🧠 Инструкция по мышлению

Перед тем как писать ЛЮБОЙ код:

1. Прочитай весь промт целиком — не начинай с первого раздела пока не дочитал до конца.
2. Составь список всех мест где нужно трогать существующий код (роутинг, auth middleware, sidebar nav, БД) — это точки интеграции, их нельзя пропустить.
3. Для каждой части сначала напиши план в комментариях, потом код.
4. Думай как senior engineer который добавляет фичу в живой проект: минимальный footprint, никаких breaking changes, обратная совместимость.
5. Если видишь конфликт с существующей архитектурой — опиши проблему и предложи решение с trade-offs.
6. Не пропускай edge cases — они описаны в конце промта и критичны для бизнес-логики.

---

## 📦 Контекст: что уже есть

Проект — агрегатор товаров (аналог e-katalog) для рынка Узбекистана (UZS, +998).

**Стек:**
- Frontend: Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Radix UI, TanStack Query v5, Zustand, React Hook Form + Zod, Recharts, Framer Motion
- Backend: Python 3.11, FastAPI, SQLAlchemy 2 (async), Alembic, Pydantic v2, Uvicorn, orjson
- Очереди: Celery + Redis
- Парсинг: Playwright, selectolax, httpx, tenacity
- БД: PostgreSQL 16 + pgvector
- Инфра: Docker Compose, Nginx, Sentry
- Тесты: pytest, node --test + ESLint + tsc

**Что уже реализовано:**
- Аутентификация (JWT, таблица users, роли)
- Парсинг открытых магазинов
- Публичный каталог товаров
- Переход на сайт продавца по кнопке (текущий способ монетизации)

**Текущая структура `/dashboard` (admin):**
- Hub — KPI, графики, алерты, быстрый запуск фоновых задач
- Пользователи — поиск, карточка, смена роли/статуса, удаление
- Товары — список, карточка, удаление, импорт/экспорт, пересборка каталога
- Категории — просмотр и создание
- Заказы — фильтр, просмотр, смена статуса
- Модерация — очередь отзывов/вопросов, публикация/отклонение
- Analytics 360 — срезы по revenue, quality, operations, moderation, users + алерты
- B2B Control — **ПОЛНОСТЬЮ УДАЛИТЬ и заменить** (описано ниже)
- Settings — платформенные настройки, управление магазинами и ссылками скрейпинга

---

## 🎯 Что нужно сделать (scope фичи)

### Задача 1: Переезд админки
Текущий `/dashboard` → переехать на `/dashboard/admin`.
- Добавить redirect: `GET /dashboard` → `302 /dashboard/admin`
- Обновить все внутренние ссылки, middleware, хлебные крошки
- Sidebar, layout, все роуты — просто сменить prefix, логику не трогать

### Задача 2: Логика авторизации и ролей
В существующую систему auth добавить роль `seller`.
- При логине редирект по роли: `admin` → `/dashboard/admin`, `seller` → `/dashboard/seller`, остальные → `/`
- Middleware: `/dashboard/admin/*` — только role=admin, `/dashboard/seller/*` — только role=seller
- Если seller пытается зайти на `/dashboard/admin` → 403, и наоборот

### Задача 3: Удалить старый B2B Control, добавить новый раздел Sellers в админку
В сайдбар `/dashboard/admin` вместо "B2B Control" добавить раздел **"Продавцы"** с подразделами:
- Заявки
- Магазины
- Модерация товаров
- Финансы продавцов
- Тарифы

### Задача 4: Новый `/dashboard/seller`
Полностью новый раздел для продавцов-партнёров.

### Задача 5: Форма заявки `/become-seller`
Публичная страница, доступна без авторизации.

---

## 🗄 ЧАСТЬ 1: Изменения в БД

Все изменения — новые таблицы/колонки через Alembic миграции. Существующие таблицы не ломать.

### Добавить в таблицу `users`
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR DEFAULT 'user';
-- если роль уже есть как enum — добавить значение 'seller'
```

### Новые таблицы

**`seller_applications`** — заявки до одобрения
```
id (UUID PK)
user_id (FK → users, nullable — заявку можно подать до регистрации)
status: enum('pending', 'reviewing', 'approved', 'rejected', 'info_requested')
shop_name, legal_type: enum('individual', 'llc', 'other')
inn VARCHAR(14)  -- СТИР: 9 цифр физ/ИП, 14 для ООО
legal_address, actual_address
contact_phone VARCHAR(13)  -- +998XXXXXXXXX
contact_email
has_website BOOLEAN
website_url (nullable)
work_type: enum('online', 'offline', 'both')
delivery_available BOOLEAN
pickup_available BOOLEAN
product_categories JSONB  -- ['electronics', 'clothing', ...]
documents JSONB           -- [{url, name, type}]
admin_comment (nullable)
reviewed_by (FK → users, nullable)
reviewed_at (nullable)
created_at, updated_at
```
Индексы: `(status, created_at)`, `(inn)` unique partial where status='approved'

**`shops`** — одобренные продавцы
```
id (UUID PK)
user_id (FK → users, unique)
application_id (FK → seller_applications)
slug VARCHAR unique          -- для URL /shops/my-shop
shop_name, description (text)
logo_url, banner_url (nullable)
status: enum('active', 'paused', 'banned', 'suspended')
has_website BOOLEAN
website_url (nullable)
work_type: enum('online', 'offline', 'both')
delivery_available, pickup_available BOOLEAN
address, city (nullable)
working_hours JSONB  -- {"mon":{"open":"09:00","close":"18:00","closed":false}, ...}
payment_methods JSONB  -- ["cash","card_on_delivery","click","payme","uzcard"]
delivery_zones JSONB   -- [{name, price_uzs, min_order_uzs, days}]
pickup_address (nullable)
balance DECIMAL(14,2) DEFAULT 0
balance_hold DECIMAL(14,2) DEFAULT 0
min_balance_threshold DECIMAL(14,2) DEFAULT 10000
is_auto_paused BOOLEAN DEFAULT false
daily_budget_limit DECIMAL(14,2) nullable
daily_budget_spent DECIMAL(14,2) DEFAULT 0
daily_budget_reset_at TIMESTAMP
created_at, updated_at
```
Индексы: `(status)`, `(user_id)` unique, `(slug)` unique

**`shop_products`** — товары продавцов (отдельно от спарсенных товаров платформы!)
```
id (UUID PK)
shop_id (FK → shops)
source: enum('manual', 'feed_import', 'api')
title, description (text, nullable)
category_id (FK → categories, nullable)
images JSONB  -- [{url, order, is_main}]
price DECIMAL(14,2)
old_price DECIMAL(14,2, nullable)
sku, barcode (nullable)
status: enum('draft','pending_moderation','active','rejected','archived')
moderation_comment (nullable)
track_inventory BOOLEAN DEFAULT true
stock_quantity INT DEFAULT 0
stock_reserved INT DEFAULT 0
stock_alert_threshold INT nullable
attributes JSONB nullable
views_count INT DEFAULT 0
clicks_count INT DEFAULT 0
created_at, updated_at
```
Индексы: `(shop_id, status)`, `(category_id)`, GIN на `title` для full-text search

**`shop_inventory_log`** — история изменений остатков
```
id BIGSERIAL PK
product_id (FK → shop_products)
shop_id (FK → shops)
action: enum('manual_update','order_reserved','order_released','order_completed','order_cancelled','import','api_update')
quantity_before, quantity_after, delta INT
reference_id UUID nullable  -- order_id если связано
comment (nullable)
created_by (FK → users, nullable)
created_at
```

**`shop_orders`** — заказы через платформу (для продавцов без сайта)
```
id (UUID PK)
order_number VARCHAR unique  -- ORD-2024-000001 (генерируется)
shop_id (FK → shops)
buyer_user_id (FK → users, nullable)
buyer_session_id (nullable)
status: enum('new','confirmed','preparing','ready_for_pickup','in_delivery','delivered','completed','cancelled')
order_type: enum('delivery','pickup')
buyer_name, buyer_phone VARCHAR(13), buyer_email (nullable)
delivery_address JSONB  -- {city, street, house, apt, comment}
delivery_price DECIMAL(14,2) DEFAULT 0
items_total DECIMAL(14,2)
total DECIMAL(14,2)
payment_method: enum('cash','card_on_delivery','click','payme','uzcard')
payment_status: enum('pending','paid','refunded')
seller_comment, buyer_comment (nullable)
cancellation_reason (nullable)
cancelled_by: enum('seller','buyer','admin') nullable
confirmed_at, delivered_at, completed_at, cancelled_at (nullable)
created_at, updated_at
```

**`shop_order_items`**
```
id UUID PK
order_id (FK → shop_orders)
product_id (FK → shop_products)
quantity INT
price_at_order DECIMAL(14,2)   -- снепшот цены на момент заказа
product_snapshot JSONB          -- {title, sku, image_url}
```

**`shop_leads`** — быстрые лиды (без полного заказа)
```
id UUID PK
shop_id (FK → shops)
product_id (FK → shop_products, nullable)
lead_type: enum('quick_form','whatsapp','telegram','phone_reveal')
buyer_name, buyer_phone, buyer_message (nullable)
status: enum('new','contacted','converted','ignored')
created_at
```

**`shop_clicks`** — события для биллинга
```
id UUID PK
shop_id (FK → shops)
product_id (FK → shop_products, nullable)
click_type: enum('website_redirect','lead_form','lead_submitted','order_created','phone_reveal')
session_id VARCHAR
ip_hash VARCHAR
charged_amount DECIMAL(14,2) DEFAULT 0
is_charged BOOLEAN DEFAULT false
is_duplicate BOOLEAN DEFAULT false
dedup_key VARCHAR unique  -- {shop_id}:{product_id}:{session_id}:{click_type}:{date}
created_at
```
Индексы: `(shop_id, created_at)`, `(dedup_key)` unique

**`shop_billing_txns`** — история транзакций баланса
```
id UUID PK
shop_id (FK → shops)
type: enum('deposit','click_charge','order_charge','refund','manual_adjustment')
amount DECIMAL(14,2)        -- отрицательное для списаний
balance_before, balance_after DECIMAL(14,2)
reference_id UUID nullable   -- click_id или order_id
description
payment_provider: enum('click','payme','uzcard','bank_transfer','manual') nullable
provider_tx_id VARCHAR nullable  -- для idempotency
created_at
```
Индексы: `(shop_id, created_at)`, `(provider_tx_id)` unique partial where provider_tx_id IS NOT NULL

**`shop_parse_configs`** — конфиги фидов для продавцов с сайтом
```
id UUID PK
shop_id (FK → shops, unique)
feed_url (nullable)
feed_type: enum('yml','xml','csv') nullable
field_mapping JSONB nullable
schedule_hours INT DEFAULT 6
is_active BOOLEAN DEFAULT false
last_run_at, last_success_at (nullable)
last_error TEXT nullable
consecutive_failures INT DEFAULT 0
created_at, updated_at
```

**`shop_api_keys`** — для интеграции с 1С/МойСклад
```
id UUID PK
shop_id (FK → shops)
key_hash VARCHAR unique  -- bcrypt, полный ключ показывается только при создании
name VARCHAR
scopes JSONB  -- ["inventory:write","orders:read"]
last_used_at (nullable)
expires_at (nullable)
is_active BOOLEAN DEFAULT true
created_at
```

**`seller_tariffs`**
```
id UUID PK
name VARCHAR
is_active BOOLEAN DEFAULT true
is_default BOOLEAN DEFAULT false
click_prices JSONB  -- {"electronics":500,"clothing":300,"default":200} (тийин UZS)
lead_price DECIMAL(14,2)
order_price DECIMAL(14,2)
min_deposit DECIMAL(14,2)
created_at
```

**`shop_tariff_assignments`**
```
shop_id (FK → shops, PK)
tariff_id (FK → seller_tariffs)
assigned_at TIMESTAMP
assigned_by (FK → users)
```

---

## 🔌 ЧАСТЬ 2: Backend API (FastAPI)

### Структура новых файлов (добавить к существующему `app/api/v1/`)

```
app/api/v1/
├── seller/                  ← всё новое
│   ├── __init__.py
│   ├── dashboard.py
│   ├── products.py
│   ├── inventory.py
│   ├── orders.py
│   ├── leads.py
│   ├── billing.py
│   ├── analytics.py
│   ├── settings.py
│   ├── parse_config.py
│   └── api_keys.py
├── admin/
│   └── sellers.py           ← новый файл в существующий admin роутер
├── public/
│   ├── shop_orders.py       ← новый: публичный checkout
│   └── shop_leads.py        ← новый: лид-форма
└── external/
    └── seller_api.py        ← API для интеграций продавцов (по API-ключу)

app/services/                ← новые сервисы
├── shop_billing_service.py
├── shop_inventory_service.py
├── shop_click_service.py
└── shop_order_service.py

app/tasks/                   ← добавить в существующий Celery
├── seller_parse_tasks.py
├── seller_billing_tasks.py
└── seller_notification_tasks.py
```

### Зависимости (FastAPI deps) — добавить к существующим
```python
# app/core/deps.py — добавить:
async def get_current_seller(current_user = Depends(get_current_user), db = Depends(get_db)):
    """Проверяет что user.role == 'seller' и возвращает его shop"""
    if current_user.role != 'seller':
        raise HTTPException(403, "Seller access required")
    shop = await db.get_shop_by_user_id(current_user.id)
    if not shop:
        raise HTTPException(404, "Shop not found")
    return shop

async def get_current_active_seller(shop = Depends(get_current_seller)):
    """Дополнительно проверяет что магазин не забанен"""
    if shop.status == 'banned':
        raise HTTPException(403, "Shop is banned")
    return shop
```

### Все эндпоинты — реализовать полностью

#### Публичные (без авторизации)
```
POST /api/v1/applications/seller          -- подача заявки
GET  /api/v1/applications/seller/status   -- статус заявки по email+phone (polling)
POST /api/v1/public/shop-orders/          -- оформить заказ покупателем
POST /api/v1/public/shop-leads/           -- быстрая лид-форма
POST /api/v1/public/clicks/track          -- трекинг клика (дедупликация!)
GET  /api/v1/public/shops/{slug}          -- страница магазина
GET  /api/v1/public/shops/{slug}/products -- товары магазина (с фильтром/пагинацией)
```

#### Seller Dashboard (`/api/v1/seller/...`, auth: get_current_active_seller)
```
GET  /dashboard/stats                   -- summary за период (7d/30d/90d)
GET  /dashboard/chart                   -- данные графика кликов по дням
GET  /dashboard/alerts                  -- активные алерты (низкий баланс, низкий остаток, ошибки парсинга)

GET  /products/                         -- список с фильтрами + пагинация
POST /products/                         -- создать товар вручную
PUT  /products/{id}                     -- обновить
DEL  /products/{id}                     -- архивировать (soft delete)
PATCH /products/{id}/stock              -- обновить остаток одного товара
PATCH /products/bulk-stock              -- [{product_id, quantity}] массовое обновление
POST /products/import                   -- импорт Excel/CSV (multipart)
GET  /products/import/template          -- скачать шаблон

GET  /inventory/log                     -- история изменений с фильтром по товару/дате
GET  /inventory/alerts                  -- товары ниже порога stock_alert_threshold

GET  /orders/                           -- список с фильтрами (status, date, payment)
GET  /orders/{id}                       -- детали заказа
PATCH /orders/{id}/status               -- изменить статус (с валидацией переходов)
GET  /orders/{id}/receipt               -- PDF накладная (генерация на лету)

GET  /leads/                            -- список лидов с фильтрами
PATCH /leads/{id}/status                -- обновить статус лида

GET  /billing/balance                   -- текущий баланс, hold, потрачено сегодня
GET  /billing/transactions              -- история транзакций (с пагинацией + фильтр по типу)
POST /billing/deposit                   -- создать ссылку оплаты (Click/Payme)
PUT  /billing/settings                  -- настройки: min_balance_threshold, daily_budget_limit

GET  /analytics/clicks                  -- клики по дням и по товарам
GET  /analytics/top-products            -- топ по кликам и конверсии
GET  /analytics/funnel                  -- показы → клики → лиды → заказы

GET  /shop/                             -- настройки магазина
PUT  /shop/                             -- обновить настройки
POST /shop/logo                         -- загрузить логотип (multipart)
POST /shop/banner                       -- загрузить баннер

GET  /parse-config/                     -- текущий конфиг парсинга
PUT  /parse-config/                     -- обновить конфиг
POST /parse-config/test                 -- тест: вернуть первые 5 товаров без сохранения
POST /parse-config/sync                 -- запустить синхронизацию вручную
GET  /parse-config/log                  -- лог последних 20 запусков

GET  /api-keys/                         -- список ключей
POST /api-keys/                         -- создать (возвращает полный ключ ОДИН РАЗ)
DELETE /api-keys/{id}                   -- отозвать
```

#### Admin — Sellers (`/api/v1/admin/sellers/...`, auth: admin only)
```
GET  /applications/                     -- список заявок (фильтр по статусу)
GET  /applications/{id}                 -- детали + документы
PATCH /applications/{id}/status         -- approve / reject / request_info (с обязательным comment при reject)

GET  /shops/                            -- все магазины (поиск, фильтр, пагинация)
GET  /shops/{id}                        -- детали магазина + статистика
PATCH /shops/{id}/status                -- active / paused / banned / suspended
POST /shops/{id}/balance-adjustment     -- ручная корректировка баланса (с причиной)
PUT  /shops/{id}/tariff                 -- назначить тариф
POST /shops/{id}/impersonate            -- получить временный токен для входа как продавец

GET  /moderation/queue                  -- очередь товаров на модерацию
POST /moderation/approve/{product_id}   -- одобрить
POST /moderation/reject/{product_id}    -- отклонить (с причиной, select + свободный текст)
POST /moderation/bulk-approve           -- [{product_id}] массовое одобрение

GET  /tariffs/                          -- список тарифов
POST /tariffs/                          -- создать тариф
PUT  /tariffs/{id}                      -- обновить
PATCH /tariffs/{id}/set-default         -- сделать дефолтным
```

#### External API (для интеграций, auth: Bearer API-ключ)
```
PATCH /api/v1/external/products/stock   -- [{sku, quantity}] обновить остатки
GET   /api/v1/external/orders/pending   -- получить новые заказы (polling)
PATCH /api/v1/external/orders/{id}/status -- обновить статус заказа
```

### Критическая бизнес-логика сервисов

**`shop_click_service.py`** — атомарное списание за клик:
```python
async def process_click(shop_id, product_id, session_id, click_type, db, redis):
    # 1. Дедупликация через Redis SET NX TTL 24h
    dedup_key = f"click:{shop_id}:{product_id}:{session_id}:{click_type}:{date.today()}"
    is_dup = not await redis.set(dedup_key, 1, ex=86400, nx=True)
    if is_dup:
        return ClickResult(charged=False, reason="duplicate")

    async with db.begin():
        # 2. SELECT FOR UPDATE на shop
        shop = await db.execute(
            select(Shop).where(Shop.id == shop_id).with_for_update()
        )
        # 3. Проверки
        if shop.is_auto_paused or shop.status != 'active':
            return ClickResult(charged=False, reason="shop_paused")
        if shop.balance <= 0:
            return ClickResult(charged=False, reason="no_balance")
        if shop.daily_budget_limit and shop.daily_budget_spent >= shop.daily_budget_limit:
            return ClickResult(charged=False, reason="daily_limit")

        # 4. Получить цену клика из тарифа
        price = await get_click_price(shop_id, product_id, db)

        # 5. Атомарное списание
        shop.balance -= price
        shop.daily_budget_spent += price
        click = ShopClick(shop_id=..., charged_amount=price, is_charged=True, ...)
        txn = ShopBillingTxn(type='click_charge', amount=-price, ...)
        db.add_all([click, txn])

        # 6. Авто-пауза если баланс упал ниже порога
        if shop.balance < shop.min_balance_threshold:
            shop.is_auto_paused = True
            # fire-and-forget: уведомить продавца
            send_low_balance_notification.delay(shop_id)

    return ClickResult(charged=True, amount=price)
```

**`shop_inventory_service.py`** — защита от race condition:
```python
async def reserve_stock(product_id, quantity, order_id, db):
    async with db.begin():
        product = await db.execute(
            select(ShopProduct)
            .where(ShopProduct.id == product_id)
            .with_for_update()
        )
        if not product.track_inventory:
            return ReserveResult(ok=True)  # не отслеживаем — пропускаем
        available = product.stock_quantity - product.stock_reserved
        if available < quantity:
            return ReserveResult(ok=False, available=available)

        product.stock_reserved += quantity
        log = ShopInventoryLog(
            action='order_reserved',
            quantity_before=product.stock_quantity,
            quantity_after=product.stock_quantity,
            delta=0,  # quantity не изменился, только reserved
            reference_id=order_id
        )
        db.add(log)
    return ReserveResult(ok=True)
```

**Валидация переходов статусов заказа:**
```python
ALLOWED_TRANSITIONS = {
    'new':              ['confirmed', 'cancelled'],
    'confirmed':        ['preparing', 'cancelled'],
    'preparing':        ['ready_for_pickup', 'in_delivery', 'cancelled'],
    'ready_for_pickup': ['completed', 'cancelled'],
    'in_delivery':      ['delivered', 'cancelled'],
    'delivered':        ['completed'],
    'completed':        [],   # финальный
    'cancelled':        [],   # финальный
}
```

### Celery — новые задачи (добавить к существующим)

**`seller_parse_tasks.py`**
```python
@celery.task(bind=True, max_retries=3, default_retry_delay=300)
def sync_shop_feed(self, config_id):
    # Загрузить фид, спарсить, обновить shop_products
    # НЕ удалять товары если фид вернул 0 — только флагнуть ошибку
    # После успеха: last_success_at, consecutive_failures=0
    # После ошибки: consecutive_failures++, если >=5 → уведомить admin

@celery.task
def schedule_feed_syncs():
    # Beat каждые 30 минут
    # SELECT configs WHERE is_active AND next_run_at <= now() AND consecutive_failures < 5
```

**`seller_billing_tasks.py`**
```python
@celery.task
def reset_daily_budgets():
    # Beat: каждый день в 00:00 UZT (UTC+5)
    # UPDATE shops SET daily_budget_spent=0, daily_budget_reset_at=now()

@celery.task
def auto_resume_paused_shops():
    # Beat: каждые 15 минут
    # WHERE is_auto_paused=True AND balance >= min_balance_threshold
    # SET is_auto_paused=False, status='active'
    # + уведомить продавца
```

**`seller_notification_tasks.py`**
```python
@celery.task
def notify_seller(shop_id, type, context):
    # type: 'new_order' | 'low_balance' | 'low_stock' | 'shop_resumed' | 'moderation_result'
    # Каналы: email (SMTP) + SMS (eskiz.uz — провайдер для Узбекистана)
    # Шаблоны по типу

@celery.task
def notify_new_order(order_id):
    # Вызывается при создании заказа
    # Email + SMS продавцу, опционально push (Web Push API)
```

---

## 🎨 ЧАСТЬ 3: Frontend — структура файлов

### Изменения в существующих файлах

**1. `middleware.ts`** — обновить матчеры:
```typescript
// Было:
matcher: ['/dashboard/:path*']

// Стало:
matcher: ['/dashboard/admin/:path*', '/dashboard/seller/:path*']

// Логика редиректа при логине:
if (role === 'admin') redirect('/dashboard/admin')
if (role === 'seller') redirect('/dashboard/seller')
// Добавить редирект: GET /dashboard → /dashboard/admin
```

**2. `app/dashboard/`** — переименовать в `app/dashboard/admin/`
Все существующие файлы переезжают без изменений. Обновить только:
- `layout.tsx` — изменить базовые ссылки в sidebar
- Добавить пункт "Продавцы" в sidebar nav (вместо "B2B Control")

### Новые файлы — добавить

```
app/
├── dashboard/
│   ├── page.tsx                    -- redirect → /dashboard/admin (для обратной совместимости)
│   ├── admin/                      -- существующий dashboard переезжает сюда
│   │   ├── layout.tsx              -- обновить: заменить B2B на Sellers в sidebar
│   │   ├── ... (все существующие страницы без изменений)
│   │   └── sellers/                -- НОВЫЙ раздел в существующей админке
│   │       ├── page.tsx            -- redirect → /dashboard/admin/sellers/applications
│   │       ├── applications/
│   │       │   ├── page.tsx        -- список заявок
│   │       │   └── [id]/page.tsx   -- детальная карточка заявки
│   │       ├── shops/
│   │       │   ├── page.tsx        -- список магазинов
│   │       │   └── [id]/page.tsx   -- карточка магазина
│   │       ├── moderation/
│   │       │   └── page.tsx        -- очередь товаров на модерацию
│   │       ├── billing/
│   │       │   └── page.tsx        -- финансы продавцов
│   │       └── tariffs/
│   │           └── page.tsx        -- управление тарифами
│   └── seller/                     -- НОВЫЙ дашборд продавца
│       ├── layout.tsx
│       ├── page.tsx                -- redirect → /dashboard/seller/overview
│       ├── overview/page.tsx
│       ├── products/
│       │   ├── page.tsx
│       │   ├── new/page.tsx
│       │   └── [id]/edit/page.tsx
│       ├── inventory/page.tsx
│       ├── orders/
│       │   ├── page.tsx
│       │   └── [id]/page.tsx
│       ├── leads/page.tsx
│       ├── analytics/page.tsx
│       ├── billing/page.tsx
│       └── settings/
│           ├── page.tsx
│           ├── parsing/page.tsx
│           └── api-keys/page.tsx
└── become-seller/
    ├── page.tsx                    -- wizard форма заявки
    ├── pending/page.tsx            -- "заявка на рассмотрении"
    └── rejected/page.tsx           -- "заявка отклонена" + причина
```

---

## 🎨 ЧАСТЬ 4: UI компоненты — реализовать полностью

### `/dashboard/admin/sellers/` — новый раздел в существующей админке

#### `applications/page.tsx`
- Вкладки: Новые (badge с кол-вом) / В работе / Одобренные / Отклонённые
- Таблица: название, ИНН, тип юрлица, контакт, дата, статус, кнопки
- Поиск по названию / ИНН / телефону / email

#### `applications/[id]/page.tsx`
- Полная карточка: все поля заявки сгруппированы секциями
- Блок документов: превью PDF (через iframe) и изображений
- Timeline статусов с авторами и комментариями
- Блок действий: кнопки Одобрить / Отклонить / Запросить доп. информацию
- При Отклонить/Запросить — обязательный textarea с причиной
- При Одобрить — создаётся `shop` и `user.role` меняется на `seller`, высылается email с логином

#### `shops/page.tsx`
- Таблица с поиском и фильтрами (статус, город, баланс <0)
- Колонки: логотип, название, статус (badge), баланс (красный если <threshold), кол-во товаров, клики за 30д
- Быстрые действия прямо в строке: поставить на паузу, разбанить

#### `shops/[id]/page.tsx`
- Хедер: логотип, название, статус, кнопки управления статусом
- Вкладки: Обзор / Товары / Заказы / Финансы / Настройки
- Обзор: KPI карточки + график расходов
- Финансы: текущий баланс, история транзакций, форма ручной корректировки баланса
- Кнопка "Войти как продавец" (impersonate) — открывает `/dashboard/seller` с временным токеном + баннер "Вы просматриваете как [shop_name]"

#### `moderation/page.tsx`
- Очередь товаров: превью фото, название, магазин, цена, дата добавления
- Быстрая модерация inline: Одобрить (зелёная) / Отклонить (красная)
- При отклонении — выпадающий список готовых причин + поле своего текста:
  - "Некачественные фото"
  - "Неверная категория"
  - "Подозрительная цена"
  - "Дублирующийся товар"
  - "Нарушение правил"
  - "Другое: ..."
- Флаги автоматической проверки (бэйдж на товаре): 🔴 Цена ±50% от avg / 🟡 Возможный дубль

#### `tariffs/page.tsx`
- Список тарифов карточками с текущим дефолтным
- Форма создания/редактирования: цена клика по категориям (интерактивная таблица), цена лида, цена заказа, мин. депозит
- Кнопка "Сделать дефолтным" (применяется к новым магазинам)

---

### `/dashboard/seller/` — дашборд продавца

#### `layout.tsx`
Sidebar отдельный от admin, другой визуальный стиль (или тот же — на твоё усмотрение, но роуты разные). Пункты:
- Обзор
- Товары
- Остатки
- Заказы
- Лиды
- Аналитика
- Баланс
- Настройки (с подпунктами: Магазин / Парсинг / API-ключи)

Header: название магазина, статус (активен/на паузе/в модерации) + аватар.

Если `shop.status === 'banned'` — показывать fullscreen баннер с причиной, доступен только раздел "Настройки".
Если `shop.is_auto_paused === true` — sticky баннер вверху: "Магазин приостановлен: недостаточно средств. Пополните баланс" + кнопка.

#### `overview/page.tsx`

**`<BalanceCard>`**
- Текущий баланс в UZS (большим шрифтом)
- "Зарезервировано: X UZS" (серым, если > 0)
- Если баланс < min_threshold — красный фон + "Пополните баланс"
- Кнопка "Пополнить" → открывает `<DepositModal>`
- Потрачено сегодня: X / {daily_budget_limit или "∞"} UZS

**`<StatsSummary>`** — 4 карточки с иконками:
- Клики (за период)
- Потрачено UZS (за период)
- Заказы (за период)
- Конверсия клик→заказ %

Переключатель периода: 7д / 30д / 90д (меняет все карточки и график)

**`<ClicksChart>`** — Recharts LineChart
- X: дни, Y: клики
- Tooltip с деталями: клики, потрачено за день
- Анимация через Framer Motion при смене периода

**`<RecentOrders>`**
- Последние 5 заказов: номер, покупатель (имя), сумма, статус (badge), время
- Кнопка "Все заказы"
- Если новых заказов > 0 — пульсирующий badge

**`<LowStockBanner>`**
- Если есть товары с остатком ≤ threshold → "5 товаров заканчиваются, проверьте остатки"
- Ссылка на `/dashboard/seller/inventory`

**`<ShopStatusBanner>`**
- Если `status === 'suspended'` → причина + контакт поддержки
- Если есть товары `pending_moderation` → "X товаров ожидают проверки"

#### `products/page.tsx`

Таблица с:
- Inline-редактирование цены и остатка: клик на ячейку → `<input>`, Enter/blur → PATCH
- Колонки: фото (миниатюра), название, SKU, цена, остаток, статус (badge с tooltip если rejected — причина)
- Фильтры: статус / категория / "низкий остаток" / поиск по названию/SKU
- Массовый выбор (чекбоксы) + bulk actions: архивировать / изменить статус / экспорт CSV
- Кнопка "Добавить товар" → `/dashboard/seller/products/new`
- Кнопка "Импорт" → `<ImportModal>` с drag&drop зоной и ссылкой на скачивание шаблона
- Пагинация

**`<ProductForm>`** (используется на `/new` и `/[id]/edit`):
- Основная информация: название, описание (rich text минимальный — bold/italic/lists), SKU, штрихкод
- Категория: иерархический выбор
- Цена: текущая + старая (зачёркнутая)
- Фото: drag&drop upload, reorder (drag handle), указать главное, превью. До 5 фото.
- Характеристики: динамические поля ключ-значение (добавить/удалить)
- Остаток: поле quantity + чекбокс "Не отслеживать остаток (всегда в наличии)" + порог уведомления
- Статус: черновик / опубликовать (опубликованный уйдёт на модерацию)
- Submit → статус становится `pending_moderation`, показывается toast "Товар отправлен на проверку"

#### `inventory/page.tsx`
- Таблица: товар / текущий остаток / зарезервировано / доступно (= остаток - резерв) / порог / статус
- Визуальный индикатор: ✅ ОК / 🟡 Мало / 🔴 Нет
- Inline-редактирование остатка прямо в таблице (как в products)
- Кнопка "Массовое обновление" → модальное окно с таблицей где можно быстро ввести все остатки
- Внизу/сбоку: лог изменений для выбранного товара (таймлайн: кто/когда/откуда/дельта)
- Фильтр лога: manual / order / api / import

#### `orders/page.tsx`
- Два вида: Kanban / Таблица (переключатель)
- **Kanban**: 4 колонки — Новые / В обработке / Доставляется / Завершены. Карточки с drag (но статус через кнопки, не drag — чтобы не было случайных изменений)
- **Таблица**: фильтры по статусу, дате, способу оплаты
- Badge с кол-вом новых заказов + браузерное уведомление (если Permission granted) при появлении нового
- Polling новых заказов каждые 30 секунд (TanStack Query `refetchInterval`)

#### `orders/[id]/page.tsx`
- Хедер: номер заказа, дата, статус
- Блок покупателя: имя, телефон (кликабельный), адрес доставки/самовывоза
- Блок товаров: таблица с фото, названием, кол-вом, ценой на момент заказа, суммой
- Блок оплаты: способ, статус
- Timeline статусов (вертикальный): когда создан / подтверждён / etc с временными метками
- Блок действий: кнопки смены статуса (только допустимые переходы!)
- При отмене — обязательное поле "причина"
- Поле "Комментарий продавца"
- Кнопка "Печать накладной" — открывает print-friendly страницу

#### `billing/page.tsx`
- `<BalanceCard>` (аналог из overview, но расширенный)
- Кнопка "Пополнить" → `<DepositModal>`

**`<DepositModal>`**:
- Быстрый выбор суммы: 50 000 / 100 000 / 200 000 / 500 000 / своя сумма
- Выбор платёжной системы: Click / Payme / UzCard / Банковский перевод
- При выборе → redirect на payment page или показать реквизиты (для банк. перевода)

- Настройки баланса: форма — мин. порог, дневной лимит
- Таблица транзакций: дата / тип (badge с цветом) / описание / сумма / баланс после
- Фильтры: тип транзакции, период
- Кнопка экспорт CSV

#### `analytics/page.tsx`
- Вкладки: Клики / Товары / Воронка
- **Клики**: LineChart по дням, разбивка по типам кликов (website / лид / заказ)
- **Товары**: таблица топ-20 товаров с колонками показы/клики/CTR/заказы/конверсия
- **Воронка**: BarChart — показы → клики → лиды → заказы с % конверсии между этапами

#### `settings/page.tsx`
- Секция "Основное": название, описание, slug (URL магазина), логотип, баннер
- Секция "Контакты": телефон, email, сайт
- Секция "Режим работы": тип (онлайн/офлайн/оба) + если офлайн — адрес + Yandex Maps embed
- Секция "Часы работы": таблица по дням (пн-вс), для каждого дня — open/close time или "выходной". Кнопка "Скопировать на все будни"
- Секция "Доставка": чекбокс "есть доставка" + динамическая таблица зон (название, цена, мин. сумма, дней)
- Секция "Самовывоз": чекбокс + адрес + время готовности в часах
- Секция "Оплата": чекбоксы: Наличные / Карта при получении / Click / Payme / UzCard

#### `settings/parsing/page.tsx`
- Переключатель: "Фид (YML/XML/CSV)" / "Ручное управление"
- Если фид:
  - URL фида + тип (select)
  - Расписание: каждые X часов (slider: 1, 3, 6, 12, 24)
  - Маппинг полей (если нужен): таблица "поле платформы ↔ поле в фиде"
  - Кнопка "Тест парсинга" → async, показывает превью первых 5 товаров в модальном окне
  - Статус последней синхронизации: время, кол-во товаров, ошибки
  - Кнопка "Синхронизировать сейчас" (disabled если уже запущена)
  - Лог последних 10 запусков (таблица: время / статус / кол-во товаров / ошибка)
- Toggle `is_active` — включить/выключить автосинхронизацию

#### `settings/api-keys/page.tsx`
- Список существующих ключей: название, scopes, создан, последнее использование, статус
- Кнопка "Создать ключ" → модальное окно:
  - Название ключа
  - Scopes (мультиселект): Управление остатками / Чтение заказов / Обновление заказов
  - После создания: показать полный ключ ЕДИНОЖДЫ с кнопкой копирования и предупреждением "Сохраните ключ сейчас — показывается только один раз"
- Кнопка "Отозвать" с подтверждением

---

## 📋 ЧАСТЬ 5: Форма заявки `/become-seller`

Многошаговый wizard. Состояние хранить в Zustand + persist в `sessionStorage` (чтобы не терять при случайном закрытии вкладки). Анимация переходов между шагами через Framer Motion (slide left/right).

Прогресс-бар вверху с названиями шагов. Кнопки "Назад" / "Далее". При "Далее" — валидация текущего шага через Zod.

**Шаг 1 — Тип бизнеса**
- Три карточки с иконками (кликабельные): ИП / ООО / Физлицо
- ИНН (СТИР):
  - ИП/физлицо → 9 цифр, валидация на Luhn или простая проверка длины
  - ООО → 14 цифр
  - Маска ввода
- Название магазина (отображаемое на сайте)

**Шаг 2 — Адреса**
- Юридический адрес (textarea)
- Фактический адрес + чекбокс "Совпадает с юридическим" (если чекнут — копирует)

**Шаг 3 — Контакты и режим работы**
- Телефон: маска +998 (XX) XXX-XX-XX
- Email
- Тип работы: три toggle-карточки — "Только онлайн" / "Офлайн магазин" / "Онлайн + офлайн"
- Если офлайн/оба: поле адреса магазина
- Чекбоксы: "Есть доставка" / "Есть самовывоз"

**Шаг 4 — Каталог**
- Категории товаров: мультиселект с поиском, мин. 1 макс. 5
- Есть ли сайт:
  - Да → поле URL + info-блок "Мы настроим синхронизацию после одобрения"
  - Нет → info-блок "Вы будете добавлять товары вручную через личный кабинет"
- Примерное кол-во товаров: select (< 50 / 50–200 / 200–1000 / > 1000)

**Шаг 5 — Документы**
- Загрузка документов: drag&drop зона
  - Свидетельство ИП (для ИП) / Устав + выписка из реестра (для ООО)
  - Форматы: PDF, JPG, PNG. Макс. 10 MB на файл.
  - Превью загруженных: миниатюра/иконка, имя, размер, кнопка удалить
- Фото магазина/офиса (опционально, помогает в одобрении)
- Чекбокс принятия оферты (обязательный) + ссылка на документ

**Шаг 6 — Подтверждение**
- Красиво оформленная сводка всех введённых данных
- Кнопка "Отправить заявку"
- Loading state на кнопке при отправке
- После успеха → redirect на `/become-seller/pending`

**`/become-seller/pending`**:
- Иллюстрация + "Заявка принята!"
- "Мы рассмотрим её в течение 1–3 рабочих дней"
- "Результат придёт на email: {email}"
- Кнопка "Вернуться на главную"
- Если user залогинен — ссылка на статус заявки

**`/become-seller/rejected`**:
- "К сожалению, ваша заявка не одобрена"
- Причина отказа (из admin_comment)
- Кнопка "Подать новую заявку" (очищает Zustand store и возвращает на wizard)

---

## 🔐 ЧАСТЬ 6: Безопасность (добавить к существующей системе)

**Seller resource isolation** — во всех seller endpoints добавить проверку:
```python
# Каждый endpoint проверяет что ресурс принадлежит текущему магазину
# Пример для products:
product = await db.get(ShopProduct, product_id)
if product.shop_id != current_shop.id:
    raise HTTPException(403, "Access denied")
```

**Admin impersonate** — безопасная реализация:
```python
# POST /admin/sellers/shops/{id}/impersonate
# Возвращает временный JWT с доп. claim: {"impersonated_by": admin_id, "exp": now+15min}
# Записывает в audit_log: кто / когда / какой магазин
# Токен не даёт делать финансовые операции (проверка в billing endpoints)
# В header ответа X-Impersonation: true
# Frontend показывает sticky баннер: "⚠️ Вы просматриваете дашборд магазина [name]"
```

**Загрузка файлов (документы заявки)**:
```python
# Проверять magic bytes а не только расширение:
ALLOWED_MAGIC = {
    b'%PDF': 'application/pdf',
    b'\xff\xd8\xff': 'image/jpeg',
    b'\x89PNG': 'image/png',
}
# Хранить в S3-compatible хранилище (MinIO в Docker)
# Путь: applications/{application_id}/{filename}
# Presigned URL с TTL для просмотра из админки
```

**External API ключи**:
```python
# В header: Authorization: Bearer {full_key}
# На бэке: итерировать shop_api_keys, bcrypt.checkpw
# После успешной аутентификации: обновить last_used_at
# Rate limit: 100 req/min per key (Redis)
# Проверять scopes для каждого endpoint
```

**Webhooks платёжных систем (Click / Payme)**:
```python
# Проверять HMAC подпись
# provider_tx_id должен быть уникальным (INSERT ... ON CONFLICT DO NOTHING)
# Идемпотентность: повторный webhook не должен дважды пополнять баланс
```

---

## ⚠️ Edge cases — обязательно обработать

**Инвентарь:**
- Продавец снимает флаг `track_inventory` у товара пока есть активный заказ с его резервом → освободить `stock_reserved` при снятии флага, записать в лог

**Заказы:**
- Цена товара изменилась после добавления в корзину → использовать цену из `product_snapshot`, не текущую
- Продавец архивирует товар пока он в активном заказе → не давать архивировать, показывать предупреждение с кол-вом активных заказов
- Заказ `new` не подтверждён 24 часа → Celery task автоматически отменяет + уведомляет покупателя и продавца

**Биллинг:**
- Баланс упал ровно до 0 (не ниже) → магазин автоматически паузируется
- Двойное нажатие кнопки "Пополнить" → idempotency key в request + уникальный provider_tx_id в БД
- Продавец меняет тариф → только новые клики по новой цене, прошлые не пересчитываются

**Парсинг:**
- Фид вернул 0 товаров (сайт лёг) → НЕ архивировать существующие товары, только записать ошибку, уведомить продавца
- Парсинг завис → Celery task timeout 5 минут, после — принудительное завершение и запись ошибки
- У продавца есть сайт И ручные товары → оба источника сосуществуют, `source` поле разделяет

**Auth / роли:**
- Продавец подаёт заявку → одобрение меняет `user.role='seller'` в рамках одной транзакции с созданием `shop`
- Если одобрение прошло но транзакция откатилась → заявка остаётся `approved`, повторный запрос идемпотентен
- Impersonate токен истёк → 401 с понятным сообщением, редирект обратно в `/dashboard/admin`

**Уведомления:**
- SMS провайдер eskiz.uz вернул ошибку → логировать, не падать, retry через 5 минут (3 попытки)
- Продавец отключил email уведомления → уважать настройку, кроме критических (бан, подозрительная активность)
