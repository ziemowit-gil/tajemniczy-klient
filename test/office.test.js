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
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-office-'));
const config = loadConfig({
  NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir,
  SESSION_SECRET: 'session-secret-session-secret-session-secret',
  SZO_AUTH_MODE: 'jwt', SZO_JWT_SECRET: SECRET,
  SZO_ROLE_MAP: JSON.stringify({ a: 'administrator', u: 'auditor', k: 'coordinator' }),
});
const { app, db, services } = createApp(config);
seedCatalog(db);

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

const key = new TextEncoder().encode(SECRET);
class Client {
  constructor() { this.jar = new Map(); }
  async req(method, url, data, headers = {}) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, { method, body: data ? new URLSearchParams(data) : undefined, headers: { ...(cookie ? { cookie } : {}), ...headers }, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) { const [p] = line.split(';'); const i = p.indexOf('='); this.jar.set(p.slice(0, i), p.slice(i + 1)); }
    return res;
  }
  get(u) { return this.req('GET', u); }
  post(u, d) { return this.req('POST', u, d ?? {}); }
  async login(sub, role) {
    const t = await new SignJWT({ name: sub, role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('5m').sign(key);
    assert.equal((await this.get(`/auth/callback?token=${t}`)).status, 303);
    return this;
  }
}
const as = (sub, role) => new Client().login(sub, role);
const uid = (ext) => db.prepare('SELECT id FROM users WHERE external_id = ?').get(ext).id;

test('moduł „Dostępność kształcenia”: pełny przepływ kandydata, izolacja i raport', async () => {
  const adm = await as('adm', 'a');
  const coord = await as('koord', 'k');
  const other = await as('koord2', 'k');
  const cand = await as('kandydat', 'u');
  const cand2 = await as('kandydat2', 'u');

  await adm.post('/objects', { name: 'Uczelnia Alfa', type: 'uczelnia', coordinatorId: uid('koord') });
  await adm.post('/objects', { name: 'Budynek Alfa', type: 'budynek' });
  const uniId = db.prepare(`SELECT id FROM objects WHERE name = 'Uczelnia Alfa'`).get().id;
  const bldId = db.prepare(`SELECT id FROM objects WHERE name = 'Budynek Alfa'`).get().id;

  // tylko audytor tworzy oceny; tylko uczelnia może być oceniana
  assert.equal((await adm.get('/office/new')).status, 403);
  assert.equal((await cand.post('/office', { objectId: uniId, programme: '', studyLevel: 'I', studyMode: 'stacjonarne', disability: 'wzroku' })).status, 422);
  assert.equal((await cand.post('/office', { objectId: bldId, programme: 'Psychologia', studyLevel: 'I', studyMode: 'stacjonarne', disability: 'wzroku' })).status, 422);

  let res = await cand.post('/office', { objectId: uniId, programme: 'Psychologia', studyLevel: 'I', studyMode: 'stacjonarne', disability: 'wzroku' });
  assert.equal(res.status, 303);
  const id = Number(/\/office\/(\d+)/.exec(res.headers.get('location'))[1]);
  const items = services.office.items(id);
  assert.equal(items.length, 14);

  // izolacja
  assert.equal((await cand2.get(`/office/${id}`)).status, 404);
  assert.equal((await other.get(`/office/${id}`)).status, 404);
  assert.equal((await coord.get(`/office/${id}`)).status, 200);
  assert.equal((await cand.get('/office/report')).status, 403);

  // niepełne złożenie odrzucone
  await cand.post(`/office/${id}`, { intent: 'save', contactNotes: 'Mail do biura', [`answer_${items[0].id}`]: '3' });
  assert.equal((await cand.post(`/office/${id}`, { intent: 'submit' })).status, 422);
  assert.equal(services.office.get(id).status, 'in_progress');

  // pełne wypełnienie: pierwsza połowa 3/tak, reszta 0/nie
  const form = { intent: 'submit' };
  items.forEach((it, i) => { form[`answer_${it.id}`] = i < 7 ? (it.answer_type === 'scale' ? '3' : 'tak') : (it.answer_type === 'scale' ? '0' : 'nie'); });
  assert.equal((await cand.post(`/office/${id}`, form)).status, 303);
  assert.equal(services.office.get(id).status, 'submitted');
  assert.equal((await cand.post(`/office/${id}`, { intent: 'save' })).status, 403);
  assert.equal((await cand.post(`/office/${id}/approve`)).status, 403);

  // zatwierdzenie, raport zbiorczy tylko z zatwierdzonych
  assert.equal(services.office.report({ id: uid('adm'), role: 'administrator' }).totalReviews, 0);
  assert.equal((await coord.post(`/office/${id}/approve`, { comment: 'OK' })).status, 303);
  assert.equal(services.office.get(id).status, 'approved');

  const report = services.office.report({ id: uid('koord'), role: 'coordinator' });
  assert.equal(report.totalReviews, 1);
  const u = report.universities[0];
  assert.equal(u.name, 'Uczelnia Alfa');
  assert.equal(u.programmes[0].name, 'Psychologia');
  const w = items.map((it, i) => [it.weight, i < 7]);
  const expected = Math.round((w.filter(([, g]) => g).reduce((s, [x]) => s + x, 0) / w.reduce((s, [x]) => s + x, 0)) * 1000) / 10;
  assert.equal(u.score.percent, expected);

  // koordynator spoza zakresu nie widzi raportu uczelni
  assert.equal(services.office.report({ id: uid('koord2'), role: 'coordinator' }).totalReviews, 0);

  // raport HTML i CSV
  res = await coord.get('/office/report');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Uczelnia Alfa/);
  res = await coord.get('/office/report.csv');
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(await res.text(), /Psychologia/);

  // wyniki audytów nie są zmieniane przez oceny biura
  assert.equal(services.reports.forObject(uniId).audits.length, 0);

  // zatwierdzonej oceny nie można usunąć
  assert.equal((await adm.post(`/office/${id}/delete`)).status, 403);
});

