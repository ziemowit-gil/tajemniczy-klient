const { ROLES } = require('./constants');

const STATUS = Object.freeze({
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
});

const STATUS_LABELS = {
  assigned: 'Przypisany',
  in_progress: 'W trakcie',
  submitted: 'Złożony / oczekuje na weryfikację',
  approved: 'Zatwierdzony',
};

// from → { to: role uprawnione do przejścia }
const TRANSITIONS = {
  [STATUS.ASSIGNED]: { [STATUS.IN_PROGRESS]: [ROLES.AUDITOR] },
  [STATUS.IN_PROGRESS]: { [STATUS.SUBMITTED]: [ROLES.AUDITOR] },
  [STATUS.SUBMITTED]: {
    [STATUS.APPROVED]: [ROLES.COORDINATOR, ROLES.ADMIN],
    [STATUS.IN_PROGRESS]: [ROLES.COORDINATOR, ROLES.ADMIN], // zwrot do poprawy
  },
  [STATUS.APPROVED]: {},
};

function canTransition(from, to, role) {
  return Boolean(TRANSITIONS[from]?.[to]?.includes(role));
}

/** Audytor może zmieniać odpowiedzi tylko dopóki audyt nie został złożony. */
function isEditable(status) {
  return status === STATUS.ASSIGNED || status === STATUS.IN_PROGRESS;
}

module.exports = { STATUS, STATUS_LABELS, TRANSITIONS, canTransition, isEditable };
