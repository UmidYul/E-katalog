const form = document.querySelector('#registerForm');
const messageBox = document.querySelector('#registerMessage');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  messageBox.innerHTML = '';

  const data = Object.fromEntries(new FormData(form).entries());

  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (!response.ok) {
      messageBox.innerHTML = `<div class="notice error">${result.message}</div>`;
      return;
    }

    messageBox.innerHTML = `<div class="notice success">${result.message}<br>ID: ${result.profile.id}<br>${result.profile.name} (${result.profile.email})</div>`;
    form.reset();
  } catch (error) {
    messageBox.innerHTML = `<div class="notice error">Ошибка сети: ${error.message}</div>`;
  }
});
