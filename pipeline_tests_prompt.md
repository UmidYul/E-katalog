# Промпт: Тесты для скрапер-пайплайна e-catalog

## Роль
Ты senior Python-разработчик со специализацией в data engineering и NLP пайплайнах. Ты пишешь production-grade тесты: исчерпывающие, с реалистичными мок-данными, с метриками качества и подробными отчётами.

---

## Задача
Написать полный тестовый suite для пайплайна обработки товаров e-catalog агрегатора. Пайплайн включает:
1. Нормализацию названий товаров
2. Блокировку (группировку кандидатов)
3. Матчинг (нечёткий + TF-IDF + семантический)
4. Дедупликацию
5. Канонизацию (сборку единой карточки)

Тесты должны работать на **большом объёме мок-данных** и выдавать **метрики качества** по каждому этапу.

---

## Структура тестов

```
tests/
├── conftest.py                  # фикстуры и мок-данные
├── data/
│   └── mock_products.py         # 200+ товаров с разных "сайтов"
├── unit/
│   ├── test_normalization.py    # юнит-тесты нормализации
│   ├── test_blocking.py         # юнит-тесты блокировки
│   ├── test_matching.py         # юнит-тесты матчинга
│   └── test_canonicalization.py # юнит-тесты канонизации
├── integration/
│   ├── test_pipeline.py         # полный пайплайн end-to-end
│   └── test_quality_metrics.py  # метрики качества на всём датасете
└── reports/
    └── quality_report.py        # генерация отчёта
```

---

## Мок-данные (mock_products.py)

Сгенерируй **минимум 200 товарных записей** симулирующих данные с 6 разных сайтов. Каждая запись:

```python
{
    "id": "site1_001",
    "source": "site1.uz",
    "title": "...",
    "price": 0,
    "url": "https://...",
    "category": "...",
    "brand": "...",
    "image": "https://..."
}
```

### Категории и бренды для генерации:

**Смартфоны (60 записей):**
- Samsung Galaxy S24 128GB — 5 вариантов с разных сайтов
- Samsung Galaxy S24 256GB — 4 варианта
- iPhone 15 128GB — 5 вариантов
- iPhone 15 Pro 256GB — 4 варианта
- Xiaomi Redmi Note 13 — 4 варианта
- Xiaomi 14 Pro — 3 варианта
- POCO X6 Pro — 3 варианта
- Realme 12 Pro+ — 3 варианта
- OnePlus 12 256GB — 3 варианта
- Huawei Nova 11 — 3 варианта

**Ноутбуки (40 записей):**
- Lenovo IdeaPad 3 15 i5 — 4 варианта
- ASUS VivoBook 15 — 4 варианта
- HP Pavilion 15 — 3 варианта
- Acer Aspire 5 — 3 варианта
- MacBook Air M2 — 4 варианта
- Dell Inspiron 15 — 3 варианта

**Наушники (30 записей):**
- Sony WH-1000XM5 — 4 варианта
- AirPods Pro 2 — 4 варианта
- Samsung Galaxy Buds2 Pro — 3 варианта
- JBL Tune 770NC — 3 варианта

**Планшеты (25 записей):**
- iPad Air 5 64GB — 4 варианта
- Samsung Galaxy Tab S9 — 3 варианта
- Xiaomi Pad 6 — 3 варианта

**Умные часы (20 записей):**
- Apple Watch Series 9 — 3 варианта
- Samsung Galaxy Watch6 — 3 варианта
- Xiaomi Band 8 — 3 варианта

**Шумовые записи (25 записей) — НЕ являются дубликатами:**
- Похожие названия но разные товары (S24 vs S24+, 128GB vs 256GB)
- Разные цвета (должны быть отдельными карточками)
- Аксессуары к товарам (чехол для S24 ≠ Samsung S24)

### Паттерны вариаций для каждого товара:

```python
# Для одного товара генерируй такие вариации:
VARIATION_PATTERNS = {
    "site1.uz": "{brand} {model} {memory}GB {color}",          # стандарт
    "site2.uz": "{BRAND} {MODEL} {memory} гб {color}",         # капс + кириллица
    "site3.uz": "Купить {brand} {model} {memory}гб официально",# стоп-слова
    "site4.uz": "{model} {brand} {memory}GB ({артикул})",       # перестановка + арт.
    "site5.uz": "{brand}-{model}-{memory}GB",                   # дефисы
    "site6.uz": "{brand} {model} [{memory}GB] скидка акция",   # мусор в скобках
}

# Цены — разные для каждого сайта (+/- 5-15% от базовой)
# Некоторые записи — намеренно битые (пустое название, None цена, кривой URL)
```

