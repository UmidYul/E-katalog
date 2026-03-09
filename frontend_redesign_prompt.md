# Frontend Redesign Prompt — E-catalog Platform (2026)

## Роль
Ты senior frontend-разработчик с глубокой экспертизой в e-commerce продуктах уровня Ozon, Wildberries, Amazon, Zalando. Ты понимаешь паттерны UX/UI 2025–2026, принципы конверсионного дизайна и умеешь строить production-ready интерфейсы.

---

## Задача
Полностью переработать дизайн, структуру и стилевую систему e-catalog платформы (агрегатора цен на технику). Не патчить существующие стили — переписать всё с нуля, сохранив только логику и API-интеграции.

---

## Технологии
- Next.js 14 (App Router)
- React 18
- TypeScript
- TailwindCSS (utility-first, без кастомных CSS-файлов где возможно)
- TanStack Query для всех серверных запросов
- Zustand для глобального состояния
- Framer Motion для анимаций
- React Hook Form + Zod для форм

---

## Дизайн-система

### Цветовая палитра (светлая тема)
```
Background:     #FFFFFF / #F8F9FC
Surface:        #F2F4F8
Border:         #E4E7EF
Text primary:   #0D1117
Text secondary: #5A6478
Text muted:     #9BA3B5
Accent:         #2563EB  (electric blue)
Accent hover:   #1D4ED8
Success:        #16A34A
Warning:        #D97706
Danger:         #DC2626
```

### Типографика
- Font: Inter (Google Fonts)
- Шкала: 12 / 14 / 16 / 18 / 24 / 32 / 48px
- Weights: 400 / 500 / 600 / 700
- Line-height: 1.5 для body, 1.2 для заголовков

### Сетка
- Max-width контейнер: 1280px
- Колонки: 12-колоночная сетка
- Gap: 24px desktop / 16px mobile
- Breakpoints: sm:640 / md:768 / lg:1024 / xl:1280

### Радиусы и тени
```
rounded-sm:  4px   — чипы, бейджи
rounded-md:  8px   — инпуты, кнопки
rounded-lg:  12px  — карточки
rounded-xl:  16px  — модалки, панели
rounded-2xl: 24px  — большие секции

shadow-sm: 0 1px 3px rgba(0,0,0,0.06)
shadow-md: 0 4px 16px rgba(0,0,0,0.08)
shadow-lg: 0 8px 32px rgba(0,0,0,0.12)
```

---

## Анимации (Framer Motion)

Использовать везде где есть появление, переходы, взаимодействия:

```ts
// Появление карточек при скролле
fadeInUp: { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, ease: 'easeOut' } }

// Hover на карточках
cardHover: { whileHover: { y: -4, shadow: 'lg' }, transition: { duration: 0.2 } }

// Stagger для списков
staggerContainer: { animate: { transition: { staggerChildren: 0.07 } } }

// Skeleton pulse — через TailwindCSS animate-pulse

// Переходы между страницами — layout animations через AnimatePresence
```

Обязательно анимировать:
- Появление карточек товаров
- Открытие/закрытие фильтров
- Добавление в избранное (heart burst)
- Переключение табов
- Dropdown меню
- Toast-уведомления (slide in from right)
- Модальные окна
- Цена при hover на оффер

---

## Принципы дизайна

1. **Seamless layout** — никаких резких границ между секциями. Плавные переходы через gradient overlays, не жёсткие border-bottom.

2. **Whitespace first** — много воздуха. Padding секций: py-16 desktop, py-10 mobile.

3. **No generic AI blocks** — никаких card-grid с одинаковыми прямоугольниками на всю ширину. Миксовать размеры, ломать сетку там где это уместно (featured продукт — шире, hero card — на всю ширину).

4. **Contextual density** — на каталоге плотнее, на лендинге легче, на дашборде — максимально функционально.

5. **Micro-interactions везде** — кнопки, чекбоксы, переключатели, звёздочки рейтинга — всё должно реагировать на hover/focus/active.

---

## Страницы

### `/` — Главная

