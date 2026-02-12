const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const shops = [
  { id: 1, name: 'TechnoMarket UZ', rating: 4.7, city: 'Tashkent', delivery: ['Tashkent', 'Samarkand', 'Bukhara'] },
  { id: 2, name: 'SmartChoice', rating: 4.5, city: 'Samarkand', delivery: ['Tashkent', 'Samarkand'] },
  { id: 3, name: 'Mobile Hub', rating: 4.3, city: 'Bukhara', delivery: ['Tashkent', 'Bukhara', 'Nukus'] }
];

const products = [
  {
    id: 101,
    name: 'Samsung Galaxy S24 256GB',
    brand: 'Samsung',
    price: 11300000,
    rating: 4.8,
    display: '6.2" AMOLED',
    ram: '8 GB',
    storage: '256 GB',
    battery: '4000 mAh',
    image: 'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?auto=format&fit=crop&w=600&q=80',
    shopOffers: [
      { shopId: 1, price: 11300000, stock: true },
      { shopId: 2, price: 11150000, stock: true },
      { shopId: 3, price: 11420000, stock: false }
    ]
  },
  {
    id: 102,
    name: 'iPhone 15 128GB',
    brand: 'Apple',
    price: 12650000,
    rating: 4.9,
    display: '6.1" OLED',
    ram: '6 GB',
    storage: '128 GB',
    battery: '3349 mAh',
    image: 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?auto=format&fit=crop&w=600&q=80',
    shopOffers: [
      { shopId: 1, price: 12650000, stock: true },
      { shopId: 2, price: 12590000, stock: true },
      { shopId: 3, price: 12720000, stock: true }
    ]
  },
  {
    id: 103,
    name: 'Xiaomi 14 256GB',
    brand: 'Xiaomi',
    price: 8990000,
    rating: 4.6,
    display: '6.36" AMOLED',
    ram: '12 GB',
    storage: '256 GB',
    battery: '4610 mAh',
    image: 'https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=600&q=80',
    shopOffers: [
      { shopId: 1, price: 8990000, stock: true },
      { shopId: 2, price: 8850000, stock: false },
      { shopId: 3, price: 8920000, stock: true }
    ]
  }
];

const reviewsByProduct = {
  101: [
    { user: 'Ali', rating: 5, text: 'Kamera juda yaxshi, ishlashi tez.' },
    { user: 'Nodira', rating: 4, text: 'Batareya yaxshi, narxi biroz yuqori.' }
  ],
  102: [
    { user: 'Bekzod', rating: 5, text: 'Stabil ishlaydi, ekran sifati zo\'r.' }
  ],
  103: [
    { user: 'Umida', rating: 4, text: 'Narx/sifat nisbati yaxshi variant.' }
  ]
};

app.get('/api/products', (req, res) => {
  const { brand } = req.query;
  const filtered = brand ? products.filter((p) => p.brand.toLowerCase() === String(brand).toLowerCase()) : products;
  res.json(filtered);
});

app.get('/api/products/:id', (req, res) => {
  const product = products.find((p) => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.json(product);
});

app.get('/api/shops', (_, res) => res.json(shops));

app.get('/api/reviews/:productId', (req, res) => {
  const productId = Number(req.params.productId);
  res.json(reviewsByProduct[productId] || []);
});

app.post('/api/register', (req, res) => {
  const { name, email, password, language } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'All required fields must be filled.' });
  }
  res.status(201).json({
    message: 'Registration successful (demo mode)',
    profile: {
      id: Date.now(),
      name,
      email,
      language: language || 'ru'
    }
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`E-katalog demo running on http://localhost:${PORT}`);
});
