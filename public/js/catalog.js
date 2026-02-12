let products = [];

const text = {
  ru: { title: 'Каталог смартфонов', search: 'Поиск по модели' },
  uz: { title: 'Smartfonlar katalogi', search: 'Model bo\'yicha qidiruv' }
};

async function initCatalog() {
  products = await fetchProducts();
  renderList(products);

  const brandFilter = document.querySelector('#brandFilter');
  const searchInput = document.querySelector('#searchInput');
  const langSwitch = document.querySelector('#langSwitch');

  const apply = () => {
    const q = searchInput.value.toLowerCase();
    const brand = brandFilter.value;
    const filtered = products.filter((p) => {
      const matchesBrand = !brand || p.brand === brand;
      const matchesSearch = p.name.toLowerCase().includes(q);
      return matchesBrand && matchesSearch;
    });
    renderList(filtered);
  };

  brandFilter.addEventListener('change', apply);
  searchInput.addEventListener('input', apply);
  langSwitch.addEventListener('change', () => {
    document.querySelector('h1').textContent = text[langSwitch.value].title;
    searchInput.placeholder = text[langSwitch.value].search;
  });
}

function renderList(items) {
  const root = document.querySelector('#catalogProducts');
  root.innerHTML = items.map((p) => `
    <article class="card">
      <img src="${p.image}" alt="${p.name}">
      <h3>${p.name}</h3>
      <div class="price">${formatUZS(p.price)}</div>
      <p class="meta">${p.display} • ${p.ram} • ${p.storage} • ${p.battery}</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <a class="btn" href="/product.html?id=${p.id}">Детали</a>
        <button class="btn secondary" onclick="addToCompare(${p.id})">Сравнить</button>
      </div>
    </article>
  `).join('');
}

initCatalog();
