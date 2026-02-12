async function initProduct() {
  const id = new URLSearchParams(location.search).get('id');

  try {
    const [product, shops, productReviews] = await Promise.all([
      api(`/api/products/${id}`),
      api('/api/shops'),
      api(`/api/reviews/${id}`)
    ]);

    const offers = product.offers
      .map((offer) => {
        const shop = shops.find((item) => item.id === offer.shopId);
        const stock = offer.stock ? '<span class="badge success">В наличии</span>' : '<span class="badge warn">Под заказ</span>';
        return `<li class="list-item"><strong>${shop.name}</strong> — ${formatUZS(offer.price)} ${stock}</li>`;
      })
      .join('');

    const reviews = productReviews.length
      ? productReviews
          .map((review) => `<li class="list-item"><strong>${review.user}</strong> • ${'★'.repeat(review.rating)}<br>${review.text}</li>`)
          .join('')
      : '<li class="list-item">Отзывов пока нет.</li>';

    qs('#productRoot').innerHTML = `
      <section class="panel" style="display:grid; grid-template-columns:minmax(280px,380px) 1fr; gap:20px;">
        <img src="${product.image}" alt="${product.name}" style="border-radius:16px; border:1px solid var(--border);">
        <div>
          <h1 style="margin-top:0;">${product.name}</h1>
          <p class="muted">${product.brand} • ${product.os}</p>
          <div class="price-row"><span class="price">${formatUZS(product.price)}</span><span class="old-price">${formatUZS(product.oldPrice)}</span></div>
          <p class="muted">⭐ ${product.rating} • ${product.reviewsCount} отзывов</p>
          <p class="muted">Теги: ${product.tags.join(', ')}</p>
          <button class="btn secondary" id="compareBtn">Добавить в сравнение</button>
        </div>
      </section>

      <section class="panel">
        <h2>Характеристики</h2>
        <ul class="list">
          <li class="list-item">Дисплей: ${product.display}</li>
          <li class="list-item">Процессор: ${product.processor}</li>
          <li class="list-item">RAM: ${product.ram} GB</li>
          <li class="list-item">Память: ${product.storage} GB</li>
          <li class="list-item">Батарея: ${product.battery} mAh</li>
          <li class="list-item">Камера: ${product.camera}</li>
          <li class="list-item">Цвета: ${product.colors.join(', ')}</li>
        </ul>
      </section>

      <section class="panel">
        <h2>Цены в магазинах</h2>
        <ul class="list">${offers}</ul>
      </section>

      <section class="panel">
        <h2>Отзывы</h2>
        <ul class="list">${reviews}</ul>
      </section>
    `;

    qs('#compareBtn').addEventListener('click', () => {
      const res = addToCompare(product.id);
      alert(res.message);
    });
  } catch (error) {
    qs('#productRoot').innerHTML = `<section class="panel"><p>${error.message}</p></section>`;
  }
}

initProduct();