**Navbar:**
- Sticky, blur-backdrop при скролле: `backdrop-blur-md bg-white/80`
- Лого слева, поиск по центру (расширяется при фокусе), nav + иконки справа
- Поисковая строка: autocomplete с живыми результатами через TanStack Query + debounce 300ms
- При вводе — выпадающий список: категории совпадений, топ товаров, быстрые ссылки

**Hero:**
- Не банальный прямоугольник. Асимметричная секция: текст слева, справа — 3D-карусель из featured товаров или floating product cards с тенями
- Подзаголовок с анимированным типингом категорий: "найдите лучшую цену на смартфоны / ноутбуки / наушники"
- Два CTA: "Перейти в каталог" (primary) + "Сравнить товары" (ghost)
- Под hero — strip с логотипами партнёрских магазинов (marquee scroll)

**Популярные товары:**
- Заголовок + табы по категориям (Смартфоны / Ноутбуки / Наушники / ТВ)
- Горизонтальный скролл на мобиле, сетка на десктопе
- Product card: изображение с hover-zoom, название, цена от X сум, количество офферов badge, кнопка избранного

**Категории:**
- Не банальный grid иконок. Визуальные карточки с фоновым градиентом и иллюстрацией/фото устройств
- Большая карточка (смартфоны) + несколько малых рядом — ломаная сетка

**Editorial picks:**
- Горизонтальные карточки коллекций с cover-image, заголовком и описанием
- Hover: лёгкий scale + overlay с кнопкой

**Бренды:**
- Marquee-полоска с логотипами, автоскролл, пауза при hover