---

## Юнит-тесты нормализации (test_normalization.py)

### Группа 1: Базовая очистка
```python
# Каждый тест — конкретный input → ожидаемый output

def test_lowercase():
def test_remove_punctuation():
def test_remove_extra_spaces():
def test_strip_brackets_with_article():  # "(SM-S921B)" → убрать
def test_remove_url_params():
```

### Группа 2: Стоп-слова
```python
def test_remove_uzbek_stopwords():      # "sotib olish", "arzon"
def test_remove_russian_stopwords():    # "купить", "акция", "скидка"
def test_remove_english_stopwords():    # "buy", "official", "sale"
def test_preserve_important_words():    # "Pro", "Max", "Ultra" НЕ удалять
def test_stopwords_case_insensitive():
```

### Группа 3: Единицы измерения
```python
def test_normalize_gb_variants():       # "128 ГБ", "128гб", "128 GB", "128gb" → "128gb"
def test_normalize_mb_variants():
def test_normalize_tb_variants():
def test_normalize_mah_variants():      # "5000 мАч", "5000mAh" → "5000mah"
def test_normalize_inch_variants():     # '6.1"', "6.1 дюйм" → "6.1inch"
def test_normalize_mp_variants():       # "108 МП", "108mp" → "108mp"
```

### Группа 4: Мультиязычность
```python
def test_mixed_cyrillic_latin():        # "Самсунг Galaxy" → единое написание
def test_uzbek_latin_script():          # узбекский латиница
def test_unicode_normalization():       # NFKC нормализация
def test_transliteration_variants():    # если есть транслит
```

### Группа 5: Edge cases
```python
def test_empty_string():               # "" → ""
def test_none_input():                 # None → ""
def test_only_stopwords():             # "купить акция скидка" → ""
def test_very_long_title():            # 500+ символов
def test_special_characters_only():   # "!!!! *** ???" → ""
def test_numbers_only():              # "128 256 512"
def test_single_word():
```

### Группа 6: Производительность
```python
def test_normalize_1000_titles_under_1_second():
def test_normalize_idempotent():       # normalize(normalize(x)) == normalize(x)
```

---

## Юнит-тесты блокировки (test_blocking.py)

```python
def test_samsung_products_same_block():
    # Все Samsung товары попадают в блок "samsung"
    
def test_apple_iphone_same_block():
    # iPhone и MacBook — разные блоки? или один Apple?
    
def test_unknown_brand_fallback():
    # Товар без бренда → блок "unknown"
    
def test_block_sizes_reasonable():
    # Ни один блок не содержит >30% всех товаров (плохая блокировка)
    
def test_no_cross_brand_matches():
    # Samsung и Apple — никогда не в одном блоке

def test_blocking_coverage():
    # 100% товаров попадают в какой-то блок
    
def test_blocking_performance():
    # 10000 товаров разбиваются за <0.5 сек
```

---

## Юнит-тесты матчинга (test_matching.py)

### Должны совпадать (True Positives):
```python
SHOULD_MATCH = [
    ("Samsung Galaxy S24 128gb", "SAMSUNG Galaxy S24 128 ГБ"),
    ("iPhone 15 Pro 256gb", "Apple iPhone 15 Pro 256гб"),
    ("Sony WH-1000XM5", "Sony WH1000XM5 Wireless"),
    ("Lenovo IdeaPad 3 15 i5", "Lenovo IdeaPad 3 15ALC6 Intel i5"),
    ("MacBook Air M2 256gb", "Apple MacBook Air M2 256 гб 2023"),
    ("Xiaomi Redmi Note 13 128gb", "Redmi Note 13 128 ГБ Xiaomi"),
    ("AirPods Pro 2", "Apple AirPods Pro 2-го поколения"),
    ("Samsung Galaxy Buds2 Pro", "Самсунг Галакси Бадс2 Про"),
]

def test_should_match_pairs():
    for a, b in SHOULD_MATCH:
        score = matcher.score(normalize(a), normalize(b))
        assert score >= threshold, f"MISSED: '{a}' vs '{b}' → {score}"
```

