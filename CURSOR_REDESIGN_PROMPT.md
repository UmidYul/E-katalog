# 🎨 CURSOR REDESIGN PROMPT — E-Katalog (Price Comparison Platform)

---

## 🧠 КОНТЕКСТ ПРОЕКТА

Ты работаешь над **e-katalog** — агрегатором цен на электронику (аналог Яндекс Маркет / OZON). Стек: **Next.js 14 (App Router), React 18, TypeScript, TailwindCSS, TanStack Query, Zustand, shadcn/ui**.

**Твоя задача:** полный редизайн всего фронтенда. Production-ready, pixel-perfect, адаптивный (mobile-first), с поддержкой light/dark режима. Ты должен делать это **пошагово — страница за страницей**, не ломая API-логику, стейт-менеджмент и бизнес-функционал.

---

## ⚙️ ЖЁСТКИЕ ПРАВИЛА (НИКОГДА НЕ НАРУШАЙ)

1. **НЕ ТРОГАЙ бизнес-логику.** TanStack Query хуки, Zustand store, React Hook Form + Zod валидацию, API вызовы — всё это остаётся нетронутым.
2. **ЕСЛИ меняешь структуру JSX** (переносишь элементы, удаляешь обёртки, меняешь теги) — убедись, что все `onClick`, `onChange`, `ref`, `data-*` атрибуты, условные рендеры (`{isLoading && ...}`, `{data?.map(...)}`) и передача пропсов остаются корректными.
3. **НЕ УДАЛЯЙ функциональные элементы** (кнопки, ссылки, формы, инпуты) — только меняй их стиль. Если элемент мешает дизайну — перемести его в другое место на странице, но не убирай.
4. **СОХРАНЯЙ семантику HTML:** `<main>`, `<nav>`, `<header>`, `<footer>`, `<section>`, `<article>` — используй правильно.
5. **Адаптивность ОБЯЗАТЕЛЬНА** на всех страницах: mobile (320px+), tablet (768px+), desktop (1280px+), ultrawide (1920px+).
6. **Light + Dark режим** — использовать CSS-переменные через `next-themes`. Все цвета только через CSS переменные, никаких хардкодных hex в Tailwind классах.
7. **После каждой страницы** — проверь что ничего не сломалось, запусти `npm run build` и исправь все TypeScript ошибки.

---

## 🎨 ДИЗАЙН-СИСТЕМА

### Концепция
**"Precision Commerce"** — строгий, технологичный, доверительный. Как премиум-версия DNS или МВидео, но с душой Vercel-продукта. Никакого корпоративного занудства — живой, современный, с характером.

### Цветовая палитра (обнови `globals.css`)

```css
:root {
  /* Backgrounds */
  --background: 0 0% 99%;
  --background-subtle: 220 20% 97%;
  --surface: 0 0% 100%;
  --surface-raised: 220 14% 96%;

  /* Brand */
  --primary: 231 98% 60%;          /* Яркий индиго #4F52FF */
  --primary-hover: 231 98% 54%;
  --primary-foreground: 0 0% 100%;
  --primary-subtle: 231 98% 97%;

  /* Accent */
  --accent: 25 95% 58%;            /* Оранжевый #F97316 — цены, CTA */
  --accent-foreground: 0 0% 100%;
  --accent-subtle: 25 95% 96%;

  /* Text */
  --foreground: 224 32% 12%;
  --foreground-secondary: 220 13% 40%;
  --foreground-muted: 220 9% 60%;

  /* Borders */
  --border: 220 16% 90%;
  --border-strong: 220 16% 80%;

  /* States */
  --success: 142 71% 38%;
  --warning: 38 92% 50%;
  --destructive: 0 84% 58%;

  /* Cards */
  --card: 0 0% 100%;
  --card-foreground: 224 32% 12%;
  --card-shadow: 0 1px 3px hsl(224 32% 12% / 0.06), 0 4px 16px hsl(224 32% 12% / 0.04);
  --card-shadow-hover: 0 4px 12px hsl(231 98% 60% / 0.12), 0 8px 32px hsl(224 32% 12% / 0.08);
}

.dark {
  --background: 224 28% 8%;
  --background-subtle: 224 24% 10%;
  --surface: 224 24% 11%;
  --surface-raised: 224 20% 14%;

  --primary: 231 98% 68%;
  --primary-hover: 231 98% 74%;
  --primary-foreground: 224 28% 8%;
  --primary-subtle: 231 40% 16%;

  --accent: 25 95% 62%;
  --accent-subtle: 25 60% 14%;

  --foreground: 220 20% 94%;
  --foreground-secondary: 220 12% 65%;
  --foreground-muted: 220 8% 45%;

  --border: 224 16% 20%;
  --border-strong: 224 16% 28%;

  --card: 224 22% 13%;
  --card-foreground: 220 20% 94%;
  --card-shadow: 0 1px 3px hsl(0 0% 0% / 0.3), 0 4px 16px hsl(0 0% 0% / 0.2);
  --card-shadow-hover: 0 4px 12px hsl(231 98% 68% / 0.15), 0 8px 32px hsl(0 0% 0% / 0.3);
}
```

