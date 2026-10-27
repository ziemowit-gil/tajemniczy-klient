const ROLES = Object.freeze({
  ADMIN: 'administrator',
  AUDITOR: 'auditor',
  COORDINATOR: 'coordinator',
});

const ROLE_LABELS = {
  administrator: 'Administrator',
  auditor: 'Audytor / Tajemniczy Klient',
  coordinator: 'Koordynator',
};

// Kolejność = priorytet, gdy SZO zwraca kilka ról naraz.
const ROLE_PRIORITY = [ROLES.ADMIN, ROLES.COORDINATOR, ROLES.AUDITOR];

const AREAS = Object.freeze({ OZN: 'OZN', EDU: 'KSZTALCENIE' });

const AREA_LABELS = {
  OZN: 'Dostępność dla OZN',
  KSZTALCENIE: 'Dostępność procesu kształcenia',
};

const SCENARIO_AREAS = { OZN: 'Tylko dostępność dla OZN', KSZTALCENIE: 'Tylko proces kształcenia', BOTH: 'Oba obszary' };

const SCENARIO_USAGE = { audit: 'Audyty obiektów', education: 'Dostępność kształcenia', both: 'Oba moduły' };

const OBJECT_TYPES = { uczelnia: 'Uczelnia', wydzial: 'Wydział', kampus: 'Kampus', budynek: 'Budynek' };

const ANSWER_TYPE_LABELS = { scale: 'Skala 0–3', ternary: 'Tak / częściowo / nie' };

const STUDY_LEVELS = { I: 'Studia I stopnia', II: 'Studia II stopnia', jednolite: 'Jednolite magisterskie', podyplomowe: 'Studia podyplomowe' };
const STUDY_MODES = { stacjonarne: 'Stacjonarne', niestacjonarne: 'Niestacjonarne' };
const DISABILITIES = { ruchowa: 'Niepełnosprawność ruchowa', wzroku: 'Niepełnosprawność wzroku', sluchu: 'Niepełnosprawność słuchu', psychiczna: 'Niepełnosprawność psychiczna / neuroróżnorodność', inna: 'Inna' };

module.exports = {
  STUDY_LEVELS, STUDY_MODES, DISABILITIES, SCENARIO_USAGE,
  ROLES, ROLE_LABELS, ROLE_PRIORITY, AREAS, AREA_LABELS, SCENARIO_AREAS, OBJECT_TYPES, ANSWER_TYPE_LABELS,
};
