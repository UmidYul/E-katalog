const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const shops = [
  { id: 1, name: 'Texnomart', rating: 4.8, city: 'Tashkent', delivery: ['Tashkent', 'Samarkand', 'Namangan'], pickup: true },
  { id: 2, name: 'Media Park', rating: 4.7, city: 'Tashkent', delivery: ['Tashkent', 'Bukhara', 'Nukus'], pickup: true },
  { id: 3, name: 'Goodzone', rating: 4.5, city: 'Samarkand', delivery: ['Samarkand', 'Tashkent', 'Fergana'], pickup: false },
  { id: 4, name: 'Asaxiy Market', rating: 4.6, city: 'Andijan', delivery: ['Andijan', 'Tashkent', 'Khiva'], pickup: true }
];

const products = [
  {
    id: 1001,
    slug: 'samsung-galaxy-s24-256',
    name: 'Samsung Galaxy S24 256GB',
    brand: 'Samsung',
    price: 10990000,
    oldPrice: 11500000,
    rating: 4.8,
    reviewsCount: 126,
    inStock: true,
    display: '6.2" AMOLED 120Hz',
    processor: 'Exynos 2400',
    ram: 8,
    storage: 256,
    battery: 4000,
    camera: '50+12+10 MP',
    os: 'Android 14',
    image: '/assets/s24.svg',
    colors: ['Black', 'Violet', 'Gray'],
    tags: ['5G', 'eSIM', 'NFC'],
    offers: [
      { shopId: 1, price: 10990000, stock: true },
      { shopId: 2, price: 11150000, stock: true },
      { shopId: 3, price: 11290000, stock: false }
    ]
  },
  {
    id: 1002,
    slug: 'iphone-15-128',
    name: 'iPhone 15 128GB',
    brand: 'Apple',
    price: 12490000,
    oldPrice: 12990000,
    rating: 4.9,
    reviewsCount: 178,
    inStock: true,
    display: '6.1" Super Retina',
    processor: 'A16 Bionic',
    ram: 6,
    storage: 128,
    battery: 3349,
    camera: '48+12 MP',
    os: 'iOS 18',
    image: '/assets/iphone15.svg',
    colors: ['Blue', 'Black', 'Pink'],
    tags: ['5G', 'Face ID', 'NFC'],
    offers: [
      { shopId: 1, price: 12490000, stock: true },
      { shopId: 2, price: 12540000, stock: true },
      { shopId: 4, price: 12600000, stock: true }
    ]
  },
  {
    id: 1003,
    slug: 'xiaomi-14-256',
    name: 'Xiaomi 14 256GB',
    brand: 'Xiaomi',
    price: 8890000,
    oldPrice: 9390000,
    rating: 4.7,
    reviewsCount: 89,
    inStock: true,
    display: '6.36" AMOLED 120Hz',
    processor: 'Snapdragon 8 Gen 3',
    ram: 12,
    storage: 256,
    battery: 4610,
    camera: '50+50+50 MP',
    os: 'HyperOS',
    image: '/assets/xiaomi14.svg',
    colors: ['Green', 'Black', 'White'],
    tags: ['5G', 'NFC', 'Fast charge'],
    offers: [
      { shopId: 2, price: 8890000, stock: true },
      { shopId: 3, price: 8990000, stock: true },
      { shopId: 4, price: 9050000, stock: false }
    ]
  },
  {
    id: 1004,
    slug: 'redmi-note-13-pro-plus',
    name: 'Redmi Note 13 Pro+ 512GB',
    brand: 'Xiaomi',
    price: 5390000,
    oldPrice: 5750000,
    rating: 4.5,
    reviewsCount: 64,
    inStock: true,
    display: '6.67" AMOLED 120Hz',
    processor: 'Dimensity 7200 Ultra',
    ram: 12,
    storage: 512,
    battery: 5000,
    camera: '200+8+2 MP',
    os: 'HyperOS',
    image: '/assets/redmi13.svg',
    colors: ['Purple', 'Black'],
    tags: ['5G', '120W'],
    offers: [
      { shopId: 1, price: 5450000, stock: true },
      { shopId: 3, price: 5390000, stock: true },
      { shopId: 4, price: 5490000, stock: true }
    ]
  },
  {
    id: 1005,
    slug: 'samsung-a55-256',
    name: 'Samsung Galaxy A55 256GB',
    brand: 'Samsung',
    price: 5890000,
    oldPrice: 6200000,
    rating: 4.6,
    reviewsCount: 71,
    inStock: false,
    display: '6.6" AMOLED 120Hz',
    processor: 'Exynos 1480',
    ram: 8,
    storage: 256,
    battery: 5000,
    camera: '50+12+5 MP',
    os: 'Android 14',
    image: '/assets/a55.svg',
    colors: ['Ice Blue', 'Navy'],
    tags: ['5G', 'IP67'],
    offers: [
      { shopId: 2, price: 5890000, stock: false },
      { shopId: 4, price: 5950000, stock: true }
    ]
  },
  {
    id: 1006,
    slug: 'honor-200-512',
    name: 'Honor 200 512GB',
    brand: 'Honor',
    price: 6790000,
    oldPrice: 7150000,
    rating: 4.4,
    reviewsCount: 38,
    inStock: true,
    display: '6.7" OLED 120Hz',
    processor: 'Snapdragon 7 Gen 3',
    ram: 12,
    storage: 512,
    battery: 5200,
    camera: '50+12+50 MP',
    os: 'MagicOS 8',
    image: '/assets/honor200.svg',
    colors: ['Moonlight White', 'Black'],
    tags: ['5G', 'NFC'],
    offers: [
      { shopId: 1, price: 6790000, stock: true },
      { shopId: 3, price: 6850000, stock: true }
    ]
  }
];