### Не должны совпадать (True Negatives):
```python
SHOULD_NOT_MATCH = [
    ("Samsung Galaxy S24 128gb", "Samsung Galaxy S24 256gb"),  # разная память
    ("Samsung Galaxy S24", "Samsung Galaxy S24+"),             # разная модель
    ("iPhone 15", "iPhone 15 Pro"),                            # разная линейка
    ("iPad Air 5 64gb", "iPad Air 5 256gb"),                   # разный объём
    ("Samsung Galaxy S24", "Чехол для Samsung Galaxy S24"),    # аксессуар
    ("AirPods Pro 2", "AirPods 3"),                            # разное поколение
    ("Xiaomi 14", "Xiaomi 14 Pro"),                            # Pro версия
    ("Sony WH-1000XM5", "Sony WF-1000XM5"),                   # WH vs WF (разные)
]

def test_should_not_match_pairs():
    for a, b in SHOULD_NOT_MATCH:
        score = matcher.score(normalize(a), normalize(b))
        assert score < threshold, f"FALSE POSITIVE: '{a}' vs '{b}' → {score}"
```

### Пограничные случаи:
```python
BORDERLINE_CASES = [
    # Одинаковый товар, разные цвета — зависит от бизнес-логики
    ("Samsung Galaxy S24 128gb Black", "Samsung Galaxy S24 128gb White"),
    # Разные года одной модели
    ("MacBook Air M2 2023", "MacBook Air M2 2024"),
    # Bundle vs одиночный
    ("iPhone 15 128gb", "iPhone 15 128gb + AirPods"),
]

def test_borderline_cases_documented():
    # Для каждого случая — задокументировать решение пайплайна
    # Не assert True/False, а вывести score и пометить для ревью
```

---

## Юнит-тесты канонизации (test_canonicalization.py)

```python
def test_best_title_selection():
    # Из группы вариантов выбирается самое информативное название
    titles = [
        "Samsung S24",
        "Samsung Galaxy S24 128GB черный",
        "Samsung Galaxy S24 128gb",
    ]
    # Ожидаем: "Samsung Galaxy S24 128GB черный" (самое длинное/полное)

def test_price_aggregation():
    # min_price / max_price / средняя цена корректны
    prices = [79990, 81000, 78500, 82000]
    assert card['min_price'] == 78500
    assert card['max_price'] == 82000

def test_sources_deduplicated():
    # Если один сайт дал 2 оффера — источник считается 1 раз

def test_image_selection():
    # Берётся первое непустое изображение

def test_canonical_with_none_prices():
    # Некоторые офферы без цены — не ломают агрегацию

def test_canonical_single_item():
    # Группа из 1 товара — тоже корректная карточка

def test_canonical_large_group():
    # Группа из 10 офферов — все поля корректны

def test_urls_all_collected():
    # Все URL из группы собраны в карточку
```

---

## Интеграционные тесты (test_pipeline.py)

```python
def test_full_pipeline_on_mock_dataset():
    """
    Прогоняет весь датасет 200+ товаров через полный пайплайн.
    Проверяет что на выходе разумное количество карточек.
    """
    df = load_mock_products()  # 200+ записей
    cards, result_df = run_pipeline(df, brands=KNOWN_BRANDS)
    
    # Базовые проверки
    assert len(cards) > 0
    assert len(cards) < len(df)           # есть схлопывания
    assert result_df['cluster_id'].notna().all()  # все получили cluster
    
    # Все исходные товары сохранены
    assert len(result_df) == len(df)

def test_pipeline_handles_dirty_data():
    """Пайплайн не падает на битых данных."""
    dirty_records = [
        {"title": None, "source": "site1", "price": 100},
        {"title": "", "source": "site2", "price": None},
        {"title": "   ", "source": "site3", "price": -1},
        {"title": "A" * 1000, "source": "site4", "price": 99},  # очень длинное
    ]
    df = pd.DataFrame(dirty_records)
    cards, _ = run_pipeline(df, brands=[])
    assert len(cards) >= 0  # не упало

def test_pipeline_deterministic():
    """Одинаковый input → одинаковый output при повторных запусках."""
    df = load_mock_products()
    cards1, _ = run_pipeline(df, brands=KNOWN_BRANDS)
    cards2, _ = run_pipeline(df, brands=KNOWN_BRANDS)
    
    cluster_ids1 = sorted([c['cluster_id'] for c in cards1])
    cluster_ids2 = sorted([c['cluster_id'] for c in cards2])
    assert cluster_ids1 == cluster_ids2

def test_pipeline_performance_200_items():
    """200 товаров обрабатываются быстро."""
    import time
    df = load_mock_products()
    
    start = time.time()
    run_pipeline(df, brands=KNOWN_BRANDS, use_semantic=False)
    elapsed = time.time() - start
    
    assert elapsed < 10, f"Pipeline took {elapsed:.1f}s — too slow"

def test_pipeline_performance_1000_items():
    """1000 товаров — стресс-тест."""
    df = generate_scaled_dataset(n=1000)
    
    start = time.time()
    run_pipeline(df, brands=KNOWN_BRANDS, use_semantic=False)
    elapsed = time.time() - start
    
    assert elapsed < 60, f"Pipeline took {elapsed:.1f}s on 1000 items"
```

