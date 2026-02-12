const dict = {
  ru: {
    title: 'Каталог смартфонов',
    qPlaceholder: 'Поиск по модели'
  },
  uz: {
    title: 'Smartfonlar katalogi',
    qPlaceholder: 'Model bo\'yicha qidirish'
  }
};

const filters = {
  q: '',
  brand: '',
  minRam: '',
  minStorage: '',
  minPrice: '',
  maxPrice: '',
  inStock: false,
  sort: 'popular'
};

async function initCatalog() {
  const meta = await api('/api/meta');

  qs('#filterBrand').innerHTML += meta.brands.map((brand) => `<option value="${brand}">${brand}</option>`).join('');
  qs('#filterRam').innerHTML += meta.ramOptions.map((ram) => `<option value="${ram}">${ram} GB</option>`).join('');
  qs('#filterStorage').innerHTML += meta.storageOptions.map((s) => `<option value="${s}">${s} GB</option>`).join('');

  const controls = [
    ['#filterQ', 'q'],
    ['#filterBrand', 'brand'],
    ['#filterRam', 'minRam'],
    ['#filterStorage', 'minStorage'],
    ['#filterMinPrice', 'minPrice'],
    ['#filterMaxPrice', 'maxPrice'],
    ['#filterSort', 'sort']
  ];

  controls.forEach(([selector, key]) => {
    qs(selector).addEventListener('input', () => {
      filters[key] = qs(selector).value;
      loadProducts();
    });
    qs(selector).addEventListener('change', () => {
      filters[key] = qs(selector).value;
      loadProducts();
    });
  });

  qs('#filterStock').addEventListener('change', (e) => {
    filters.inStock = e.target.checked;
    loadProducts();
  });

  qs('#langSwitch').addEventListener('change', (e) => {
    const t = dict[e.target.value];
    qs('#catalogTitle').textContent = t.title;
    qs('#filterQ').placeholder = t.qPlaceholder;
  });

  await loadProducts();
}

async function loadProducts() {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== '' && value !== false) params.set(key, value);
  });

  const { items, total } = await api(`/api/products?${params.toString()}`);
  qs('#catalogCount').textContent = total;
  qs('#catalogGrid').innerHTML = items.map(productCard).join('');
  bindCompareButtons(qs('#catalogGrid'));
}

initCatalog();
