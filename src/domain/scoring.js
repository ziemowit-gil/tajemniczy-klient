/**
 * Punktacja audytu — czysta logika, bez dostępu do bazy.
 *
 * Każda odpowiedź daje „ułamek spełnienia” 0..1:
 *   - skala:   '0'..'3'  → wartość / 3
 *   - ternary: tak = 1, częściowo = 0,5, nie = 0
 *   - 'nd' (nie dotyczy) i brak odpowiedzi → null, kryterium wypada z mianownika
 *
 * Wynik obszaru (%) = Σ(waga × ułamek) / Σ(waga kryteriów ocenionych) × 100.
 * Wynik ogólny liczony jest z wszystkich ocenionych kryteriów obu obszarów łącznie.
 */

const { AREAS } = require('./constants');

const NOT_APPLICABLE = 'nd';

const ANSWER_OPTIONS = {
  scale: [
    { value: '0', label: '0 – brak / niedostępne', fraction: 0 },
    { value: '1', label: '1 – w niewielkim stopniu', fraction: 1 / 3 },
    { value: '2', label: '2 – w dużym stopniu', fraction: 2 / 3 },
    { value: '3', label: '3 – w pełni', fraction: 1 },
  ],
  ternary: [
    { value: 'tak', label: 'Tak', fraction: 1 },
    { value: 'czesciowo', label: 'Częściowo', fraction: 0.5 },
    { value: 'nie', label: 'Nie', fraction: 0 },
  ],
};

const RATING_LEVELS = [
  { min: 85, key: 'high', label: 'Wysoka dostępność' },
  { min: 60, key: 'medium', label: 'Dostępność częściowa' },
  { min: 30, key: 'low', label: 'Niska dostępność' },
  { min: 0, key: 'critical', label: 'Dostępność bardzo niska' },
];

const round1 = (n) => Math.round(n * 10) / 10;

function optionsFor(answerType) {
  const options = ANSWER_OPTIONS[answerType];
  if (!options) throw new Error(`Nieznany typ odpowiedzi: ${answerType}`);
  return options;
}

function isValidAnswer(answerType, answer) {
  return answer === NOT_APPLICABLE || optionsFor(answerType).some((o) => o.value === answer);
}

/** Ułamek spełnienia kryterium albo null, gdy kryterium nie podlega ocenie. */
function answerFraction(answerType, answer) {
  if (answer === null || answer === undefined || answer === '' || answer === NOT_APPLICABLE) return null;
  const option = optionsFor(answerType).find((o) => o.value === String(answer));
  if (!option) throw new Error(`Niedozwolona odpowiedź „${answer}” dla typu ${answerType}`);
  return option.fraction;
}

function ratingFor(percent) {
  if (percent === null) return null;
  return RATING_LEVELS.find((l) => percent >= l.min);
}

function emptyBucket() {
  return { earned: 0, possible: 0, items: 0, answered: 0, notApplicable: 0 };
}

function finalizeBucket(b) {
  const percent = b.possible > 0 ? round1((b.earned / b.possible) * 100) : null;
  return {
    percent,
    earned: round1(b.earned),
    possible: b.possible,
    items: b.items,
    answered: b.answered,
    notApplicable: b.notApplicable,
    completeness: b.items > 0 ? round1(((b.answered + b.notApplicable) / b.items) * 100) : 0,
    rating: ratingFor(percent),
  };
}

/**
 * @param {Array<{area:string, category?:string, weight:number, answerType:string, answer:?string}>} items
 */