### Типографика
Подключи через `next/font` в `layout.tsx`:
- **Display/Headings:** `Syne` (Google Fonts) — технологичный, современный
- **Body:** `DM Sans` — читабельный, нейтральный
- **Числа/цены:** `JetBrains Mono` — моноширинный для цен выглядит круто

```tsx
// layout.tsx
import { Syne, DM_Sans, JetBrains_Mono } from 'next/font/google'

const syne = Syne({ subsets: ['latin'], variable: '--font-heading', weight: ['600', '700', '800'] })
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-body' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', weight: ['400', '600'] })
```

### Компоненты (обнови shadcn токены)
- **Border radius:** `--radius: 0.75rem` (12px) для карточек, `0.5rem` для инпутов/кнопок
- **Тени:** всегда цветные (через primary/accent) — никаких серых box-shadow
- **Кнопки:** без скруглений pill-style, используй `rounded-lg`. Primary — с лёгким gradient overlay
- **Инпуты:** тонкая border, при фокусе — кольцо цвета primary с blur-эффектом

---

## 📱 ОБЩИЕ КОМПОНЕНТЫ (переделай в первую очередь)

### Header / Navbar
- Высота desktop: 64px, mobile: 56px
- **Эффект:** `backdrop-blur-md bg-background/80 border-b border-border` — стеклянный эффект при скролле
- Логотип: иконка + "e-katalog" жирным Syne
- Поиск: растяжимый инпут по центру (desktop), иконка-кнопка (mobile) → слайдаут оверлей с поиском
- Справа: ThemeToggle, избранное (с счётчиком), аватар/логин
- Mobile: hamburger → drawer с полным меню
- При скролле вниз — скрывается, при скролле вверх — появляется (hide-on-scroll behavior)

### Footer
- 4-колоночный grid (desktop), аккордеон (mobile)
- Секции: каталог, покупателям, продавцам, о нас
- Снизу: копирайт + ссылки на privacy/terms + соц. сети
- Лёгкий gradient top-border цвета primary

### ProductCard (самый важный компонент!)
```
┌─────────────────────────────┐
│  [badge: -15%]   [♡ favorite]│
│                              │
│        [product image]       │
│         300x220px            │
│                              │
├─────────────────────────────┤
│  Samsung Galaxy S24          │
│  ★★★★☆ (234 отзыва)        │
├─────────────────────────────┤
│  от ¥45 990        [В магаз]│
│  [3 магазина]               │
└─────────────────────────────┘
```
- Hover: карточка поднимается (`translateY(-4px)`), тень становится цветной
- Цена: шрифт JetBrains Mono, accent color
- Кнопка "В магазин": появляется при hover на desktop
- Бейдж скидки: accent background, absolute top-left
- Рейтинг: звёздочки с заполнением через CSS clip-path

---

## 📄 СТРАНИЦЫ — ПОШАГОВЫЙ ПЛАН

### ЭТАП 1: Основа (сделай первым)
1. `globals.css` — новые CSS переменные (см. выше)
2. `layout.tsx` — подключение шрифтов, next-themes provider
3. `components/layout/Header.tsx` — новый хедер
4. `components/layout/Footer.tsx` — новый футер
5. `components/ui/ProductCard.tsx` — новая карточка товара

---

### ЭТАП 2: Публичные страницы

#### `/` — Главная страница
**Hero секция:**
- Полноширинная, высота min-h-[560px]
- Заголовок: крупный (text-5xl md:text-7xl), Syne Bold
- "Найди лучшую цену на электронику" + подзаголовок
- Большая поисковая строка с кнопкой и подсказками популярных запросов
- Фоновый элемент: animated gradient mesh (CSS @keyframes) или геометрическая сетка

**Категории:**
- Горизонтальный скролл на mobile, grid 4-6 колонок на desktop
- Карточки категорий: иконка + название, при hover меняют цвет
- Используй Lucide иконки или SVG