**Footer:**
- Многоколоночный, тёмный (#0D1117), ссылки, соцсети, копирайт

---

### `/catalog` — Каталог

**Layout:**
- Left sidebar (280px) + main content
- Sidebar sticky при скролле, коллапсируется на мобиле в bottom sheet

**Sidebar фильтры:**
- Категории — tree с expand/collapse
- Бренды — checkbox список с поиском внутри
- Цена — range slider с двумя ручками, инпуты для ввода
- Наличие — toggle switch
- Рейтинг — star picker
- Кнопка "Сбросить фильтры" появляется только если есть активные

**Контент:**
- Sort bar: количество результатов + select сортировки + переключатель grid/list
- Product grid: 3 колонки desktop / 2 tablet / 1 mobile
- Infinite scroll или пагинация с skeleton между загрузками
- Skeleton cards при загрузке (точная копия карточки но серая)

**Product card:**
- Изображение с aspect-ratio 1:1, hover zoom
- Бейдж "Н" (новинка) или "%" (скидка) если есть
- Название: 2 строки max, ellipsis
- Звёздочки рейтинга + количество отзывов
- Цена: "от X сум" крупно + количество офферов мелко
- Иконки: избранное (heart), сравнение (equals), быстрый просмотр (eye) — появляются при hover

---

### `/product/[slug]` — Карточка товара

**Layout:**
- Breadcrumb навигация
- Левая колонка (45%): галерея изображений
  - Главное фото + миниатюры снизу
  - Zoom при hover (lens эффект)
  - Fullscreen просмотр по клику
- Правая колонка (55%): информация

**Правая колонка:**
- Название H1
- Рейтинг + отзывы + в наличии badge
- Ключевые характеристики — 4-5 chip-бейджей (ОЗУ, память, экран)
- Цена блок:
  - "Лучшая цена: X сум" крупно
  - "В X магазинах" мелко
  - Кнопки: "Перейти к офферам" (primary) + избранное + сравнение
- История цены — mini sparkline chart (recharts)

**Офферы:**
- Таблица/список: логотип магазина, цена, наличие, доставка, кнопка "В магазин"
- Сортировка по цене
- Лучший оффер выделен accent-рамкой

**Характеристики:**
- Accordion секции по группам (Дисплей / Камера / Батарея / Связь)
- Кнопка "Сравнить с похожим"

**Похожие товары:**
- Горизонтальная карусель

---

### `/compare` — Сравнение

- Sticky заголовок с названиями товаров и кнопками удаления
- Строки характеристик: label слева + значения по колонкам
- Лучшее значение в строке — highlight зелёным
- Худшее — подчёркнуто красным
- Строки с одинаковыми значениями — опционально скрыть (toggle "Показать только различия")
- Слот добавления товара — пунктирная карточка с поиском
- Mobile: горизонтальный скролл колонок

---

### `/login` и `/register`

- Split layout: левая половина — иллюстрация/gradient с преимуществами платформы, правая — форма
- Форма по центру правой колонки, max-width 400px
- Floating labels на инпутах
- Показать/скрыть пароль
- Inline валидация через Zod (ошибка появляется при blur)
- Submit button — loading state со спиннером
- Социальный вход (Google) если есть
- Ссылка на регистрацию/логин

---

### `/profile`

- Sidebar навигация аккаунта: Профиль / Избранное / История просмотров / Выйти
- Аватар с возможностью загрузки (drag & drop или клик)
- Форма редактирования: имя, email, телефон
- Секция смены пароля (отдельный accordion)
- Danger zone: удаление аккаунта с confirm-модалкой

---

### `/favorites`

- Grid товаров с кнопкой удаления из избранного
- Сортировка: по дате / по цене
- Empty state: иллюстрация + "Ещё не добавили ни одного товара" + CTA в каталог
- Быстрое сравнение выбранных

---

### `/recently-viewed`

- Список с группировкой по дате (Сегодня / Вчера / Ранее)
- Кнопка "Очистить историю" с confirm
- Компактные карточки с временем просмотра

---

## Компоненты (общие)

### Toast-уведомления
- Slide in справа снизу
- 4 типа: success / error / warning / info
- Auto-dismiss 4 секунды, ручное закрытие
- Стек если несколько

### Skeleton loaders
- Точно повторяют форму контента
- animate-pulse серого цвета
- Везде где есть async данные

### Empty states
- Иллюстрация (SVG) + заголовок + описание + CTA кнопка
- Уникальные для каждого типа списка

### Модальные окна
- Backdrop blur
- AnimatePresence для enter/exit
- Закрытие по Escape и клику на backdrop
- Focus trap внутри

### Поиск (глобальный)
- Debounce 300ms
- Группировка результатов: Товары / Категории / Бренды
- Highlight совпадений в тексте
- Keyboard navigation (стрелки + Enter)
- Сохранение последних поисков в localStorage

---

## API интеграция

Все данные через TanStack Query:

```ts
// Паттерн для каждого запроса
const { data, isLoading, isError } = useQuery({
  queryKey: ['products', filters],
  queryFn: () => api.getProducts(filters),
  staleTime: 1000 * 60 * 5,
  placeholderData: keepPreviousData,
})

// Оптимистичные обновления для избранного
const mutation = useMutation({
  mutationFn: api.toggleFavorite,
  onMutate: async (productId) => {
    // optimistic update
  },
  onError: (err, variables, context) => {
    // rollback
  }
})
```

- Loading states: всегда skeleton, никогда спиннер на весь экран
- Error states: inline сообщение + retry кнопка
- Optimistic updates для избранного и сравнения

---

## Требования к коду

- Все компоненты — функциональные, TypeScript, строгая типизация
- Props interfaces для каждого компонента
- Разделение: UI-компоненты в `/components/ui`, бизнес-компоненты в `/components/features`
- Кастомные хуки для логики: `useSearch`, `useFavorites`, `useCompare`, `useFilters`
- Никаких inline-стилей — только Tailwind классы
- Адаптивность на всех брейкпоинтах
- Accessibility: aria-labels, keyboard navigation, focus-visible стили
- Никаких console.log в production коде

---

## Чего избегать

- Не делать одинаковые серые блоки по всей странице
- Не использовать border везде где можно обойтись whitespace
- Не делать кнопки с border-radius: 0
- Не делать padding меньше 12px у интерактивных элементов
- Не игнорировать hover/focus/active состояния
- Не использовать дефолтные HTML-элементы без кастомного стиля
- Не забывать mobile breakpoints
- Не хардкодить данные — всё через props и API