---

## Метрики качества (test_quality_metrics.py)

Это самый важный файл. Считает реальные метрики на ground truth данных.

```python
# Ground truth: для каждой записи знаем правильный cluster_id
GROUND_TRUTH = {
    "site1_samsung_s24_128": "canonical_samsung_s24_128",
    "site2_samsung_s24_128": "canonical_samsung_s24_128",
    "site3_samsung_s24_128": "canonical_samsung_s24_128",
    "site1_iphone15_128":    "canonical_iphone_15_128",
    # ... и так для всех 200 записей
}

def calculate_metrics(predicted_clusters, ground_truth):
    """
    Считает:
    - Precision: из того что объединили, сколько правильно
    - Recall: из того что должны были объединить, сколько нашли
    - F1: гармоническое среднее
    - False Positive Rate: сколько разных товаров ошибочно объединили
    - False Negative Rate: сколько одинаковых товаров не нашли
    """
    ...

def test_precision_above_threshold():
    """Precision >= 0.90 — мало ложных объединений."""
    _, result_df = run_pipeline(load_mock_products(), brands=KNOWN_BRANDS)
    metrics = calculate_metrics(result_df, GROUND_TRUTH)
    
    assert metrics['precision'] >= 0.90, (
        f"Precision {metrics['precision']:.2f} < 0.90\n"
        f"False positives: {metrics['false_positives']}"
    )

def test_recall_above_threshold():
    """Recall >= 0.85 — большинство дубликатов найдено."""
    _, result_df = run_pipeline(load_mock_products(), brands=KNOWN_BRANDS)
    metrics = calculate_metrics(result_df, GROUND_TRUTH)
    
    assert metrics['recall'] >= 0.85, (
        f"Recall {metrics['recall']:.2f} < 0.85\n"
        f"Missed pairs: {metrics['false_negatives']}"
    )

def test_f1_above_threshold():
    """F1 >= 0.87."""
    _, result_df = run_pipeline(load_mock_products(), brands=KNOWN_BRANDS)
    metrics = calculate_metrics(result_df, GROUND_TRUTH)
    assert metrics['f1'] >= 0.87

def test_no_cross_category_merges():
    """Смартфон никогда не объединяется с ноутбуком."""
    _, result_df = run_pipeline(load_mock_products(), brands=KNOWN_BRANDS)
    
    for cluster_id, group in result_df.groupby('cluster_id'):
        categories = group['category'].unique()
        assert len(categories) == 1, (
            f"Cluster {cluster_id} contains multiple categories: {categories}\n"
            f"Products: {group['title'].tolist()}"
        )

def test_memory_variants_not_merged():
    """128GB и 256GB версии одного телефона — разные карточки."""
    records = [
        {"title": "Samsung Galaxy S24 128gb", "source": "s1", "price": 79000, "category": "phones"},
        {"title": "Samsung Galaxy S24 128 ГБ", "source": "s2", "price": 78000, "category": "phones"},
        {"title": "Samsung Galaxy S24 256gb", "source": "s3", "price": 89000, "category": "phones"},
        {"title": "Samsung Galaxy S24 256 GB", "source": "s4", "price": 88000, "category": "phones"},
    ]
    df = pd.DataFrame(records)
    cards, _ = run_pipeline(df, brands=["Samsung"])
    
    assert len(cards) == 2, f"Expected 2 cards (128/256), got {len(cards)}"

def test_accessory_not_merged_with_product():
    """Чехол для товара ≠ сам товар."""
    records = [
        {"title": "Samsung Galaxy S24 128gb", "source": "s1", "price": 79000},
        {"title": "Чехол для Samsung Galaxy S24", "source": "s2", "price": 1500},
        {"title": "Case for Samsung Galaxy S24", "source": "s3", "price": 1200},
    ]
    df = pd.DataFrame(records)
    cards, _ = run_pipeline(df, brands=["Samsung"])
    
    assert len(cards) >= 2, "Accessory should not merge with product"

def test_pro_vs_base_not_merged():
    """Base модель и Pro — разные карточки."""
    records = [
        {"title": "iPhone 15 128gb", "source": "s1", "price": 99000},
        {"title": "iPhone 15 128 ГБ", "source": "s2", "price": 98000},
        {"title": "iPhone 15 Pro 128gb", "source": "s3", "price": 129000},
        {"title": "iPhone 15 Pro 128 ГБ", "source": "s4", "price": 128000},
    ]
    df = pd.DataFrame(records)
    cards, _ = run_pipeline(df, brands=["Apple", "iPhone"])
    
    assert len(cards) == 2, f"Expected 2 cards (15/15Pro), got {len(cards)}"
```

