# E-katalog UZ Demo

Современный минималистичный прототип фронтенда e-katalog под рынок Узбекистана.

## Включено
- Полный набор страниц: главная, каталог, карточка товара, сравнение, магазины, регистрация.
- Продвинутые фильтры каталога: поиск, бренд, RAM, память, цена, наличие, сортировка.
- RU/UZ переключение текстов в каталоге.
- Демонстрационные данные по смартфонам и магазинам.
- Минимальный backend на Express.js для работы UI.

## API
- `GET /api/meta`
- `GET /api/products`
- `GET /api/products/:id`
- `GET /api/shops`
- `GET /api/reviews/:productId`
- `POST /api/register`

## Запуск
```bash
npm install
npm start
```

Откройте `http://localhost:3000`
