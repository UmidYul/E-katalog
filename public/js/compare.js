async function initCompare() {
  const ids = JSON.parse(localStorage.getItem('compare') || '[]');
  const table = document.querySelector('#compareTable');

  if (!ids.length) {
    table.innerHTML = '<tr><td>Список сравнения пуст.</td></tr>';
    return;
  }

  const products = await Promise.all(ids.map((id) => fetch(`/api/products/${id}`).then((r) => r.json())));

  const rows = [
    ['Модель', ...products.map((p) => p.name)],
    ['Цена', ...products.map((p) => formatUZS(p.price))],
    ['Экран', ...products.map((p) => p.display)],
    ['RAM', ...products.map((p) => p.ram)],
    ['Память', ...products.map((p) => p.storage)],
    ['Батарея', ...products.map((p) => p.battery)],
    ['Рейтинг', ...products.map((p) => `⭐ ${p.rating}`)]
  ];

  table.innerHTML = rows.map((row, i) => `
    <tr>${row.map((cell) => i === 0 ? `<th>${cell}</th>` : `<td>${cell}</td>`).join('')}</tr>
  `).join('');
}

initCompare();