---

## Отчёт о качестве (quality_report.py)

```python
def generate_quality_report(df_original, cards, result_df, ground_truth):
    """
    Генерирует подробный текстовый отчёт:
    
    === PIPELINE QUALITY REPORT ===
    
    INPUT STATS:
      Total products:      200
      Unique sources:      6
      Categories:          5
      Known duplicates:    87 groups
    
    OUTPUT STATS:
      Canonical cards:     54
      Products collapsed:  146 (73%)
      Avg offers/card:     3.7
      Max offers/card:     6 (Samsung Galaxy S24 128GB)
    
    QUALITY METRICS:
      Precision:    0.94  ✅ (threshold: 0.90)
      Recall:       0.88  ✅ (threshold: 0.85)
      F1 Score:     0.91  ✅ (threshold: 0.87)
    
    FALSE POSITIVES (неверно объединённые):
      [cluster_12] "iPhone 15 128GB" + "iPhone 15 Pro 128GB" — score: 0.84
      ...
    
    FALSE NEGATIVES (пропущенные дубликаты):
      "Sony WH-1000XM5" (site3) не объединён с группой — score: 0.79
      ...
    
    NORMALIZATION STATS:
      Avg tokens removed per title: 1.3
      Most common removed words: купить(23), акция(18), официальный(15)
    
    PERFORMANCE:
      Normalization:    0.04s
      Blocking:         0.01s  → 8 blocks, avg size 25
      Matching:         3.21s
      Clustering:       0.02s
      Total:            3.28s
    
    RECOMMENDATIONS:
      ⚠️  Снизить порог с 0.88 до 0.84 — пропускает 3 очевидных совпадения
      ⚠️  Добавить "Pro" в список антисловосочетаний (не мёрджить base↔Pro)
    """
```

---

## Конфигурация pytest

```ini
# pytest.ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -v --tb=short --durations=10
markers =
    unit: быстрые юнит-тесты
    integration: интеграционные тесты (медленнее)
    quality: метрики качества
    slow: тесты >5 секунд
```

```python
# conftest.py — фикстуры
import pytest
import pandas as pd
from tests.data.mock_products import MOCK_PRODUCTS, GROUND_TRUTH, KNOWN_BRANDS

@pytest.fixture(scope="session")
def mock_df():
    return pd.DataFrame(MOCK_PRODUCTS)

@pytest.fixture(scope="session")  
def pipeline_results(mock_df):
    cards, result_df = run_pipeline(mock_df, brands=KNOWN_BRANDS, use_semantic=False)
    return cards, result_df

@pytest.fixture
def sample_titles():
    return [p['title'] for p in MOCK_PRODUCTS]
```

---

## Требования к реализации

1. **Все мок-данные в одном файле** `mock_products.py` — легко расширять
2. **Ground truth явный** — для каждой записи прописан правильный canonical_id
3. **Тесты независимы** — каждый test_ работает без других
4. **Failure messages информативны** — при падении видно КАКИЕ конкретно записи не совпали
5. **Параметризация** через `@pytest.mark.parametrize` для SHOULD_MATCH / SHOULD_NOT_MATCH
6. **Запуск по маркерам**: `pytest -m unit` — быстро, `pytest -m quality` — полный прогон
7. **Финальная команда** `python -m tests.reports.quality_report` генерирует читаемый отчёт в консоль

---

## Вот мой код пайплайна: [вставь свой pipeline код]
