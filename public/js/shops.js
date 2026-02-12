async function initShops() {
  const shops = await (await fetch('/api/shops')).json();
  const root = document.querySelector('#shopsList');

  root.innerHTML = shops.map((shop) => `
    <article class="card">
      <h3>${shop.name}</h3>
      <p>⭐ ${shop.rating}</p>
      <p class="meta">Город: ${shop.city}</p>
      <p class="meta">Доставка: ${shop.delivery.join(', ')}</p>
    </article>
  `).join('');
}

initShops();
