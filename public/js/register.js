const form = document.querySelector('#registerForm');
const result = document.querySelector('#registerResult');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  const res = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    result.innerHTML = `<div class="notice">Ошибка: ${data.message}</div>`;
    return;
  }

  result.innerHTML = `
    <div class="notice">
      ${data.message}<br />
      Профиль: ${data.profile.name} (${data.profile.email}), язык: ${data.profile.language}
    </div>
  `;
  form.reset();
});
