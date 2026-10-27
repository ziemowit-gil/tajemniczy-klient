const test = require('node:test');
const assert = require('node:assert/strict');
const { canTransition, isEditable, STATUS } = require('../src/domain/workflow');

test('ścieżka audytu: przypisany → w trakcie → złożony → zatwierdzony', () => {
  assert.ok(canTransition(STATUS.ASSIGNED, STATUS.IN_PROGRESS, 'auditor'));
  assert.ok(canTransition(STATUS.IN_PROGRESS, STATUS.SUBMITTED, 'auditor'));
  assert.ok(canTransition(STATUS.SUBMITTED, STATUS.APPROVED, 'coordinator'));
  assert.ok(canTransition(STATUS.SUBMITTED, STATUS.APPROVED, 'administrator'));
});

test('audytor nie zatwierdza własnego audytu', () => {
  assert.ok(!canTransition(STATUS.SUBMITTED, STATUS.APPROVED, 'auditor'));
});

test('koordynator może zwrócić złożony audyt do poprawy', () => {
  assert.ok(canTransition(STATUS.SUBMITTED, STATUS.IN_PROGRESS, 'coordinator'));
  assert.ok(!canTransition(STATUS.SUBMITTED, STATUS.IN_PROGRESS, 'auditor'));
});

test('niedozwolone skoki i przejścia z zatwierdzonego', () => {
  assert.ok(!canTransition(STATUS.ASSIGNED, STATUS.SUBMITTED, 'auditor'));
  assert.ok(!canTransition(STATUS.ASSIGNED, STATUS.APPROVED, 'administrator'));
  assert.ok(!canTransition(STATUS.APPROVED, STATUS.IN_PROGRESS, 'administrator'));
  assert.ok(!canTransition('nieznany', STATUS.APPROVED, 'administrator'));
});

test('edytowalne tylko przed złożeniem', () => {
  assert.ok(isEditable(STATUS.ASSIGNED));
  assert.ok(isEditable(STATUS.IN_PROGRESS));
  assert.ok(!isEditable(STATUS.SUBMITTED));
  assert.ok(!isEditable(STATUS.APPROVED));
});
