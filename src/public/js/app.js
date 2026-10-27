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

// „Zaznacz wszystkie”: checkbox z data-select-all steruje polami o tej samej nazwie grupy (progresywne rozszerzenie).
document.addEventListener('change', (event) => {
  const master = event.target.closest?.('[data-select-all]');
  if (!master) return;
  for (const box of document.querySelectorAll(`input[type="checkbox"][data-group="${master.dataset.selectAll}"]:not(:disabled)`)) box.checked = master.checked;
});
