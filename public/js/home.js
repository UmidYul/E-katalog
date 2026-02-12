async function initHome() {
  const [{ items }, shops] = await Promise.all([
    api('/api/products?sort=popular'),
    api('/api/shops')
  ]);

  qs('#statsProducts').textContent = items.length;
  qs('#statsShops').textContent = shops.length;
  const avg = (items.reduce((sum, p) => sum + p.rating, 0) / items.length).toFixed(1);
  qs('#statsRating').textContent = `${avg} / 5`;

  qs('#featured').innerHTML = items.slice(0, 4).map(productCard).join('');
  bindCompareButtons(qs('#featured'));
}

initHome();
