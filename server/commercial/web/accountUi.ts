const password = document.getElementById('password');
const toggle = document.getElementById('auth-password-toggle');

if (password instanceof HTMLInputElement && toggle instanceof HTMLButtonElement) {
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.textContent = (visible ? toggle.dataset.hide : toggle.dataset.show) ?? '';
  });
}
