const formatUZS = (value) => new Intl.NumberFormat('ru-RU').format(value) + ' UZS';

async function fetchProducts() {
  const res = await fetch('/api/products');
  return res.json();
}

async function renderProducts(selector, options = {}) {
  const root = document.querySelector(selector);
  if (!root) return;
  let products = await fetchProducts();
  if (options.limit) products = products.slice(0, options.limit);

  root.innerHTML = products.map((p) => `
    <article class="card">
      <img src="${p.image}" alt="${p.name}" />
      <h3>${p.name}</h3>
      <p class="price">от ${formatUZS(p.price)}</p>
      <p class="meta">${p.display} • ${p.ram} • ${p.storage}</p>
      <p>⭐ ${p.rating}</p>
      <a class="btn" href="/product.html?id=${p.id}">Открыть</a>
      ${options.showCompare ? `<button class="btn secondary" onclick="addToCompare(${p.id})">Сравнить</button>` : ''}
    </article>
  `).join('');
}

function addToCompare(id) {
  const current = JSON.parse(localStorage.getItem('compare') || '[]');
  const next = Array.from(new Set([...current, id]));
  localStorage.setItem('compare', JSON.stringify(next.slice(0, 3)));
  alert('Добавлено в сравнение');
}
