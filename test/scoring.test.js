const test = require('node:test');
const assert = require('node:assert/strict');
const {
  answerFraction, isValidAnswer, scoreItems, findGaps, validateForSubmit, buildSummary, ratingFor,
} = require('../src/domain/scoring');

const item = (over) => ({
  id: 1, area: 'OZN', category: 'Wejścia', text: 'Kryterium', weight: 1, answerType: 'scale', answer: null, comment: '', ...over,
});

test('answerFraction: skala 0–3', () => {
  assert.equal(answerFraction('scale', '0'), 0);
  assert.equal(answerFraction('scale', '3'), 1);
  assert.equal(answerFraction('scale', '1'), 1 / 3);
});

test('answerFraction: tak / częściowo / nie', () => {
  assert.equal(answerFraction('ternary', 'tak'), 1);
  assert.equal(answerFraction('ternary', 'czesciowo'), 0.5);
  assert.equal(answerFraction('ternary', 'nie'), 0);
});

test('answerFraction: „nie dotyczy” i brak odpowiedzi nie podlegają ocenie', () => {
  for (const a of ['nd', null, undefined, '']) assert.equal(answerFraction('scale', a), null);
});

test('answerFraction: niedozwolona odpowiedź rzuca błąd', () => {
  assert.throws(() => answerFraction('scale', 'tak'));
  assert.throws(() => answerFraction('ternary', '2'));
  assert.throws(() => answerFraction('nieznany', '1'));
});

test('isValidAnswer sprawdza typ odpowiedzi', () => {
  assert.ok(isValidAnswer('scale', '2'));
  assert.ok(isValidAnswer('scale', 'nd'));
  assert.ok(!isValidAnswer('scale', '4'));
  assert.ok(!isValidAnswer('ternary', '3'));
});

test('scoreItems: ważona średnia w obrębie obszaru', () => {
  const score = scoreItems([
    item({ weight: 3, answer: '3' }),            // 3 pkt z 3
    item({ weight: 1, answer: '0' }),            // 0 pkt z 1
  ]);
  assert.equal(score.areas.OZN.percent, 75);     // 3 / 4
  assert.equal(score.areas.KSZTALCENIE.percent, null);
  assert.equal(score.total.percent, 75);
});

test('scoreItems: waga zmienia wynik', () => {
  const heavyFail = scoreItems([item({ weight: 5, answer: '0' }), item({ weight: 1, answer: '3' })]);
  const lightFail = scoreItems([item({ weight: 1, answer: '0' }), item({ weight: 5, answer: '3' })]);
  assert.equal(heavyFail.total.percent, 16.7);
  assert.equal(lightFail.total.percent, 83.3);
});

test('scoreItems: „nie dotyczy” nie obniża wyniku', () => {
  const score = scoreItems([
    item({ weight: 2, answer: '3' }),
    item({ weight: 5, answer: 'nd' }),
  ]);
  assert.equal(score.total.percent, 100);
  assert.equal(score.total.notApplicable, 1);
  assert.equal(score.total.completeness, 100);
});

test('scoreItems: nieodpowiedziane kryteria nie wchodzą do wyniku, ale obniżają kompletność', () => {
  const score = scoreItems([item({ weight: 2, answer: '3' }), item({ weight: 2, answer: null })]);
  assert.equal(score.total.percent, 100);
  assert.equal(score.total.completeness, 50);
});

test('scoreItems: osobne wyniki dla OZN i kształcenia, wynik ogólny łączny', () => {
  const score = scoreItems([
    item({ area: 'OZN', weight: 2, answer: '3' }),
    item({ area: 'KSZTALCENIE', weight: 2, answerType: 'ternary', answer: 'czesciowo' }),
    item({ area: 'KSZTALCENIE', weight: 2, answerType: 'ternary', answer: 'nie' }),
  ]);
  assert.equal(score.areas.OZN.percent, 100);
  assert.equal(score.areas.KSZTALCENIE.percent, 25);   // 1 z 4
  assert.equal(score.total.percent, 50);               // 3 z 6
});

test('scoreItems: wyniki per kategoria', () => {
  const score = scoreItems([
    item({ category: 'A', weight: 1, answer: '3' }),
    item({ category: 'B', weight: 1, answer: '0' }),
  ]);
  const byCat = Object.fromEntries(score.categories.map((c) => [c.category, c.percent]));
  assert.deepEqual(byCat, { A: 100, B: 0 });
});

test('scoreItems: pusta lista i nieznany obszar', () => {
  assert.equal(scoreItems([]).total.percent, null);
  assert.throws(() => scoreItems([item({ area: 'INNY', answer: '1' })]));
});

test('ratingFor: progi', () => {
  assert.equal(ratingFor(100).key, 'high');
  assert.equal(ratingFor(85).key, 'high');
  assert.equal(ratingFor(84.9).key, 'medium');
  assert.equal(ratingFor(60).key, 'medium');
  assert.equal(ratingFor(30).key, 'low');
  assert.equal(ratingFor(29.9).key, 'critical');
  assert.equal(ratingFor(0).key, 'critical');
  assert.equal(ratingFor(null), null);
});

test('findGaps: sortuje po wadze, pomija dobre i nieocenione', () => {
  const gaps = findGaps([
    item({ id: 1, weight: 2, answer: '0' }),
    item({ id: 2, weight: 5, answer: '1' }),
    item({ id: 3, weight: 5, answer: '3' }),
    item({ id: 4, weight: 5, answer: 'nd' }),
    item({ id: 5, weight: 4, answer: null }),
  ]);
  assert.deepEqual(gaps.map((g) => g.id), [2, 1]);
});

test('validateForSubmit: wymaga odpowiedzi i uzasadnienia dla „nie dotyczy”', () => {
  const problems = validateForSubmit([
    item({ id: 1, answer: '2' }),
    item({ id: 2, answer: null }),
    item({ id: 3, answer: 'nd', comment: '   ' }),
    item({ id: 4, answer: 'nd', comment: 'Brak wind w budynku' }),
  ]);
  assert.deepEqual(problems.map((p) => [p.itemId, p.code]), [[2, 'unanswered'], [3, 'nd_needs_comment']]);
});

test('validateForSubmit: odpowiedź „0” jest ważna', () => {
  assert.deepEqual(validateForSubmit([item({ answer: '0' })]), []);
});

test('buildSummary: generuje wstępne podsumowanie', () => {
  const { lines, score, gaps } = buildSummary([
    item({ area: 'OZN', weight: 5, answer: '0', text: 'Wejście bez schodów' }),
    item({ area: 'KSZTALCENIE', weight: 3, answerType: 'ternary', answer: 'tak' }),
    item({ area: 'KSZTALCENIE', weight: 1, answerType: 'ternary', answer: null }),
  ], { objectName: 'Wydział X' });
  assert.equal(score.areas.OZN.percent, 0);
  assert.equal(gaps.length, 1);
  assert.match(lines[0], /Wydział X/);
  assert.ok(lines.some((l) => l.includes('Dostępność dla OZN: 0%')));
  assert.ok(lines.some((l) => l.includes('Uzupełniono')));
  assert.ok(lines.some((l) => l.includes('Wejście bez schodów')));
});

test('buildSummary: audyt bez ocen', () => {
  const { lines } = buildSummary([item({ answer: null })]);
  assert.match(lines[0], /nie zawiera jeszcze ocenionych/);
});