const reviews = {
  1001: [
    { user: 'Aziz', rating: 5, text: 'Flagman, juda tez ishlaydi. Kamera zo‘r.' },
    { user: 'Sabina', rating: 4, text: 'Yaxshi telefon, ammo narx balandroq.' }
  ],
  1002: [
    { user: 'Sherzod', rating: 5, text: 'iOS animatsiyasi va kamera juda yoqdi.' },
    { user: 'Madina', rating: 5, text: 'Kompakt va premium his.' }
  ],
  1003: [{ user: 'Temur', rating: 5, text: 'Narxiga nisbatan top variant.' }],
  1004: [{ user: 'Dilshod', rating: 4, text: 'Ajoyib ekran va tez zaryad.' }],
  1005: [{ user: 'Diyora', rating: 4, text: 'Yaxshi o‘rta segment.' }],
  1006: [{ user: 'Rustam', rating: 4, text: 'Dizayni chiroyli, kamera yaxshi.' }]
};

app.get('/api/meta', (_req, res) => {
  const brands = [...new Set(products.map((p) => p.brand))].sort();
  res.json({
    brands,
    priceRange: {
      min: Math.min(...products.map((p) => p.price)),
      max: Math.max(...products.map((p) => p.price))
    },
    ramOptions: [...new Set(products.map((p) => p.ram))].sort((a, b) => a - b),
    storageOptions: [...new Set(products.map((p) => p.storage))].sort((a, b) => a - b)
  });
});

app.get('/api/products', (req, res) => {
  const {
    q,
    brand,
    minPrice,
    maxPrice,
    minRam,
    minStorage,
    inStock,
    sort = 'popular'
  } = req.query;

  let list = [...products];

  if (q) {
    const term = String(q).toLowerCase();
    list = list.filter((p) => p.name.toLowerCase().includes(term));
  }
  if (brand) {
    const set = String(brand).split(',').filter(Boolean);
    list = list.filter((p) => set.includes(p.brand));
  }
  if (minPrice) list = list.filter((p) => p.price >= Number(minPrice));
  if (maxPrice) list = list.filter((p) => p.price <= Number(maxPrice));
  if (minRam) list = list.filter((p) => p.ram >= Number(minRam));
  if (minStorage) list = list.filter((p) => p.storage >= Number(minStorage));
  if (inStock === 'true') list = list.filter((p) => p.inStock);

  const sortMap = {
    popular: (a, b) => b.reviewsCount - a.reviewsCount,
    price_asc: (a, b) => a.price - b.price,
    price_desc: (a, b) => b.price - a.price,
    rating_desc: (a, b) => b.rating - a.rating,
    newest: (a, b) => b.id - a.id
  };

  list.sort(sortMap[sort] || sortMap.popular);

  res.json({
    total: list.length,
    items: list
  });
});

app.get('/api/products/:id', (req, res) => {
  const product = products.find((item) => item.id === Number(req.params.id));
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.json(product);
});

app.get('/api/shops', (_req, res) => {
  const withStats = shops.map((shop) => {
    const offers = products.flatMap((p) => p.offers.filter((o) => o.shopId === shop.id));
    return {
      ...shop,
      offersCount: offers.length,
      stockCount: offers.filter((o) => o.stock).length
    };
  });

  res.json(withStats);
});

app.get('/api/reviews/:productId', (req, res) => {
  res.json(reviews[Number(req.params.productId)] || []);
});

app.post('/api/register', (req, res) => {
  const { name, email, password, language } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Заполните обязательные поля.' });
  }

  return res.status(201).json({
    message: 'Пользователь создан (demo режим).',
    profile: {
      id: Date.now(),
      name,
      email,
      language: language || 'ru'
    }
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`E-katalog demo listening at http://localhost:${PORT}`);
});
