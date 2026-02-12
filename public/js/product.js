async function initProductPage() {
  const id = new URLSearchParams(location.search).get('id');
  const productRes = await fetch(`/api/products/${id}`);

  if (!productRes.ok) {
    document.querySelector('#productPage').innerHTML = '<p>Товар не найден.</p>';
    return;
  }

  const product = await productRes.json();
  const shops = await (await fetch('/api/shops')).json();
  const reviews = await (await fetch(`/api/reviews/${id}`)).json();

  const offers = product.shopOffers.map((offer) => {
    const shop = shops.find((s) => s.id === offer.shopId);
    return `<li>${shop.name}: <strong>${formatUZS(offer.price)}</strong> ${offer.stock ? '✅ в наличии' : '⏳ под заказ'}</li>`;
  }).join('');

  const reviewsHtml = reviews.map((r) => `
    <div class="review">
      <strong>${r.user}</strong> • ${'⭐'.repeat(r.rating)}
      <p>${r.text}</p>
    </div>
  `).join('');

  document.querySelector('#productPage').innerHTML = `
    <div class="card">
      <img src="${product.image}" alt="${product.name}" style="max-width:340px; width:100%; border-radius:12px;"/>
      <h1>${product.name}</h1>
      <p class="price">${formatUZS(product.price)}</p>
      <p class="meta">${product.display} • ${product.ram} • ${product.storage} • ${product.battery}</p>
      <button class="btn secondary" onclick="addToCompare(${product.id})">Добавить в сравнение</button>
    </div>

    <div class="card" style="margin-top:14px;">
      <h2>Цены по магазинам</h2>
      <ul>${offers}</ul>
    </div>

    <div class="card" style="margin-top:14px;">
      <h2>Отзывы</h2>
      ${reviewsHtml || '<p>Пока нет отзывов.</p>'}
    </div>
  `;
}

initProductPage();