**Популярные товары:**
- Grid 2-3-4-5 колонок (mobile-tablet-desktop-wide)
- Горизонтальный scroll на mobile с snap-x

**Промо-баннеры:**
- 2-колоночный grid или carousel
- Яркие gradient backgrounds

**Недавно просмотренные** (если авторизован):
- Горизонтальный скролл

---

#### `/catalog` — Каталог
- **Sidebar фильтры** (desktop): sticky, 260px, с секциями (цена-слайдер, бренды-чекбоксы, рейтинг, наличие)
- **Mobile:** кнопка "Фильтры" → bottomsheet/drawer
- **Сортировка:** dropdown вверху справа
- **Grid товаров:** переключатель grid/list view
- **List view:** горизонтальные карточки с большим изображением слева
- **Пагинация:** с ellipsis, кнопки prev/next
- **Skeleton loading:** при загрузке данных показывай skeleton карточки

---

#### `/category/[slug]` — Страница категории
- Breadcrumbs вверху
- Заголовок категории + описание + количество товаров
- Подкатегории (если есть): горизонтальные чипы/теги
- Далее как /catalog

---

#### `/product/[slug]` — Карточка товара (САМАЯ ВАЖНАЯ)
**Верхняя часть — 2 колонки:**
- Левая (40%): галерея изображений. Главное фото + thumbnails снизу. Zoom при hover.
- Правая (60%):
  - Бренд (ссылка) + название (h1, Syne)
  - Рейтинг + кол-во отзывов
  - Лучшая цена крупно (JetBrains Mono, accent, text-4xl)
  - Таблица офферов от магазинов (название, цена, наличие, кнопка "Купить")
  - Кнопки: "Добавить в избранное", "Сравнить"
  - Sticky sidebar при скролле на desktop

**Нижняя часть (tabs):**
- Характеристики: таблица key-value с зеброй
- Отзывы: карточки с рейтингом, аватаром, текстом, датой
- Похожие товары: горизонтальный скролл

---

#### `/compare` — Сравнение товаров
- Sticky заголовок с названиями товаров
- Горизонтальный скролл таблицы
- Выделение лучшего значения в каждой строке (success color)
- Кнопка удаления товара из сравнения

---

#### `/login` и `/register`
- Центрированная карточка, max-w-md
- Split layout на desktop: форма слева, иллюстрация/промо справа
- Форма: красивые инпуты с floating label или clear label above
- Социальный логин (если есть): кнопки с иконками
- Ссылки между страницами

---

### ЭТАП 3: Аккаунт

#### `/profile`
- Sidebar слева с навигацией (desktop) / tabs (mobile)
- Секции: личные данные, безопасность, настройки уведомлений
- Аватар с кнопкой загрузки

#### `/favorites` и `/recently-viewed`
- Page header с кол-вом товаров
- Grid карточек (как в каталоге)
- Пустое состояние: красивая иллюстрация + CTA

---

### ЭТАП 4: Dashboard (продавец и admin)

**Общий Layout Dashboard:**
- Sidebar (desktop): 240px, коллапсируемый до 60px (иконки)
- Mobile: hamburger → drawer overlay
- Sidebar items: иконка + label, active state с background
- Header: breadcrumbs + user menu + notifications bell
- Main content: p-6, max-w-7xl

**`/dashboard/seller` — Главная продавца:**
- Stats cards row: выручка, заказы, товары, конверсия
- Каждая карточка: иконка, значение (крупно), дельта vs прошлый период (зелёный/красный)
- График продаж: recharts LineChart/AreaChart, responsive
- Таблица последних заказов

**`/dashboard/seller/products` — Список товаров:**
- DataTable с колонками: фото, название, цена, статус, действия
- Фильтр по статусу (чипы/tabs)
- Поиск по названию
- Bulk actions (удалить, изменить статус)

**`/dashboard/admin` — Admin панель:**
- Расширенная статистика
- Таблицы пользователей, товаров, жалоб
- Статус системы / воркеры

---

### ЭТАП 5: Статические страницы

#### `/for-shops` и `/become-seller`
- Landing-style страницы
- Hero + features + pricing/steps + CTA
- Анимации при скролле (CSS scroll-driven animations или Intersection Observer)

#### `/contacts`
- Форма + контактная информация
- Карта (если есть интеграция)

#### `/403`, пустые состояния
- Красивые full-page иллюстрации + CTA

---

## 🧩 UI ПАТТЕРНЫ (применяй везде)

