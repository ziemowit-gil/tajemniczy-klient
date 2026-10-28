/**
 * Edytor kroków scenariusza: lista pól z przyciskami dodaj / usuń / wyżej / niżej.
 * Ulepszenie progresywne: bez JavaScriptu formularz zachowuje zwykłe pole tekstowe (jeden krok w wierszu).
 * Pole tekstowe pozostaje „źródłem prawdy” wysyłanym na serwer — edytor tylko je ukrywa i synchronizuje.
 *
 * Plik działa w przeglądarce (globalny obiekt StepsEditorCore + automatyczny start) i w Node (testy jednostkowe).
 */
(function (root) {
  'use strict';

  /* ---------- czysta logika (testowana w Node) ---------- */

  /** Tekst z pola → lista kroków (bez pustych wierszy i numeracji „1. ”, „2) ”). */
  function parseSteps(text) {
    return String(text || '').split(/\r?\n/).map((l) => l.replace(/^\s*\d+[.)]\s+/, '').trim()).filter(Boolean);
  }

  /** Lista kroków → tekst do pola (puste kroki pomijane). */
  function serializeSteps(steps) {
    return steps.map((s) => String(s).trim()).filter(Boolean).join('\n');
  }

  /** Przesuwa krok o `delta` (−1 wyżej, +1 niżej). Zwraca { steps, index } z nową pozycją (bez zmian na krawędzi). */
  function moveStep(steps, index, delta) {
    const target = index + delta;
    if (index < 0 || index >= steps.length || target < 0 || target >= steps.length) return { steps: steps.slice(), index };
    const next = steps.slice();
    [next[index], next[target]] = [next[target], next[index]];
    return { steps: next, index: target };
  }

  /** Usuwa krok; zwraca { steps, index } — indeks kroku, na którym warto ustawić fokus. */
  function removeStep(steps, index) {
    if (index < 0 || index >= steps.length) return { steps: steps.slice(), index: Math.min(index, steps.length - 1) };
    const next = steps.slice();
    next.splice(index, 1);
    return { steps: next, index: Math.min(index, next.length - 1) };
  }

  /** Wstawia pozycje po kroku `index` (limit `max`); zwraca { steps, index } ostatniego wstawionego. */
  function insertAfter(steps, index, items, max) {
    const room = Math.max(0, max - steps.length);
    const add = items.slice(0, room);
    if (!add.length) return { steps: steps.slice(), index, added: 0 };
    const next = steps.slice();
    next.splice(index + 1, 0, ...add);
    return { steps: next, index: index + add.length, added: add.length };
  }

  /** Wklejony tekst z wieloma wierszami → lista kroków (jak parseSteps); jedna linia zwraca pustą listę (zwykłe wklejanie). */
  function splitPaste(text) {
    const lines = parseSteps(text);
    return /\r?\n/.test(String(text || '').trim()) && lines.length > 1 ? lines : [];
  }

  const core = { parseSteps, serializeSteps, moveStep, removeStep, insertAfter, splitPaste };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  root.StepsEditorCore = core;

  /* ---------- interfejs (tylko w przeglądarce) ---------- */
  if (typeof document === 'undefined') return;

  function init(textarea) {
    const MAX_STEPS = Number(textarea.dataset.maxSteps) || 30;
    const MAX_LEN = Number(textarea.dataset.maxLength) || 300;
    let steps = parseSteps(textarea.value);
    if (!steps.length) steps = [''];

    const wrapper = document.createElement('div');
    wrapper.className = 'steps-editor';
    const list = document.createElement('ol');
    list.className = 'steps-editor-list';
    list.setAttribute('aria-label', 'Kroki scenariusza');
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn-secondary';
    add.textContent = 'Dodaj krok';
    const status = document.createElement('p');
    status.className = 'sr-only';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const counter = document.createElement('p');
    counter.className = 'hint';
    wrapper.append(list, add, counter, status);
    textarea.hidden = true;
    textarea.insertAdjacentElement('afterend', wrapper);

    const announce = (message) => { status.textContent = ''; setTimeout(() => { status.textContent = message; }, 30); };
    const sync = () => { textarea.value = serializeSteps(steps); };

    /** Rysuje listę od nowa; `focus` = { index, kind } przywraca fokus po zmianie struktury. */
    function render(focus) {
      list.textContent = '';
      steps.forEach((text, i) => {
        const n = i + 1;
        const li = document.createElement('li');
        const no = document.createElement('span');
        no.className = 'step-no';
        no.setAttribute('aria-hidden', 'true');
        no.textContent = `${n}.`;
        const label = document.createElement('label');
        label.className = 'sr-only';
        label.htmlFor = `step-input-${n}`;
        label.textContent = `Krok ${n}`;
        const input = document.createElement('input');
        input.type = 'text';
        input.id = `step-input-${n}`;
        input.value = text;
        input.maxLength = MAX_LEN;
        input.dataset.index = String(i);
        const mk = (kind, text2, aria, disabled) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn btn-secondary btn-small';
          b.textContent = text2;
          b.setAttribute('aria-label', aria);
          b.dataset.kind = kind;
          b.dataset.index = String(i);
          b.disabled = Boolean(disabled);
          return b;
        };
        li.append(no, label, input,
          mk('up', 'Wyżej', `Przenieś krok ${n} wyżej`, i === 0),
          mk('down', 'Niżej', `Przenieś krok ${n} niżej`, i === steps.length - 1),
          mk('remove', 'Usuń', `Usuń krok ${n}`, false));
        list.append(li);
      });
      add.disabled = steps.length >= MAX_STEPS;
      counter.textContent = steps.length >= MAX_STEPS ? `Osiągnięto limit ${MAX_STEPS} kroków.` : `Kroków: ${steps.length} z maksymalnie ${MAX_STEPS}.`;
      sync();
      if (focus) {
        const sel = focus.kind === 'input' ? 'input' : `button[data-kind="${focus.kind}"]`;
        let target = list.querySelector(`li:nth-child(${focus.index + 1}) ${sel}`);
        if (!target || target.disabled) target = list.querySelector(`li:nth-child(${focus.index + 1}) input`);
        target?.focus();
      }
    }

    list.addEventListener('input', (event) => {
      if (event.target.matches('input')) { steps[Number(event.target.dataset.index)] = event.target.value; sync(); }
    });

    list.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-kind]');
      if (!button) return;
      const i = Number(button.dataset.index);
      if (button.dataset.kind === 'up' || button.dataset.kind === 'down') {
        const r = moveStep(steps, i, button.dataset.kind === 'up' ? -1 : 1);
        steps = r.steps;
        render({ index: r.index, kind: button.dataset.kind });
        announce(`Krok przeniesiony na pozycję ${r.index + 1} z ${steps.length}.`);
      } else {
        const r = removeStep(steps, i);
        steps = r.steps.length ? r.steps : [''];
        render({ index: Math.max(0, r.index), kind: 'input' });
        announce(`Usunięto krok ${i + 1}. Pozostało kroków: ${r.steps.length}.`);
      }
    });

    // Enter w polu dodaje nowy krok pod spodem (zamiast wysyłać formularz), wielowierszowe wklejenie rozdziela kroki.
    list.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || !event.target.matches('input')) return;
      event.preventDefault();
      const i = Number(event.target.dataset.index);
      const r = insertAfter(steps, i, [''], MAX_STEPS);
      if (!r.added) { announce(`Limit ${MAX_STEPS} kroków.`); return; }
      steps = r.steps;
      render({ index: r.index, kind: 'input' });
      announce(`Dodano krok ${r.index + 1}.`);
    });
    list.addEventListener('paste', (event) => {
      if (!event.target.matches('input')) return;
      const parts = splitPaste(event.clipboardData?.getData('text') || '');
      if (!parts.length) return;
      event.preventDefault();
      const i = Number(event.target.dataset.index);
      const current = steps[i].trim() === '' ? steps.filter((_, k) => k !== i) : steps;
      const at = steps[i].trim() === '' ? i - 1 : i;
      const r = insertAfter(current, at, parts, MAX_STEPS);
      steps = r.steps.length ? r.steps : [''];
      render({ index: r.index, kind: 'input' });
      announce(`Wklejono kroków: ${r.added}.`);
    });

    add.addEventListener('click', () => {
      const r = insertAfter(steps, steps.length - 1, [''], MAX_STEPS);
      if (!r.added) return;
      steps = r.steps;
      render({ index: r.index, kind: 'input' });
      announce(`Dodano krok ${r.index + 1}.`);
    });

    textarea.form?.addEventListener('submit', sync);
    render();
  }

  document.addEventListener('DOMContentLoaded', () => {
    for (const textarea of document.querySelectorAll('textarea[data-steps-editor]')) init(textarea);
  });
})(typeof window !== 'undefined' ? window : globalThis);
