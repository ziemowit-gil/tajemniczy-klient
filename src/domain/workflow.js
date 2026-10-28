const { ROLES } = require('../domain/constants');

/**
 * Etapy audytu: Wprowadzony do systemu (przez koordynatora lub administratora, jeszcze bez audytora) → Przydzielony do TK
 * → W trakcie → Uzupełniony raport → Zatwierdzony. Klucze `submitted` i `approved` zostają ze względów zgodności danych.
 * Oceny „Dostępność kształcenia” korzystają z tych samych nazw, ale zaczynają od etapu „W trakcie”.
 */
const STATUS = Object.freeze({
  ENTERED: 'entered',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
});

const STATUS_LABELS = {
  entered: 'Wprowadzony do systemu',
  assigned: 'Przydzielony do TK',
  in_progress: 'W trakcie',
  submitted: 'Uzupełniony raport',
  approved: 'Zatwierdzony',
};

// from → { to: role uprawnione do przejścia }
const MANAGERS = [ROLES.COORDINATOR, ROLES.ADMIN];
const TRANSITIONS = {
  [STATUS.ENTERED]: { [STATUS.ASSIGNED]: MANAGERS },                       // przydział do Tajemniczego Klienta
  [STATUS.ASSIGNED]: { [STATUS.IN_PROGRESS]: [ROLES.AUDITOR], [STATUS.ASSIGNED]: MANAGERS }, // start pracy / zmiana TK
  [STATUS.IN_PROGRESS]: { [STATUS.SUBMITTED]: [ROLES.AUDITOR] },
  [STATUS.SUBMITTED]: {
    [STATUS.APPROVED]: MANAGERS,
    [STATUS.IN_PROGRESS]: MANAGERS, // zwrot do poprawy
  },
  [STATUS.APPROVED]: {},
};

function canTransition(from, to, role) {
  return Boolean(TRANSITIONS[from]?.[to]?.includes(role));
}

/** Audytor może zmieniać odpowiedzi tylko po przydziale i dopóki raport nie został uzupełniony. */
function isEditable(status) {
  return status === STATUS.ASSIGNED || status === STATUS.IN_PROGRESS;
}

/** Przydział lub zmiana Tajemniczego Klienta jest możliwa, dopóki audytor nie zaczął pracy. */
function isAssignable(status) {
  return status === STATUS.ENTERED || status === STATUS.ASSIGNED;
}

module.exports = { STATUS, STATUS_LABELS, TRANSITIONS, canTransition, isEditable, isAssignable };