function scoreItems(items) {
  const areas = { [AREAS.OZN]: emptyBucket(), [AREAS.EDU]: emptyBucket() };
  const total = emptyBucket();
  const categories = new Map();

  for (const item of items) {
    const bucket = areas[item.area];
    if (!bucket) throw new Error(`Nieznany obszar: ${item.area}`);
    const key = `${item.area}\u0000${item.category || ''}`;
    if (!categories.has(key)) categories.set(key, { area: item.area, category: item.category || '', ...emptyBucket() });
    const cat = categories.get(key);

    const fraction = answerFraction(item.answerType, item.answer);
    for (const b of [bucket, total, cat]) {
      b.items += 1;
      if (item.answer === NOT_APPLICABLE) b.notApplicable += 1;
      if (fraction === null) continue;
      b.answered += 1;
      b.possible += item.weight;
      b.earned += item.weight * fraction;
    }
  }

  return {
    areas: {
      [AREAS.OZN]: finalizeBucket(areas[AREAS.OZN]),
      [AREAS.EDU]: finalizeBucket(areas[AREAS.EDU]),
    },
    total: finalizeBucket(total),
    categories: [...categories.values()].map(({ area, category, ...b }) => ({ area, category, ...finalizeBucket(b) })),
  };
}

/** Braki: kryteria spełnione najwyżej w połowie, od najważniejszych. */
function findGaps(items, { maxFraction = 0.5, limit = 10 } = {}) {
  return items
    .map((item) => ({ item, fraction: answerFraction(item.answerType, item.answer) }))
    .filter(({ fraction }) => fraction !== null && fraction <= maxFraction)
    .sort((a, b) => b.item.weight - a.item.weight || a.fraction - b.fraction)
    .slice(0, limit)
    .map(({ item, fraction }) => ({ ...item, fraction }));
}

/**
 * Sprawdza, czy audyt można złożyć. Zwraca listę problemów (pusta = OK).
 * Każde kryterium musi mieć odpowiedź; „nie dotyczy” wymaga uzasadnienia w komentarzu.
 */
function validateForSubmit(items) {
  const problems = [];
  for (const item of items) {
    const answered = item.answer !== null && item.answer !== undefined && item.answer !== '';
    if (!answered) problems.push({ itemId: item.id, code: 'unanswered', message: 'Brak odpowiedzi.' });
    else if (item.answer === NOT_APPLICABLE && !String(item.comment || '').trim()) {
      problems.push({ itemId: item.id, code: 'nd_needs_comment', message: 'Odpowiedź „nie dotyczy” wymaga uzasadnienia w komentarzu.' });
    }
  }
  return problems;
}

const fmt = (p) => (p === null ? 'brak danych' : `${String(p).replace('.', ',')}%`);

/**
 * Wstępne podsumowanie (raport cząstkowy) w formie ustrukturyzowanej + zdań gotowych do wyświetlenia.
 */
function buildSummary(items, { objectName = '' } = {}) {
  const score = scoreItems(items);
  const gaps = findGaps(items);
  const lines = [];
  const who = objectName ? ` obiektu „${objectName}”` : '';

  if (score.total.percent === null) {
    lines.push(`Audyt${who} nie zawiera jeszcze ocenionych kryteriów.`);
  } else {
    lines.push(`Wynik ogólny audytu${who}: ${fmt(score.total.percent)} (${score.total.rating.label.toLowerCase()}).`);
    for (const area of [AREAS.OZN, AREAS.EDU]) {
      const a = score.areas[area];
      if (a.items === 0) continue;
      const name = area === AREAS.OZN ? 'Dostępność dla OZN' : 'Dostępność procesu kształcenia';
      lines.push(`${name}: ${fmt(a.percent)}${a.rating ? ` – ${a.rating.label.toLowerCase()}` : ''}.`);
    }
  }
  if (score.total.completeness < 100) {
    lines.push(`Uzupełniono ${fmt(score.total.completeness)} kryteriów — wynik może się zmienić.`);
  }
  if (gaps.length) {
    lines.push(`Najważniejsze braki (${gaps.length}): ${gaps.slice(0, 3).map((g) => g.text.replace(/[.\s]+$/, '')).join('; ')}.`);
  }
  return { score, gaps, lines };
}

module.exports = {
  NOT_APPLICABLE, ANSWER_OPTIONS, RATING_LEVELS,
  optionsFor, isValidAnswer, answerFraction, ratingFor, scoreItems, findGaps, validateForSubmit, buildSummary,
};