### Loading States
```tsx
// Skeleton для карточки товара
<div className="animate-pulse">
  <div className="bg-muted rounded-lg h-[220px] w-full mb-3" />
  <div className="bg-muted rounded h-4 w-3/4 mb-2" />
  <div className="bg-muted rounded h-4 w-1/2" />
</div>
```

### Empty States
- Всегда с SVG иллюстрацией (можно inline SVG)
- Описательный текст + кнопка действия

### Toast/Notifications
- Используй sonner или shadcn toast
- Позиция: bottom-right desktop, top mobile
- Типы: success (зелёный), error (красный), info (синий)

### Таблицы
- Zebra striping (alternate rows)
- Sticky header при скролле
- Hover highlight row
- Mobile: горизонтальный скролл с тенями по краям

---

## 📐 TAILWIND УТИЛИТЫ (создай в globals.css)

```css
@layer utilities {
  .card-base {
    @apply bg-card rounded-xl border border-border;
    box-shadow: var(--card-shadow);
    transition: box-shadow 0.2s ease, transform 0.2s ease;
  }
  
  .card-hover {
    @apply hover:-translate-y-1;
    &:hover { box-shadow: var(--card-shadow-hover); }
  }
  
  .price-tag {
    @apply font-mono text-accent font-semibold;
  }
  
  .badge-discount {
    @apply bg-accent text-accent-foreground text-xs font-bold px-2 py-0.5 rounded;
  }
  
  .gradient-primary {
    background: linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary-hover)) 100%);
  }
  
  .text-gradient {
    background: linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  
  .glass {
    @apply backdrop-blur-md bg-background/80 border border-border/60;
  }
  
  .section-padding {
    @apply px-4 md:px-6 lg:px-8 xl:px-12;
  }
}
```

---

## 🚀 АНИМАЦИИ

### Добавь в globals.css:
```css
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.animate-fade-in-up {
  animation: fadeInUp 0.4s ease forwards;
}

/* Staggered children */
.stagger-children > * {
  opacity: 0;
  animation: fadeInUp 0.4s ease forwards;
}
.stagger-children > *:nth-child(1) { animation-delay: 0.05s; }
.stagger-children > *:nth-child(2) { animation-delay: 0.1s; }
.stagger-children > *:nth-child(3) { animation-delay: 0.15s; }
.stagger-children > *:nth-child(4) { animation-delay: 0.2s; }
.stagger-children > *:nth-child(5) { animation-delay: 0.25s; }
```

---

## ✅ ЧЕКЛИСТ ПОСЛЕ КАЖДОЙ СТРАНИЦЫ

- [ ] `npm run build` — нет TypeScript ошибок
- [ ] Все API вызовы работают (данные загружаются)
- [ ] Все кнопки/ссылки кликабельны
- [ ] Mobile (375px) — нет горизонтального скролла
- [ ] Tablet (768px) — корректный layout
- [ ] Desktop (1280px) — выглядит идеально
- [ ] Dark mode — все цвета корректны, нет белых пятен
- [ ] Loading state — skeleton показывается
- [ ] Empty state — если данных нет, красивая заглушка
- [ ] Hover/focus states на всех интерактивных элементах
- [ ] Нет console.error в браузере

---

## 🎯 ПРИОРИТЕТ ВЫПОЛНЕНИЯ

```
1. globals.css + layout.tsx (шрифты, токены, провайдеры)
2. Header + Footer
3. ProductCard компонент
4. Главная страница (/)
5. Каталог (/catalog, /category/[slug])
6. Карточка товара (/product/[slug])  ← КРИТИЧНО
7. Поиск
8. Авторизация (/login, /register)
9. Аккаунт (/profile, /favorites)
10. Dashboard seller
11. Dashboard admin
12. Статические страницы
```

---

## ⚠️ ЧАСТЫЕ ОШИБКИ — ИЗБЕГАЙ

1. **Не используй** `text-gray-*` — только `text-foreground`, `text-foreground-secondary`, `text-muted-foreground`
2. **Не хардкодь** цвета через hex/rgb напрямую в className
3. **Не удаляй** `key` пропсы в списках
4. **Не трогай** файлы в `/api/`, `/lib/api.ts`, `/store/`, `/hooks/`
5. **Проверяй** что `{data?.items?.map(...)}` не превратился в `{items.map(...)}`
6. **Image компонент** Next.js — сохраняй `width`, `height` или `fill` пропсы
7. **Не убирай** `aria-label`, `role`, другие accessibility атрибуты

---

Начни с ЭТАПА 1. После каждого этапа сообщи что сделано и жди подтверждения перед следующим.
