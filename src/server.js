const path = require('path');
const express = require('express');
const { phones, formatPrice, minOfferPrice } = require('./data/catalog');

const app = express();
const PORT = process.env.PORT || 3000;
const COMPARE_LIMIT = 4;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

const enrichPhone = (phone) => ({
  ...phone,
  minPrice: minOfferPrice(phone),
  minPriceText: formatPrice(minOfferPrice(phone)),
  offersCount: phone.offers.length
});

app.get('/', (req, res) => {
  const topDeals = phones
    .map(enrichPhone)
    .sort((a, b) => a.minPrice - b.minPrice)
    .slice(0, 3);

  const brands = [...new Set(phones.map((phone) => phone.brand))];
  res.render('home', { topDeals, brands, totalModels: phones.length });
});

app.get('/catalog', (req, res) => {
  const { q = '', brand = '', sort = 'popular' } = req.query;

  let filtered = phones.filter((phone) => {
    const queryMatch = `${phone.brand} ${phone.model}`.toLowerCase().includes(q.toLowerCase());
    const brandMatch = brand ? phone.brand === brand : true;
    return queryMatch && brandMatch;
  });

  if (sort === 'price_asc') {
    filtered = filtered.sort((a, b) => minOfferPrice(a) - minOfferPrice(b));
  } else if (sort === 'price_desc') {
    filtered = filtered.sort((a, b) => minOfferPrice(b) - minOfferPrice(a));
  }

  const brands = [...new Set(phones.map((phone) => phone.brand))];
  res.render('catalog', {
    phones: filtered.map(enrichPhone),
    brands,
    filters: { q, brand, sort }
  });
});

app.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const results = q
    ? phones.filter((phone) => `${phone.brand} ${phone.model}`.toLowerCase().includes(q.toLowerCase()))
    : [];

  res.render('search', {
    query: q,
    results: results.map(enrichPhone),
    suggestions: phones.slice(0, 4).map((phone) => `${phone.brand} ${phone.model}`)
  });
});

app.get('/phone/:slug', (req, res) => {
  const phone = phones.find((item) => item.slug === req.params.slug);
  if (!phone) {
    return res.status(404).render('not-found');
  }

  const offersSorted = [...phone.offers].sort((a, b) => a.price - b.price).map((offer) => ({
    ...offer,
    priceText: formatPrice(offer.price)
  }));

  const cheapest = offersSorted[0];

  return res.render('phone', {
    phone,
    offers: offersSorted,
    cheapest,
    history: phone.priceHistory.map(formatPrice)
  });
});

app.get('/compare', (req, res) => {
  const selected = String(req.query.items || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, COMPARE_LIMIT);

  const compared = selected
    .map((slug) => phones.find((phone) => phone.slug === slug))
    .filter(Boolean)
    .map(enrichPhone);

  const allPhones = phones.map(enrichPhone);

  res.render('compare', {
    compared,
    allPhones,
    limit: COMPARE_LIMIT,
    selected
  });
});

app.get('/about', (req, res) => {
  res.render('about');
});

app.use((req, res) => {
  res.status(404).render('not-found');
});

app.listen(PORT, () => {
  console.log(`E-Katalog app running on http://localhost:${PORT}`);
});
