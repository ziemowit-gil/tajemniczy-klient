const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignJWT } = require('jose');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { seedCatalog } = require('../src/db/seed');
const { PACKS, importPack } = require('../src/db/scenarioPacks');
const { scenarioSchema, parseForm } = require('../src/validation/schemas');
const { DISABILITIES, SCENARIO_USAGE } = require('../src/domain/constants');

const SECRET = 'szo-test-secret-szo-test-secret-1234';
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-pack-'));
const config = loadConfig({
  NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir, SESSION_SECRET: 'session-secret-session-secret-session-secret',
  SZO_AUTH_MODE: 'jwt', SZO_JWT_SECRET: SECRET, SZO_ROLE_MAP: JSON.stringify({ a: 'administrator', u: 'auditor' }),
});
const { app, db, services } = createApp(config);
seedCatalog(db);

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

const key = new TextEncoder().encode(SECRET);
async function login(sub, role) {
  const token = await new SignJWT({ name: sub, role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('5m').sign(key);
  const res = await fetch(`${base}/auth/callback?token=${token}`, { redirect: 'manual' });
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const call = (cookie, method, url, data) => fetch(base + url, { method, headers: { cookie }, body: data ? new URLSearchParams(data) : undefined, redirect: 'manual' });

const pack = PACKS.uczelnie;

test('paczka „uczelnie”: 7 grup potrzeb × (scenariusz zaplanowany + wizyta bez zapowiedzi), kompletna i poprawna', () => {
  assert.equal(pack.scenarios.length, 17);
  const byUsage = (u) => pack.scenarios.filter((s) => s.usage === u);
  assert.equal(byUsage('education').length, 9, 'moduł Dostępność kształcenia');
  assert.equal(byUsage('audit').length, 8, 'audyty obiektów');
  assert.equal(byUsage('audit').filter((s) => /^Bez zapowiedzi:/.test(s.title)).length, 7, 'wizyty bez zapowiedzi');
  assert.equal(new Set(pack.scenarios.map((s) => s.title.toLowerCase())).size, 17, 'tytuły są unikalne');

  // wszystkie grupy potrzeb z wiadomości źródłowej są pokryte
  const personas = new Set(pack.scenarios.map((s) => s.persona));
  for (const p of ['sluchu', 'ruchowa', 'wzroku', 'inna', 'psychiczna']) assert.ok(personas.has(p), `persona ${p}`);
  assert.ok(pack.scenarios.filter((s) => s.persona === 'sluchu').length >= 4, 'Głusi i niedosłyszący w obu wariantach');

  for (const sc of pack.scenarios) {
    assert.ok(sc.goal && sc.expectedResult && sc.description, sc.title);
    assert.ok(sc.steps.length >= 4 && sc.steps.every((x) => x.length > 15 && x.length <= 300), `kroki: ${sc.title}`);
    assert.ok(sc.estimatedMinutes >= 1 && sc.estimatedMinutes <= 600);
    assert.ok((sc.persona === null || Object.hasOwn(DISABILITIES, sc.persona)) && Object.hasOwn(SCENARIO_USAGE, sc.usage));
    // ten sam walidator co formularz administratora
    const { ok, errors } = parseForm(scenarioSchema, {
      title: sc.title, description: sc.description, goal: sc.goal, persona: sc.persona || '', expectedResult: sc.expectedResult,
      estimatedMinutes: String(sc.estimatedMinutes), steps: sc.steps.join('\n'), areas: sc.areas || 'KSZTALCENIE', usage: sc.usage, active: 'on',
    });
    assert.ok(ok, `${sc.title}: ${JSON.stringify(errors)}`);
  }
  // wizyta w Centrum Dostępności: wariant zaplanowany (kształcenie) i kontrola lokalu (audyt)
  const centre = pack.scenarios.filter((s) => /^Wizyta w Centrum Dostępności/.test(s.title));
  assert.deepEqual(centre.map((s) => s.usage).sort(), ['audit', 'education']);
  assert.ok(centre.every((s) => s.persona === null && s.steps.some((x) => /pętl/i.test(x)) && s.steps.some((x) => /czytnik/i.test(x))));
  assert.equal(centre.find((s) => s.usage === 'audit').areas, 'BOTH');
  // scenariusz porównawczy: ten sam kierunek, różne niepełnosprawności, bez przypisanej jednej persony
  const compare = pack.scenarios.find((s) => /^Kandydat zainteresowany kierunkiem/.test(s.title));
  assert.ok(compare, 'jest scenariusz porównawczy dla kierunku');
  assert.equal(compare.usage, 'education');
  assert.equal(compare.persona, null, 'obejmuje różne grupy potrzeb');
  assert.match(compare.description, /co najmniej dwa razy/);
  assert.match(compare.description, /Wcielam się w osobę z/);
  assert.ok(compare.steps.some((x) => /drugiej, innej grupy potrzeb/.test(x)) && compare.steps.some((x) => /Porównaj odpowiedzi/.test(x)));
  // scenariusze „kryzys” mają zabezpieczenie etyczne; scenariusze ADHD przypominają, by nie ujawniać diagnozy
  assert.ok(pack.scenarios.filter((s) => /kryzys|trudnej sytuacji psychicznej/.test(s.title)).every((s) => /bez odgrywania realnego kryzysu/.test(s.description)));
  const adhd = pack.scenarios.filter((s) => /ADHD/.test(s.title));
  assert.equal(adhd.length, 2, 'ADHD w obu wariantach');
  assert.deepEqual(adhd.map((s) => s.usage).sort(), ['audit', 'education']);
  assert.ok(adhd.every((s) => s.persona === 'psychiczna' && /Nie ujawniaj diagnozy/.test(s.description)));
  assert.ok(adhd.every((s) => s.steps.some((x) => /przypomnie|podsumowani/i.test(x))), 'kroki dotyczą przypomnień i pisemnych podsumowań');
});

test('import: dodaje 17 scenariuszy z krokami, jest idempotentny i nie nadpisuje zmian administratora', () => {
  const before = services.catalog.scenarios.list().length;
  const first = importPack(db, 'uczelnie');
  assert.equal(first.added.length, 17);
  assert.equal(first.skipped.length, 0);
  assert.equal(services.catalog.scenarios.list().length, before + 17);

  const g = db.prepare(`SELECT * FROM scenarios WHERE title = 'Osoba Głucha: kontakt z uczelnią i wideorozmowa z tłumaczem PJM'`).get();
  assert.equal(g.usage, 'education');
  assert.equal(g.persona, 'sluchu');
  assert.equal(g.active, 1);
  assert.equal(g.version, 1);
  assert.equal(services.catalog.scenarios.steps(g.id).length, 5);

  // administrator zmienia treść i usuwa jeden scenariusz — ponowny import niczego nie nadpisuje ani nie odtwarza zmienionego
  db.prepare('UPDATE scenarios SET goal = ? WHERE id = ?').run('Cel zmieniony przez administratora', g.id);
  const removed = db.prepare(`SELECT id FROM scenarios WHERE title LIKE 'Bez zapowiedzi: osoba Głucha%'`).get().id;
  db.prepare('DELETE FROM scenarios WHERE id = ?').run(removed);
  const second = importPack(db, 'uczelnie');
  assert.equal(second.added.length, 1, 'odtworzony tylko usunięty');
  assert.equal(second.skipped.length, 16);
  assert.equal(db.prepare('SELECT goal FROM scenarios WHERE id = ?').get(g.id).goal, 'Cel zmieniony przez administratora');

  assert.throws(() => importPack(db, 'nie-ma'), /Nieznana paczka/);
  const third = importPack(db, 'uczelnie');
  assert.equal(third.added.length, 0);
});

test('panel: przycisk importu tylko dla administratora; po imporcie scenariusze są użyteczne w audytach i ocenach', async () => {
  db.exec(`DELETE FROM scenario_steps WHERE scenario_id IN (SELECT id FROM scenarios WHERE title LIKE 'Bez zapowiedzi:%' OR title LIKE 'Osoba %')`);
  db.exec(`DELETE FROM scenarios WHERE title LIKE 'Bez zapowiedzi:%' OR title LIKE 'Osoba %'`);
  const admin = await login('adm', 'a');
  const auditor = await login('aud', 'u');

  const html = await (await call(admin, 'GET', '/scenarios')).text();
  assert.match(html, /Przykładowe scenariusze dla uczelni/);
  assert.match(html, /Do zaimportowania: 14/);
  assert.equal((await call(auditor, 'POST', '/scenarios/import-pack', { pack: 'uczelnie' })).status, 403);
  assert.equal((await call(admin, 'POST', '/scenarios/import-pack', { pack: 'nieznana' })).status, 404);

  const res = await call(admin, 'POST', '/scenarios/import-pack', { pack: 'uczelnie' });
  assert.equal(res.status, 303);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM scenarios WHERE title LIKE 'Bez zapowiedzi:%' OR title LIKE 'Osoba %'`).get().n, 14);
  const after = await (await call(admin, 'GET', '/scenarios')).text();
  assert.match(after, /Wszystkie scenariusze z tej paczki są już w słowniku/);

  // scenariusze dobrze trafiają do właściwych modułów
  assert.equal(services.catalog.scenarios.list({ usage: 'education', onlyActive: true }).filter((s) => /^Osoba /.test(s.title)).length, 7);
  assert.equal(services.catalog.scenarios.list({ usage: 'audit', onlyActive: true }).filter((s) => /^Bez zapowiedzi:/.test(s.title)).length, 7);

  // użycie w audycie i w ocenie kształcenia
  const auditorUser = services.users.findById(db.prepare(`SELECT id FROM users WHERE external_id = 'aud'`).get().id);
  const adminUser = db.prepare(`SELECT id FROM users WHERE external_id = 'adm'`).get();
  const uni = services.objects.create({ name: 'Uczelnia Pakietowa', type: 'uczelnia', parentId: null, address: null, coordinatorId: null, notes: null });
  const audit = services.audits.create({
    objectId: uni.id, auditorId: auditorUser.id, dueDate: null,
    scenarioIds: [db.prepare(`SELECT id FROM scenarios WHERE title = 'Bez zapowiedzi: osoba niewidoma lub słabowidząca od przystanku do biura'`).get().id],
  }, adminUser.id);
  const snap = services.audits.scenarios(audit.id)[0];
  assert.equal(snap.persona, 'wzroku');
  assert.equal(snap.steps.length, 5);
  assert.ok(services.audits.items(audit.id).length > 20, 'scenariusz BOTH daje kryteria obu obszarów');

  const review = services.office.create({
    objectId: uni.id, programme: 'Prawo', studyLevel: 'I', studyMode: 'stacjonarne', disability: 'ruchowa',
    scenarioIds: [db.prepare(`SELECT id FROM scenarios WHERE title = 'Osoba z potrzebami ruchowymi: spotkanie z asystą od drzwi'`).get().id],
  }, auditorUser.id);
  assert.equal(services.office.scenarios(review.id)[0].steps.length, 6);

  // scenariusz z paczki jest zablokowany przed usunięciem po użyciu
  const used = db.prepare(`SELECT id FROM scenarios WHERE title LIKE 'Bez zapowiedzi: osoba niewidoma%'`).get().id;
  await call(admin, 'POST', `/scenarios/${used}/delete`);
  assert.ok(services.catalog.scenarios.get(used));
});
