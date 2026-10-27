/**
 * Dane demonstracyjne: użytkownicy testowi, uczelnia z wydziałem i budynkiem oraz audyty w każdym statusie.
 * Uruchomienie: npm run demo:seed  (tylko poza produkcją; idempotentne – nie dubluje danych).
 */
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { seedCatalog } = require('../src/db/seed');

const config = loadConfig();
if (config.isProd) {
  console.error('Dane demo nie mogą być tworzone w produkcji.');
  process.exit(1);
}

const { db, services } = createApp(config);
seedCatalog(db);
const { users, objects, audits, catalog } = services;

const person = (email, name, role) => users.upsertFromIdentity({ externalId: `dev:${email}`, name, email, role });
const admin = person('admin@demo.local', 'Anna Administrator', 'administrator');
const coord = person('koordynator@demo.local', 'Karol Koordynator', 'coordinator');
const aud1 = person('audytor1@demo.local', 'Ewa Audytorka', 'auditor');
const aud2 = person('audytor2@demo.local', 'Piotr Tajemniczy', 'auditor');

/** Oceny biura ds. OZN (osobny moduł); dodawane, jeśli jeszcze ich nie ma. */
function seedOffice() {
  if (db.prepare('SELECT COUNT(*) AS n FROM office_reviews').get().n > 0) return;
  const { office } = services;
  const uniList = objects.list().filter((o) => o.type === 'uczelnia');
  const make = (uni, programme, level, mode, disability, who, quality, finish) => {
    let r = office.create({ objectId: uni.id, programme, studyLevel: level, studyMode: mode, disability }, who.id);
    const answers = {};
    office.items(r.id).forEach((item, i) => {
      const good = ((i * 7) % 10) / 10 < quality;
      answers[item.id] = { answer: item.answer_type === 'scale' ? (good ? '3' : String(i % 2)) : (good ? 'tak' : 'nie'), comment: good ? '' : 'Biuro nie zapewniło tego elementu.' };
    });
    r = office.save(r, { answers: finish ? answers : Object.fromEntries(Object.entries(answers).slice(0, 5)), contactNotes: 'Kontakt e-mailowy i telefoniczny z biurem.', generalNotes: null });
    if (finish) office.submit(office.get(r.id), who);
    if (finish === 'approved') office.approve(office.get(r.id), coord, 'Zweryfikowano.');
  };
  const [u1, u2] = uniList;
  make(u1, 'Psychologia', 'I', 'stacjonarne', 'wzroku', aud1, 0.8, 'approved');
  make(u1, 'Psychologia', 'I', 'stacjonarne', 'ruchowa', aud2, 0.55, 'approved');
  make(u1, 'Informatyka', 'II', 'stacjonarne', 'sluchu', aud2, 0.35, 'approved');
  make(u2, 'Zarządzanie', 'I', 'niestacjonarne', 'ruchowa', aud1, 0.6, 'submitted');
  make(u2, 'Pedagogika', 'jednolite', 'stacjonarne', 'psychiczna', aud2, 0.5, null);
  console.log('Dodano oceny biur ds. OZN.');
}

if (db.prepare('SELECT COUNT(*) AS n FROM objects').get().n > 0) {
  console.log('Dane demo już istnieją – pomijam tworzenie obiektów i audytów.');
  seedOffice();
  db.close();
  process.exit(0);
}

const uni = objects.create({ name: 'Uniwersytet Przykładowy', type: 'uczelnia', parentId: null, address: 'ul. Akademicka 1, 00-001 Warszawa', coordinatorId: coord.id, notes: null });
const faculty = objects.create({ name: 'Wydział Nauk Społecznych', type: 'wydzial', parentId: uni.id, address: null, coordinatorId: null, notes: null });
const building = objects.create({ name: 'Budynek A – Collegium Novum', type: 'budynek', parentId: faculty.id, address: 'ul. Akademicka 3, 00-001 Warszawa', coordinatorId: null, notes: 'Zabytkowy, po remoncie 2022.' });
objects.create({ name: 'Politechnika Demonstracyjna', type: 'uczelnia', parentId: null, address: 'al. Techniczna 10, 30-001 Kraków', coordinatorId: coord.id, notes: null });

const scenarios = Object.fromEntries(catalog.scenarios.list().map((s) => [s.areas + s.title.length, s]));
const full = catalog.scenarios.list().find((s) => s.areas === 'BOTH');
void scenarios;

/** Wypełnia audyt deterministycznie; `quality` 0–1 steruje odsetkiem wysokich ocen. */
function fill(audit, quality) {
  const answers = {};
  audits.items(audit.id).forEach((item, i) => {
    const good = ((i * 7) % 10) / 10 < quality;
    const answer = item.answer_type === 'scale' ? (good ? '3' : String(i % 2)) : (good ? 'tak' : i % 3 === 0 ? 'czesciowo' : 'nie');
    answers[item.id] = { answer, comment: good ? '' : 'Stwierdzono braki podczas wizyty.' };
  });
  return audits.saveAnswers(audits.get(audit.id), { answers, generalNotes: 'Wizyta wykonana zgodnie ze scenariuszem.' });
}

// 1) zatwierdzony
let a = audits.create({ objectId: building.id, auditorId: aud1.id, scenarioId: full.id, dueDate: '2026-09-30' }, admin.id);
a = fill(a, 0.75);
audits.submit(audits.get(a.id), aud1);
audits.approve(audits.get(a.id), coord, 'Zgodne z wymaganiami.');

// 2) zatwierdzony – inny obiekt, żeby raport zbiorczy uczelni agregował kilka audytów
a = audits.create({ objectId: faculty.id, auditorId: aud2.id, scenarioId: full.id, dueDate: '2026-10-15' }, admin.id);
a = fill(a, 0.4);
audits.submit(audits.get(a.id), aud2);
audits.approve(audits.get(a.id), coord, null);

// 3) złożony – czeka na koordynatora
a = audits.create({ objectId: uni.id, auditorId: aud1.id, scenarioId: full.id, dueDate: '2026-11-15' }, admin.id);
a = fill(a, 0.6);
audits.submit(audits.get(a.id), aud1);

// 4) w trakcie – wypełniony częściowo
a = audits.create({ objectId: building.id, auditorId: aud2.id, scenarioId: catalog.scenarios.list().find((s) => s.areas === 'KSZTALCENIE').id, dueDate: '2026-12-01' }, admin.id);
const some = audits.items(a.id).slice(0, 4);
audits.saveAnswers(audits.get(a.id), {
  answers: Object.fromEntries(some.map((it) => [it.id, { answer: it.answer_type === 'scale' ? '2' : 'tak', comment: '' }])),
  generalNotes: null,
});

// 5) przypisany – jeszcze nie rozpoczęty
audits.create({ objectId: faculty.id, auditorId: aud1.id, scenarioId: catalog.scenarios.list().find((s) => s.areas === 'OZN').id, dueDate: '2026-12-20' }, admin.id);

seedOffice();
console.log(`Dane demo gotowe: ${db.prepare('SELECT COUNT(*) AS n FROM audits').get().n} audytów, ${db.prepare('SELECT COUNT(*) AS n FROM objects').get().n} obiektów.`);
db.close();
