const qs = (selector, parent = document) => parent.querySelector(selector);
const formatUZS = (value) => `${new Intl.NumberFormat('ru-RU').format(value)} UZS`;

const compareKey = 'ekatalog_compare';

function getCompareList() {
  return JSON.parse(localStorage.getItem(compareKey) || '[]');
}

function addToCompare(id) {
  const current = getCompareList();
  if (current.includes(id)) return { ok: false, message: 'Уже добавлено в сравнение' };
  if (current.length >= 3) return { ok: false, message: 'Можно сравнить только 3 модели' };
  current.push(id);
  localStorage.setItem(compareKey, JSON.stringify(current));
  return { ok: true, message: 'Добавлено в сравнение' };
}

function clearCompare() {
  localStorage.removeItem(compareKey);
}

async function api(url, options) {
  const response = await fetch(url, options);
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.message || 'API error');
  }
  return json;
}

function productCard(product) {
  const stockClass = product.inStock ? 'success' : 'warn';
  const stockText = product.inStock ? 'В наличии' : 'Ожидается';

  return `
  <article class="card">
    <img src="${product.image}" alt="${product.name}" />
    <div class="card-body">
      <span class="badge ${stockClass}">${stockText}</span>
      <h3>${product.name}</h3>
      <p class="muted">${product.display} • ${product.ram}GB • ${product.storage}GB</p>
      <div class="price-row">
        <span class="price">${formatUZS(product.price)}</span>
        <span class="old-price">${formatUZS(product.oldPrice)}</span>
      </div>
      <p class="muted">⭐ ${product.rating} • ${product.reviewsCount} отзывов</p>
      <div class="actions">
        <a class="btn primary" href="/product.html?id=${product.id}">Открыть</a>
        <button class="btn secondary" data-compare="${product.id}">Сравнить</button>
      </div>
    </div>
  </article>`;
}

function bindCompareButtons(root = document) {
  root.querySelectorAll('[data-compare]').forEach((button) => {
    button.addEventListener('click', () => {
      const result = addToCompare(Number(button.dataset.compare));
      alert(result.message);
    });
  });
}
