const phones = [
  {
    id: 'iphone-15-pro',
    brand: 'Apple',
    model: 'iPhone 15 Pro',
    slug: 'apple-iphone-15-pro',
    image: 'https://images.unsplash.com/photo-1592286646408-90b753f2d0f0?auto=format&fit=crop&w=800&q=80',
    memory: ['128 GB', '256 GB', '512 GB'],
    colors: ['Titanium', 'Blue', 'Black'],
    specs: {
      display: '6.1" OLED, 120Hz',
      chipset: 'Apple A17 Pro',
      camera: '48 MP + 12 MP + 12 MP',
      battery: '3274 mAh',
      os: 'iOS 18'
    },
    offers: [
      { store: 'Asaxiy', price: 12500000, inStock: true, delivery: '1-2 дня', url: '#' },
      { store: 'Texnomart', price: 12799000, inStock: true, delivery: 'Сегодня', url: '#' },
      { store: 'Olcha', price: 12950000, inStock: false, delivery: 'Предзаказ', url: '#' }
    ],
    priceHistory: [13200000, 13050000, 12900000, 12750000, 12500000]
  },
  {
    id: 'galaxy-s24',
    brand: 'Samsung',
    model: 'Galaxy S24',
    slug: 'samsung-galaxy-s24',
    image: 'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=800&q=80',
    memory: ['128 GB', '256 GB'],
    colors: ['Black', 'Violet', 'Yellow'],
    specs: {
      display: '6.2" Dynamic AMOLED 2X, 120Hz',
      chipset: 'Exynos 2400',
      camera: '50 MP + 12 MP + 10 MP',
      battery: '4000 mAh',
      os: 'Android 15'
    },
    offers: [
      { store: 'Texnomart', price: 9800000, inStock: true, delivery: '1-2 дня', url: '#' },
      { store: 'Olcha', price: 9990000, inStock: true, delivery: 'Сегодня', url: '#' },
      { store: 'Beemarket', price: 10150000, inStock: true, delivery: '2-3 дня', url: '#' }
    ],
    priceHistory: [10700000, 10550000, 10300000, 9990000, 9800000]
  },
  {
    id: 'xiaomi-14',
    brand: 'Xiaomi',
    model: 'Xiaomi 14',
    slug: 'xiaomi-14',
    image: 'https://images.unsplash.com/photo-1616410011236-7a42121dd981?auto=format&fit=crop&w=800&q=80',
    memory: ['256 GB', '512 GB'],
    colors: ['Green', 'White', 'Black'],
    specs: {
      display: '6.36" LTPO AMOLED, 120Hz',
      chipset: 'Snapdragon 8 Gen 3',
      camera: '50 MP + 50 MP + 50 MP',
      battery: '4610 mAh',
      os: 'HyperOS'
    },
    offers: [
      { store: 'Asaxiy', price: 8600000, inStock: true, delivery: 'Завтра', url: '#' },
      { store: 'Olcha', price: 8790000, inStock: true, delivery: '1-2 дня', url: '#' },
      { store: 'Toptop', price: 8940000, inStock: true, delivery: 'Самовывоз', url: '#' }
    ],
    priceHistory: [9200000, 9050000, 8900000, 8790000, 8600000]
  },
  {
    id: 'pixel-8',
    brand: 'Google',
    model: 'Pixel 8',
    slug: 'google-pixel-8',
    image: 'https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=800&q=80',
    memory: ['128 GB', '256 GB'],
    colors: ['Rose', 'Obsidian', 'Hazel'],
    specs: {
      display: '6.2" OLED, 120Hz',
      chipset: 'Google Tensor G3',
      camera: '50 MP + 12 MP',
      battery: '4575 mAh',
      os: 'Android 15'
    },
    offers: [
      { store: 'Toptop', price: 7800000, inStock: true, delivery: '1-2 дня', url: '#' },
      { store: 'Texnomart', price: 7990000, inStock: false, delivery: 'Нет в наличии', url: '#' },
      { store: 'Olcha', price: 8050000, inStock: true, delivery: 'Завтра', url: '#' }
    ],
    priceHistory: [8400000, 8250000, 8100000, 7990000, 7800000]
  }
];

const formatPrice = (value) => new Intl.NumberFormat('ru-RU').format(value) + ' сум';

const minOfferPrice = (phone) => Math.min(...phone.offers.map((offer) => offer.price));

module.exports = { phones, formatPrice, minOfferPrice };
