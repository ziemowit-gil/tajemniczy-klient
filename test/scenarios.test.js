const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignJWT } = require('jose');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { seedCatalog } = require('../src/db/seed');

const SECRET = 'szo-test-secret-szo-test-secret-1234';
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-scen-'));
const config = loadConfig({
  NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir,
  SESSION_SECRET: 'session-secret-session-secret-session-secret',
  SZO_AUTH_MODE: 'jwt', SZO_JWT_SECRET: SECRET, SZO_ROLE_MAP: JSON.stringify({ a: 'administrator', u: 'auditor' }),
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
    // URLSearchParams z tablicy par pozwala wysłać to samo pole kilka razy (checkboxy)
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
const scen = (title) => db.prepare('SELECT * FROM scenarios WHERE title = ?').get(title);

test('seed: scenariusze audytów i kształcenia są rozdzielone wg zakresu użycia', () => {
  const audit = services.catalog.scenarios.list({ usage: 'audit' });
  const edu = services.catalog.scenarios.list({ usage: 'education' });
  assert.ok(audit.length >= 5 && edu.length >= 4);
  assert.ok(audit.every((s) => s.usage !== 'education'));
  assert.ok(edu.every((s) => s.usage !== 'audit'));
});

test('audyt z wieloma scenariuszami: suma zakresów kryteriów bez dubli, wszystkie scenariusze zapisane', async () => {
  const adm = await new Client().login('adm', 'a');
  await new Client().login('aud', 'u');
  services.objects.create({ name: 'Obiekt Wielo', type: 'budynek', parentId: null, address: null, coordinatorId: null, notes: null });
  const objectId = db.prepare(`SELECT id FROM objects WHERE name = 'Obiekt Wielo'`).get().id;

  const ozn = scen('Kandydat na studia z niepełnosprawnością ruchową');            // OZN
  const edu = scen('Proces kształcenia: wsparcie i egzaminy');                        // KSZTALCENIE
  const both = scen('Pełna ocena dostępności obiektu');                              // BOTH
  const total = db.prepare('SELECT COUNT(*) AS n FROM criteria WHERE active = 1').get().n;
  const oznCount = db.prepare(`SELECT COUNT(*) AS n FROM criteria WHERE active = 1 AND area = 'OZN'`).get().n;

  // dwa scenariusze o rozłącznych zakresach → oba obszary
  let res = await adm.post('/audits', [['objectId', objectId], ['auditorId', uid('aud')], ['scenarioIds', ozn.id], ['scenarioIds', edu.id]]);
  assert.equal(res.status, 303);
  const a1 = Number(/\/audits\/(\d+)/.exec(res.headers.get('location'))[1]);
  assert.equal(services.audits.items(a1).length, total);
  assert.deepEqual(services.audits.scenarios(a1).map((s) => s.id).sort(), [ozn.id, edu.id].sort());
  assert.equal(services.audits.get(a1).scenario_id, ozn.id, 'pierwszy wybrany = scenariusz główny');
  assert.match(services.audits.get(a1).scenario_title, /; /);

  // zachodzące na siebie zakresy → kryteria się nie powtarzają
  res = await adm.post('/audits', [['objectId', objectId], ['auditorId', uid('aud')], ['scenarioIds', both.id], ['scenarioIds', ozn.id]]);
  const a2 = Number(/\/audits\/(\d+)/.exec(res.headers.get('location'))[1]);
  assert.equal(services.audits.items(a2).length, total);

  // pojedynczy scenariusz OZN → tylko kryteria OZN
  res = await adm.post('/audits', [['objectId', objectId], ['auditorId', uid('aud')], ['scenarioIds', ozn.id]]);
  const a3 = Number(/\/audits\/(\d+)/.exec(res.headers.get('location'))[1]);
  assert.equal(services.audits.items(a3).length, oznCount);

  // strona audytu pokazuje scenariusze i ich instrukcje
  const auditor = await new Client().login('aud', 'u');
  const html = await (await auditor.get(`/audits/${a1}`)).text();
  assert.match(html, /Scenariusze do wykonania/);
  assert.match(html, /Kandydat na studia z niepełnosprawnością ruchową/);
});

test('audyt: brak scenariusza, scenariusz kształcenia i nieistniejący są odrzucane', async () => {
  const adm = await new Client().login('adm', 'a');
  const objectId = db.prepare(`SELECT id FROM objects WHERE name = 'Obiekt Wielo'`).get().id;
  const before = db.prepare('SELECT COUNT(*) AS n FROM audits').get().n;

  let res = await adm.post('/audits', [['objectId', objectId], ['auditorId', uid('aud')]]);
  assert.equal(res.status, 422);
  assert.match(await res.text(), /wybierz co najmniej jeden/);

  const eduOnly = db.prepare(`SELECT id FROM scenarios WHERE usage = 'education' LIMIT 1`).get().id;
  res = await adm.post('/audits', [['objectId', objectId], ['auditorId', uid('aud')], ['scenarioIds', eduOnly]]);
  assert.equal(res.status, 422);
  res = await adm.post('/audits', [['objectId', objectId], ['auditorId', uid('aud')], ['scenarioIds', 99999]]);
  assert.equal(res.status, 422);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audits').get().n, before);
});

test('ocena kształcenia: scenariusze opcjonalne, tylko z modułu kształcenia', async () => {
  const cand = await new Client().login('aud', 'u');
  const uni = services.objects.create({ name: 'Uczelnia Scen', type: 'uczelnia', parentId: null, address: null, coordinatorId: null, notes: null });
  const base2 = [['objectId', uni.id], ['programme', 'Psychologia'], ['studyLevel', 'I'], ['studyMode', 'stacjonarne'], ['disability', 'sluchu']];
  const eduScenarios = services.catalog.scenarios.list({ usage: 'education' }).slice(0, 2);

  // bez scenariuszy też działa
  let res = await cand.post('/office', base2);
  assert.equal(res.status, 303);
  const r0 = Number(/\/office\/(\d+)/.exec(res.headers.get('location'))[1]);
  assert.deepEqual(services.office.scenarios(r0), []);

  // z dwoma scenariuszami
  res = await cand.post('/office', [...base2, ...eduScenarios.map((s) => ['scenarioIds', s.id])]);
  assert.equal(res.status, 303);
  const r1 = Number(/\/office\/(\d+)/.exec(res.headers.get('location'))[1]);
  assert.equal(services.office.scenarios(r1).length, 2);
  const html = await (await cand.get(`/office/${r1}`)).text();
  assert.match(html, /Scenariusze do wykonania/);
  assert.match(html, new RegExp(eduScenarios[0].title.slice(0, 20)));
  assert.match(await (await cand.get('/office')).text(), new RegExp(eduScenarios[1].title.slice(0, 20)));

  // scenariusz audytowy nie jest dozwolony w kształceniu
  const auditOnly = db.prepare(`SELECT id FROM scenarios WHERE usage = 'audit' LIMIT 1`).get().id;
  res = await cand.post('/office', [...base2, ['scenarioIds', auditOnly]]);
  assert.equal(res.status, 422);
});

test('słownik: scenariusz użyty w audycie lub ocenie nie może być usunięty; użycie jest edytowalne', async () => {
  const adm = await new Client().login('adm', 'a');
  const used = scen('Kandydat na studia z niepełnosprawnością ruchową');
  await adm.post(`/scenarios/${used.id}/delete`);
  assert.ok(services.catalog.scenarios.get(used.id), 'użyty w audycie');

  const eduUsed = services.catalog.scenarios.list({ usage: 'education' })[0];
  await adm.post(`/scenarios/${eduUsed.id}/delete`);
  assert.ok(services.catalog.scenarios.get(eduUsed.id), 'użyty w ocenie kształcenia');

  let res = await adm.post('/scenarios', [['title', 'Nowy wspólny'], ['areas', 'BOTH'], ['usage', 'both'], ['active', 'on']]);
  assert.equal(res.status, 303);
  const created = scen('Nowy wspólny');
  assert.ok(services.catalog.scenarios.list({ usage: 'audit' }).some((s) => s.id === created.id));
  assert.ok(services.catalog.scenarios.list({ usage: 'education' }).some((s) => s.id === created.id));

  res = await adm.post('/scenarios', [['title', 'Zły'], ['areas', 'BOTH'], ['usage', 'nieznane']]);
  assert.equal(res.status, 422);
  await adm.post(`/scenarios/${created.id}/delete`);
  assert.equal(services.catalog.scenarios.get(created.id), undefined);
});

test('migracja 003 przenosi istniejące audyty do audit_scenarios', () => {
  const orphan = db.prepare(`SELECT COUNT(*) AS n FROM audits a WHERE NOT EXISTS (SELECT 1 FROM audit_scenarios x WHERE x.audit_id = a.id)`).get().n;
  assert.equal(orphan, 0);
});
