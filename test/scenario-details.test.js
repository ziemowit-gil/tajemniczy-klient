const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignJWT } = require('jose');
const { DatabaseSync } = require('node:sqlite');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { migrate } = require('../src/db');
const { seedCatalog } = require('../src/db/seed');

const SECRET = 'szo-test-secret-szo-test-secret-1234';
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-sd-'));
const config = loadConfig({
  NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir,
  SESSION_SECRET: 'session-secret-session-secret-session-secret',
  SZO_AUTH_MODE: 'jwt', SZO_JWT_SECRET: SECRET, SZO_ROLE_MAP: JSON.stringify({ a: 'administrator', u: 'auditor', k: 'coordinator' }),
});
const { app, db, services } = createApp(config);
seedCatalog(db);

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

const key = new TextEncoder().encode(SECRET);
class Client {
  constructor() { this.jar = new Map(); }
  async req(method, url, data) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, { method, body: data ? new URLSearchParams(data) : undefined, headers: cookie ? { cookie } : {}, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) { const [p] = line.split(';'); const i = p.indexOf('='); this.jar.set(p.slice(0, i), p.slice(i + 1)); }
    return res;
  }
  get(u) { return this.req('GET', u); }
  post(u, d) { return this.req('POST', u, d ?? []); }
  async login(sub, role) {
    const t = await new SignJWT({ name: sub, role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('5m').sign(key);
    await this.get(`/auth/callback?token=${t}`);
    return this;
  }
}
const uid = (ext) => db.prepare('SELECT id FROM users WHERE external_id = ?').get(ext).id;
const idFrom = (res, re) => Number(re.exec(res.headers.get('location'))[1]);

const form = (over = {}) => [
  ['title', 'Scenariusz testowy'], ['usage', 'audit'], ['areas', 'OZN'], ['goal', 'Cel testowy'], ['persona', 'wzroku'],
  ['description', 'Opis'], ['steps', '1. Pierwszy krok\n\nDrugi krok\nTrzeci krok'], ['expectedResult', 'Wykaz barier'],
  ['estimatedMinutes', '45'], ['active', 'on'], ...Object.entries(over),
];
const withOver = (over) => { const m = new Map(form()); for (const [k, v] of Object.entries(over)) m.set(k, v); return [...m]; };

test('seed: scenariusze mają cel, kroki, personę i czas', () => {
  const s = services.catalog.scenarios.list({ usage: 'audit' }).find((x) => x.title === 'Student niewidomy lub słabowidzący');
  assert.equal(s.persona, 'wzroku');
  assert.ok(s.estimated_minutes > 0 && s.goal && s.step_count >= 4 && s.version === 1);
});

test('tworzenie scenariusza z krokami i walidacją pól', async () => {
  const adm = await new Client().login('adm', 'a');
  let res = await adm.post('/scenarios', form());
  assert.equal(res.status, 303);
  const id = idFrom(res, /\/scenarios\/(\d+)/);
  const s = services.catalog.scenarios.get(id);
  assert.equal(s.persona, 'wzroku');
  assert.equal(s.estimated_minutes, 45);
  assert.deepEqual(services.catalog.scenarios.steps(id).map((x) => x.text), ['Pierwszy krok', 'Drugi krok', 'Trzeci krok']);

  assert.equal((await adm.post('/scenarios', withOver({ estimatedMinutes: '9999' }))).status, 422);
  assert.equal((await adm.post('/scenarios', withOver({ persona: 'nieznana' }))).status, 422);
  assert.equal((await adm.post('/scenarios', withOver({ steps: Array(31).fill('x').join('\n') }))).status, 422);
  const html = await (await adm.get(`/scenarios/${id}`)).text();
  assert.match(html, /Trzeci krok/);
  assert.match(html, /Wykaz barier/);
});

test('wersje: zmiana treści podnosi wersję, zmiana aktywności nie, no-op nie', async () => {
  const adm = await new Client().login('adm', 'a');
  const id = db.prepare(`SELECT id FROM scenarios WHERE title = 'Scenariusz testowy'`).get().id;
  assert.equal(services.catalog.scenarios.get(id).version, 1);

  await adm.post(`/scenarios/${id}`, form());                                   // bez zmian
  assert.equal(services.catalog.scenarios.get(id).version, 1);
  await adm.post(`/scenarios/${id}`, form().filter(([k]) => k !== 'active'));  // tylko wyłączenie
  assert.equal(services.catalog.scenarios.get(id).version, 1);
  assert.equal(services.catalog.scenarios.get(id).active, 0);
  await adm.post(`/scenarios/${id}`, withOver({ goal: 'Nowy cel' }));          // zmiana celu
  assert.equal(services.catalog.scenarios.get(id).version, 2);
  await adm.post(`/scenarios/${id}`, withOver({ goal: 'Nowy cel', steps: 'Jedyny krok' }));  // zmiana kroków
  assert.equal(services.catalog.scenarios.get(id).version, 3);
  assert.deepEqual(services.catalog.scenarios.steps(id).map((x) => x.text), ['Jedyny krok']);
});

test('migawka: audyt zachowuje treść, kroki i wersję scenariusza z chwili przydziału', async () => {
  const adm = await new Client().login('adm', 'a');
  const aud = await new Client().login('aud', 'u');
  const other = await new Client().login('aud2', 'u');
  const obj = services.objects.create({ name: 'Obiekt Mig', type: 'budynek', parentId: null, address: null, coordinatorId: null, notes: null });
  let res = await adm.post('/scenarios', withOver({ title: 'Migawkowy', goal: 'Cel v1', steps: 'Krok A\nKrok B' }));
  const sid = idFrom(res, /\/scenarios\/(\d+)/);

  res = await adm.post('/audits', [['objectId', obj.id], ['auditorId', uid('aud')], ['scenarioIds', sid]]);
  const auditId = idFrom(res, /\/audits\/(\d+)/);
  const before = services.audits.scenarios(auditId)[0];
  assert.equal(before.version, 1);
  assert.deepEqual(before.steps.map((s) => s.text), ['Krok A', 'Krok B']);

  // zmiana w słowniku nie rusza audytu
  await adm.post(`/scenarios/${sid}`, withOver({ title: 'Migawkowy', goal: 'Cel v2', steps: 'Zupełnie inny krok' }));
  const after = services.audits.scenarios(auditId)[0];
  assert.equal(after.goal, 'Cel v1');
  assert.deepEqual(after.steps.map((s) => s.text), ['Krok A', 'Krok B']);
  assert.equal(after.outdated, true);
  const html = await (await aud.get(`/audits/${auditId}`)).text();
  assert.match(html, /Cel v1/);
  assert.match(html, /nowsza wersja tego scenariusza/);
  assert.doesNotMatch(html, /Zupełnie inny krok/);

  // nowy audyt dostaje nową wersję
  res = await adm.post('/audits', [['objectId', obj.id], ['auditorId', uid('aud')], ['scenarioIds', sid]]);
  const second = services.audits.scenarios(idFrom(res, /\/audits\/(\d+)/))[0];
  assert.equal(second.version, 2);
  assert.deepEqual(second.steps.map((s) => s.text), ['Zupełnie inny krok']);

  // odhaczanie kroków: zapis formularza przez audytora
  const [stepA, stepB] = after.steps;
  res = await aud.post(`/audits/${auditId}`, [['intent', 'save'], [`step_${stepA.id}`, 'on']]);
  assert.equal(res.status, 303);
  assert.deepEqual(services.audits.scenarios(auditId)[0].steps.map((s) => s.done), [1, 0]);
  assert.equal(services.audits.scenarios(auditId)[0].stepsDone, 1);
  await aud.post(`/audits/${auditId}`, [['intent', 'save'], [`step_${stepB.id}`, 'on']]);
  assert.deepEqual(services.audits.scenarios(auditId)[0].steps.map((s) => s.done), [0, 1], 'odznaczenie kroku A');
  assert.match(await (await aud.get(`/audits/${auditId}`)).text(), /Kroki \(wykonano 1 z 2\)/);

  // cudzy audytor nie może odhaczać kroków (404), administrator także nie edytuje
  assert.equal((await other.post(`/audits/${auditId}`, [[`step_${stepA.id}`, 'on']])).status, 404);
  assert.equal((await adm.post(`/audits/${auditId}`, [[`step_${stepA.id}`, 'on']])).status, 403);
  assert.deepEqual(services.audits.scenarios(auditId)[0].steps.map((s) => s.done), [0, 1]);

  // eksport CSV zawiera scenariusz i stan kroków
  const csv = await (await aud.get(`/audits/${auditId}/report.csv`)).text();
  assert.match(csv, /Migawkowy \(wersja 1\)/);
  assert.match(csv, /1\. Krok A;nie odhaczono/);
  assert.match(csv, /2\. Krok B;wykonano/);
  const pdf = Buffer.from(await (await aud.get(`/audits/${auditId}/report.pdf`)).arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('ocena kształcenia: migawka scenariusza, odhaczanie kroków i zachowanie stanu przy zmianie zestawu', async () => {
  const adm = await new Client().login('adm', 'a');
  const cand = await new Client().login('aud', 'u');
  const uni = services.objects.create({ name: 'Uczelnia Kroki', type: 'uczelnia', parentId: null, address: null, coordinatorId: null, notes: null });
  const [e1, e2] = services.catalog.scenarios.list({ usage: 'education' });

  let res = await adm.post('/office', [['objectId', uni.id], ['programme', 'Pedagogika'], ['studyLevel', 'I'], ['studyMode', 'stacjonarne'], ['disability', 'ruchowa'], ['auditorId', uid('aud')], ['scenarioIds', e1.id]]);
  const rid = idFrom(res, /\/office\/(\d+)/);
  const first = services.office.scenarios(rid)[0];
  assert.ok(first.steps.length >= 3);

  await cand.post(`/office/${rid}`, [['intent', 'save'], [`step_${first.steps[0].id}`, 'on'], [`step_${first.steps[1].id}`, 'on']]);
  assert.equal(services.office.scenarios(rid)[0].stepsDone, 2);

  // dodanie drugiego scenariusza nie kasuje odhaczeń pierwszego
  await adm.post(`/office/${rid}/scenarios`, [['scenarioIds', e1.id], ['scenarioIds', e2.id]]);
  const list = services.office.scenarios(rid);
  assert.equal(list.length, 2);
  assert.equal(list.find((s) => s.id === e1.id).stepsDone, 2);

  // zmiana w słowniku nie zmienia migawki oceny
  await adm.post(`/scenarios/${e1.id}`, [['title', e1.title], ['usage', 'education'], ['areas', 'KSZTALCENIE'], ['steps', 'Całkiem nowy krok'], ['active', 'on']]);
  assert.ok(services.office.scenarios(rid).find((s) => s.id === e1.id).steps.length >= 3);

  // usunięcie scenariusza z oceny kasuje jego migawkę i kroki
  await adm.post(`/office/${rid}/scenarios`, [['scenarioIds', e2.id]]);
  assert.deepEqual(services.office.scenarios(rid).map((s) => s.id), [e2.id]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM office_review_scenario_steps WHERE review_id = ? AND scenario_id = ?').get(rid, e1.id).n, 0);

  const html = await (await cand.get(`/office/${rid}`)).text();
  assert.match(html, /Szacowany czas/);
});

test('duplikowanie: kopia z krokami jako nieaktywny szkic w wersji 1', async () => {
  const adm = await new Client().login('adm', 'a');
  const src = services.catalog.scenarios.list().find((s) => s.title === 'Migawkowy');
  const res = await adm.post(`/scenarios/${src.id}/duplicate`);
  assert.equal(res.status, 303);
  const copyId = idFrom(res, /\/scenarios\/(\d+)\/edit/);
  const copy = services.catalog.scenarios.get(copyId);
  assert.equal(copy.title, 'Kopia: Migawkowy');
  assert.equal(copy.active, 0);
  assert.equal(copy.version, 1);
  assert.deepEqual(services.catalog.scenarios.steps(copyId).map((s) => s.text), services.catalog.scenarios.steps(src.id).map((s) => s.text));
  assert.equal(services.catalog.scenarios.inUse(copyId), false);
  const aud = await new Client().login('aud', 'u');
  assert.equal((await aud.post(`/scenarios/${src.id}/duplicate`)).status, 403);
});

test('podgląd i filtry listy scenariuszy', async () => {
  const adm = await new Client().login('adm', 'a');
  const used = services.catalog.scenarios.list().find((s) => s.title === 'Migawkowy');
  const html = await (await adm.get(`/scenarios/${used.id}`)).text();
  assert.match(html, /Użycie scenariusza/);
  assert.match(html, /Obiekt Mig/);
  assert.match(html, /Wersja scenariusza/);

  const eduHtml = await (await adm.get('/scenarios?usage=education')).text();
  assert.match(eduHtml, /Zapytanie e-mailowe/);
  assert.doesNotMatch(eduHtml, /Pełna ocena dostępności obiektu/);
  const inactive = await (await adm.get('/scenarios?active=0')).text();
  assert.match(inactive, /Kopia: Migawkowy/);
  assert.doesNotMatch(inactive, /Pełna ocena dostępności obiektu/);
  assert.equal((await adm.get('/scenarios?usage=zle&active=x')).status, 200, 'nieprawidłowe filtry są ignorowane');
  assert.equal((await adm.get('/scenarios/99999')).status, 404);

  const aud = await new Client().login('aud', 'u');
  assert.equal((await aud.get(`/scenarios/${used.id}`)).status, 403);
});

test('migracja 004: istniejące przypisania dostają migawkę z bieżącego scenariusza', () => {
  const dir = path.join(__dirname, '../src/db/migrations');
  const old = new DatabaseSync(':memory:');
  old.exec('PRAGMA foreign_keys = ON');
  old.exec(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  for (const f of ['001_init.sql', '002_office_reviews.sql', '003_multiple_scenarios.sql']) {
    old.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    old.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(f);
  }
  old.exec(`INSERT INTO users (external_id, name, role) VALUES ('x', 'X', 'auditor');
    INSERT INTO objects (name, type) VALUES ('O', 'budynek');
    INSERT INTO scenarios (title, description, areas) VALUES ('Stary', 'Stary opis', 'OZN');
    INSERT INTO audits (object_id, auditor_id, scenario_id) VALUES (1, 1, 1);
    INSERT INTO audit_scenarios (audit_id, scenario_id) VALUES (1, 1);`);
  migrate(old);
  const row = old.prepare('SELECT title, description, version FROM audit_scenarios').get();
  assert.deepEqual({ ...row }, { title: 'Stary', description: 'Stary opis', version: 1 });
  assert.equal(old.prepare('SELECT version FROM scenarios').get().version, 1);
});
