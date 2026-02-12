async function initShops() {
  const shops = await api('/api/shops');
  qs('#shopsGrid').innerHTML = shops
    .map(
      (shop) => `
      <article class="card">
        <div class="card-body">
          <h3>${shop.name}</h3>
          <p class="muted">Город: ${shop.city}</p>
          <p class="muted">Рейтинг: ⭐ ${shop.rating}</p>
          <p class="muted">Предложений: ${shop.offersCount}, в наличии: ${shop.stockCount}</p>
          <p class="muted">Доставка: ${shop.delivery.join(', ')}</p>
          <span class="badge ${shop.pickup ? 'success' : 'warn'}">${shop.pickup ? 'Есть самовывоз' : 'Без самовывоза'}</span>
        </div>
      </article>`
    )
    .join('');
}

initShops();
