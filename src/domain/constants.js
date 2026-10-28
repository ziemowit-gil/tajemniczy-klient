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

/** Zestawy ról do wyboru przy imporcie (Audytor jest zawsze; wartość to rola dodatkowa). */
const ROLE_SET_LABELS = {
  auditor: 'Tylko Audytor / Tajemniczy Klient',
  coordinator: 'Audytor + Koordynator (z przełączaniem ról)',
  administrator: 'Audytor + Administrator (z przełączaniem ról)',
};

const AREAS = Object.freeze({ OZN: 'OZN', EDU: 'KSZTALCENIE' });

const AREA_LABELS = {
  OZN: 'Dostępność dla OZN',
  KSZTALCENIE: 'Dostępność procesu kształcenia',
};

const SCENARIO_AREAS = { OZN: 'Tylko dostępność dla OZN', KSZTALCENIE: 'Tylko proces kształcenia', BOTH: 'Oba obszary' };

const SCENARIO_USAGE = { audit: 'Audyty obiektów', education: 'Dostępność kształcenia', both: 'Oba moduły' };

const OBJECT_TYPES = {
  uczelnia: 'Uczelnia', wydzial: 'Wydział', kampus: 'Kampus', budynek: 'Budynek',
  sklep: 'Sklep lub centrum handlowe', restauracja: 'Restauracja, kawiarnia lub bar', hotel: 'Hotel lub nocleg', urzad: 'Urząd lub instytucja',
  biblioteka: 'Biblioteka', kultura: 'Kultura i rozrywka (kino, teatr, muzeum)', zdrowie: 'Placówka zdrowia', transport: 'Transport i dworzec', inne: 'Inny obiekt',
};

const ANSWER_TYPE_LABELS = { scale: 'Skala 0–3', ternary: 'Tak / częściowo / nie' };

const STUDY_LEVELS = { I: 'Studia I stopnia', II: 'Studia II stopnia', jednolite: 'Jednolite magisterskie', podyplomowe: 'Studia podyplomowe' };
const STUDY_MODES = { stacjonarne: 'Stacjonarne', niestacjonarne: 'Niestacjonarne' };
const DISABILITIES = { ruchowa: 'Niepełnosprawność ruchowa', wzroku: 'Niepełnosprawność wzroku', sluchu: 'Niepełnosprawność słuchu', psychiczna: 'Niepełnosprawność psychiczna / neuroróżnorodność', inna: 'Inna' };

module.exports = {
  STUDY_LEVELS, STUDY_MODES, DISABILITIES, SCENARIO_USAGE,
  ROLES, ROLE_LABELS, ROLE_PRIORITY, ROLE_SET_LABELS, AREAS, AREA_LABELS, SCENARIO_AREAS, OBJECT_TYPES, ANSWER_TYPE_LABELS,
};
