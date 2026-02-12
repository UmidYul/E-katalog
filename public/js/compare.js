async function initCompare() {
  const ids = getCompareList();
  const table = qs('#compareTable');

  if (!ids.length) {
    table.innerHTML = '<tr><td>Список сравнения пуст. Добавьте товары в каталоге.</td></tr>';
    return;
  }

  const products = await Promise.all(ids.map((id) => api(`/api/products/${id}`)));

  const rows = [
    ['Параметр', ...products.map((p) => p.name)],
    ['Цена', ...products.map((p) => formatUZS(p.price))],
    ['Рейтинг', ...products.map((p) => p.rating)],
    ['Дисплей', ...products.map((p) => p.display)],
    ['Процессор', ...products.map((p) => p.processor)],
    ['RAM', ...products.map((p) => `${p.ram} GB`)],
    ['Память', ...products.map((p) => `${p.storage} GB`)],
    ['Батарея', ...products.map((p) => `${p.battery} mAh`)],
    ['Камера', ...products.map((p) => p.camera)]
  ];

  table.innerHTML = rows
    .map((row, idx) => `<tr>${row.map((cell) => (idx === 0 ? `<th>${cell}</th>` : `<td>${cell}</td>`)).join('')}</tr>`)
    .join('');

  qs('#clearCompare').addEventListener('click', () => {
    clearCompare();
    location.reload();
  });
}

initCompare();