test('pytania ankiety: administrator zarządza, edycja nie zmienia rozpoczętych ocen', async () => {
  const adm = await as('adm2', 'a');
  const cand = await as('kandydat3', 'u');
  assert.equal((await cand.get('/office/questions')).status, 403);

  const q = services.office.questions.list()[0];
  const uni = services.objects.create({ name: 'Uczelnia Beta', type: 'uczelnia', parentId: null, address: null, coordinatorId: null, notes: null });
  const res = await cand.post('/office', { objectId: uni.id, programme: 'Informatyka', studyLevel: 'II', studyMode: 'niestacjonarne', disability: 'ruchowa' });
  const id = Number(/\/office\/(\d+)/.exec(res.headers.get('location'))[1]);
  const before = db.prepare('SELECT text FROM office_review_items WHERE review_id = ? AND question_id = ?').get(id, q.id).text;

  assert.equal((await adm.post(`/office/questions/${q.id}`, { code: q.code, category: q.category, text: 'Zmieniona treść', weight: '2', answerType: 'ternary', position: '1', active: 'on' })).status, 303);
  assert.equal(services.office.questions.get(q.id).text, 'Zmieniona treść');
  assert.equal(db.prepare('SELECT text FROM office_review_items WHERE review_id = ? AND question_id = ?').get(id, q.id).text, before);

  // walidacja: waga poza zakresem, zduplikowany kod
  assert.equal((await adm.post(`/office/questions/${q.id}`, { code: q.code, category: 'x', text: 'y', weight: '9', answerType: 'scale' })).status, 422);
  const other = services.office.questions.list()[1];
  assert.equal((await adm.post(`/office/questions/${q.id}`, { code: other.code, category: 'x', text: 'y', weight: '3', answerType: 'scale' })).status, 422);
});
