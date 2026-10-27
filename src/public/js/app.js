// Potwierdzenia (data-confirm) i przeniesienie fokusu na komunikat o błędzie – bez inline JS (CSP).
document.addEventListener('submit', (event) => {
  const message = event.submitter?.dataset.confirm || event.target.dataset.confirm;
  if (message && !window.confirm(message)) event.preventDefault();
});

window.addEventListener('DOMContentLoaded', () => {
  const alert = document.querySelector('.error-summary, .flash-error');
  if (alert) {
    alert.setAttribute('tabindex', '-1');
    alert.focus();
  }
});
