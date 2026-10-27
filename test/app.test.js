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
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-uploads-'));

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_PATH: ':memory:',
  UPLOAD_DIR: uploadDir,
  SESSION_SECRET: 'session-secret-session-secret-session-secret',
  SZO_AUTH_MODE: 'jwt',
  SZO_JWT_SECRET: SECRET,
  SZO_JWT_ISSUER: 'szo',
  SZO_ROLE_MAP: JSON.stringify({ tk_admin: 'administrator', tk_audytor: 'auditor', tk_koordynator: 'coordinator' }),
});

const { app, db, services } = createApp(config);
seedCatalog(db);

let server;
let base;

test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

const key = new TextEncoder().encode(SECRET);
const token = (claims, opts = {}) => new SignJWT({ name: claims.sub, ...claims })
  .setProtectedHeader({ alg: 'HS256' }).setIssuer(opts.issuer ?? 'szo').setExpirationTime(opts.exp ?? '5m').sign(key);

/** Prosty klient z cookie jar; przekierowań nie śledzi. */
class Client {
  constructor() { this.cookies = new Map(); }

  async request(method, url, { body, headers = {} } = {}) {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, { method, body, headers: { ...(cookie ? { cookie } : {}), ...headers }, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (value === '' || /Expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name); else this.cookies.set(name, value);
    }
    return res;
  }

  get(url, headers) { return this.request('GET', url, { headers }); }
  post(url, data, headers) {
    const body = data instanceof FormData ? data : new URLSearchParams(data);
    return this.request('POST', url, { body, headers });
  }

  async loginAs(claims) {
    const res = await this.get(`/auth/callback?token=${await token(claims)}`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/');
    return this;
  }
}

const admin = () => new Client().loginAs({ sub: 'u-admin', name: 'Anna Admin', role: 'tk_admin' });
const auditor = (n = 1) => new Client().loginAs({ sub: `u-aud${n}`, name: `Audytor ${n}`, role: 'tk_audytor' });
const coordinator = () => new Client().loginAs({ sub: 'u-koord', name: 'Karol Koordynator', role: 'tk_koordynator' });

const userId = (externalId) => db.prepare('SELECT id FROM users WHERE external_id = ?').get(externalId).id;

test('niezalogowany jest przekierowany na /login, a API zwraca 401', async () => {
  const c = new Client();
  const res = await c.get('/audits');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login');
  const api = await c.get('/audits', { accept: 'application/json' });
  assert.equal(api.status, 401);
  assert.equal((await c.get('/healthz')).status, 200);
});

test('nagłówek Bearer z poprawnym tokenem SZO daje dostęp, zły token – 401', async () => {
  const ok = await fetch(`${base}/audits`, { headers: { authorization: `Bearer ${await token({ sub: 'u-bearer', role: 'tk_audytor' })}`, accept: 'application/json' } });
  assert.equal(ok.status, 200);
  const bad = await fetch(`${base}/audits`, { headers: { authorization: 'Bearer nieprawidlowy.token.tu', accept: 'application/json' } });
  assert.equal(bad.status, 401);
  const wrongIssuer = await fetch(`${base}/audits`, { headers: { authorization: `Bearer ${await token({ sub: 'x' }, { issuer: 'inny' })}`, accept: 'application/json' } });
  assert.equal(wrongIssuer.status, 401);
  const expired = await fetch(`${base}/audits`, { headers: { authorization: `Bearer ${await token({ sub: 'x' }, { exp: Math.floor(Date.now() / 1000) - 60 })}`, accept: 'application/json' } });
  assert.equal(expired.status, 401);
});

test('callback z błędnym tokenem nie tworzy sesji', async () => {
  const c = new Client();
  const res = await c.get('/auth/callback?token=smiec');
  assert.equal(res.headers.get('location'), '/login?error=1');
  assert.equal(c.cookies.has('tk_session'), false);
});

test('role: audytor nie wejdzie do panelu administratora', async () => {
  const c = await auditor();
  for (const url of ['/criteria', '/users', '/objects/new', '/audits/new', '/reports']) {
    assert.equal((await c.get(url)).status, 403, url);
  }
});

test('CSRF: żądanie POST z obcym Origin jest odrzucane', async () => {
  const c = await admin();
  const res = await c.post('/objects', { name: 'X', type: 'uczelnia' }, { origin: 'https://evil.example' });
  assert.equal(res.status, 403);
});

test('CSRF: formularz z przeglądarki (Origin: null, Sec-Fetch-Site: same-origin) jest akceptowany, cross-site nie', async () => {
  const c = await admin();
  const ok = await c.post('/objects', { name: '', type: 'uczelnia' }, { origin: 'null', 'sec-fetch-site': 'same-origin' });
  assert.equal(ok.status, 422); // przeszło CSRF, odrzucone dopiero przez walidację
  const cross = await c.post('/objects', { name: 'X', type: 'uczelnia' }, { origin: base, 'sec-fetch-site': 'cross-site' });
  assert.equal(cross.status, 403);
  const nullOrigin = await c.post('/objects', { name: 'X', type: 'uczelnia' }, { origin: 'null' });
  assert.equal(nullOrigin.status, 403);
});

test('walidacja: niepoprawny obiekt wraca z błędami 422', async () => {
  const c = await admin();
  const res = await c.post('/objects', { name: '', type: 'zly-typ' });
  assert.equal(res.status, 422);
  const html = await res.text();
  assert.match(html, /field-error/);
});

test('pełny przepływ audytu: przydział → wypełnienie → złożenie → zatwierdzenie → raport', async () => {
  const coord = await coordinator();
  const adm = await admin();
  const aud = await auditor(1);
  await auditor(2); // drugi audytor (do sprawdzenia izolacji)
  const otherAuditor = await auditor(2);

  // obiekt z koordynatorem
  let res = await adm.post('/objects', { name: 'Uczelnia Testowa', type: 'uczelnia', coordinatorId: userId('u-koord') });
  assert.equal(res.status, 303);
  const objectId = db.prepare(`SELECT id FROM objects WHERE name = 'Uczelnia Testowa'`).get().id;
  res = await adm.post('/objects', { name: 'Wydział Testowy', type: 'wydzial', parentId: objectId });
  assert.equal(res.status, 303);

  // przydział
  const scenarioId = db.prepare(`SELECT id FROM scenarios WHERE areas = 'BOTH' AND usage = 'audit' LIMIT 1`).get().id;
  res = await adm.post('/audits', { objectId, auditorId: userId('u-aud1'), scenarioIds: scenarioId, dueDate: '2026-12-31' });
  assert.equal(res.status, 303);
  const auditId = Number(/\/audits\/(\d+)/.exec(res.headers.get('location'))[1]);
  assert.equal(services.audits.get(auditId).status, 'assigned');

  const items = services.audits.items(auditId);
  assert.ok(items.length >= 20, 'migawka kryteriów obu obszarów');
  assert.ok(items.some((i) => i.area === 'OZN') && items.some((i) => i.area === 'KSZTALCENIE'));

  // izolacja: inny audytor nie widzi audytu, koordynator spoza zakresu też nie
  assert.equal((await otherAuditor.get(`/audits/${auditId}`)).status, 404);
  assert.equal((await aud.get(`/audits/${auditId}`)).status, 200);
  assert.equal((await coord.get(`/audits/${auditId}`)).status, 200);

  // administrator ani koordynator nie wypełniają formularza
  assert.equal((await adm.post(`/audits/${auditId}`, { intent: 'save' })).status, 403);

  // częściowy zapis → „w trakcie”
  const first = items[0];
  res = await aud.post(`/audits/${auditId}`, { intent: 'save', generalNotes: 'Notatka', [`answer_${first.id}`]: '3', [`comment_${first.id}`]: 'Wejście bez schodów' });
  assert.equal(res.status, 303);
  assert.equal(services.audits.get(auditId).status, 'in_progress');
  assert.equal(services.audits.items(auditId)[0].answer, '3');

  // niedozwolona odpowiedź dla typu kryterium
  const ternary = items.find((i) => i.answer_type === 'ternary');
  res = await aud.post(`/audits/${auditId}`, { intent: 'save', [`answer_${ternary.id}`]: '2' });
  assert.equal(res.status, 303);
  assert.notEqual(services.audits.items(auditId).find((i) => i.id === ternary.id).answer, '2');

  // złożenie niekompletnego audytu jest odrzucone
  res = await aud.post(`/audits/${auditId}`, { intent: 'submit' });
  assert.equal(res.status, 422);
  assert.equal(services.audits.get(auditId).status, 'in_progress');

  // pełne wypełnienie (formularz multipart) + załącznik PNG i fałszywy plik
  const form = new FormData();
  form.set('intent', 'submit');
  form.set('generalNotes', 'Gotowe');
  for (const it of items) {
    const answer = it.answer_type === 'scale' ? '3' : 'tak';
    form.set(`answer_${it.id}`, it.id === items[1].id ? 'nd' : answer);
    form.set(`comment_${it.id}`, it.id === items[1].id ? 'Brak wind w budynku' : '');
  }
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  form.append(`files_${first.id}`, new Blob([png], { type: 'image/png' }), 'zdjęcie wejścia.png');
  form.append(`files_${first.id}`, new Blob(['to nie jest obraz'], { type: 'image/png' }), 'falsz.png');
  res = await aud.request('POST', `/audits/${auditId}`, { body: form });
  assert.equal(res.status, 303);
  assert.equal(services.audits.get(auditId).status, 'submitted');

  const files = db.prepare('SELECT * FROM attachments').all();
  assert.equal(files.length, 1, 'fałszywy PNG odrzucony po sprawdzeniu sygnatury');
  assert.equal(files[0].original_name, 'zdjęcie wejścia.png');
  assert.equal(fs.readdirSync(uploadDir).length, 1, 'odrzucony plik usunięty z dysku');
  assert.equal((await aud.get(`/audits/${auditId}/attachments/${files[0].id}`)).status, 200);
  assert.equal((await otherAuditor.get(`/audits/${auditId}/attachments/${files[0].id}`)).status, 404);

  // po złożeniu edycja zablokowana
  assert.equal((await aud.post(`/audits/${auditId}`, { intent: 'save' })).status, 403);
  // audytor nie zatwierdza
  assert.equal((await aud.post(`/audits/${auditId}/approve`, {})).status, 403);

  // zwrot do poprawy wymaga komentarza
  await coord.post(`/audits/${auditId}/return`, { comment: '' });
  assert.equal(services.audits.get(auditId).status, 'submitted');
  await coord.post(`/audits/${auditId}/return`, { comment: 'Uzupełnij zdjęcia' });
  assert.equal(services.audits.get(auditId).status, 'in_progress');
  assert.equal(services.audits.get(auditId).review_comment, 'Uzupełnij zdjęcia');

  // ponowne złożenie i zatwierdzenie
  res = await aud.post(`/audits/${auditId}`, { intent: 'submit' });
  assert.equal(res.status, 303);
  res = await coord.post(`/audits/${auditId}/approve`, { comment: 'OK' });
  assert.equal(res.status, 303);
  const approved = services.audits.get(auditId);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.reviewer_name, 'Karol Koordynator');

  // raport zbiorczy uczelni
  const report = services.reports.forObject(objectId);
  assert.equal(report.audits.length, 1);
  assert.equal(report.summary.score.total.percent, 100);
  assert.equal(report.summary.score.areas.OZN.percent, 100);

  res = await coord.get(`/reports/objects/${objectId}`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /100%/);

  // eksporty
  res = await coord.get(`/reports/objects/${objectId}/report.csv`);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const raw = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8 dla Excela');
  const csv = raw.toString('utf8');
  assert.match(csv, /Uczelnia Testowa/);

  res = await aud.get(`/audits/${auditId}/report.csv`);
  const auditCsv = await res.text();
  assert.match(auditCsv, /Nie dotyczy/);
  assert.match(auditCsv, /zdjęcie wejścia\.png/);

  for (const url of [`/audits/${auditId}/report.pdf`, `/reports/objects/${objectId}/report.pdf`]) {
    res = await (url.startsWith('/audits') ? aud : coord).get(url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type'), /application\/pdf/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(buf.length > 2000);
  }

  // audytor nie widzi raportów zbiorczych
  assert.equal((await aud.get(`/reports/objects/${objectId}`)).status, 403);
});

test('koordynator widzi tylko audyty swojego zakresu', async () => {
  const adm = await admin();
  const other = await new Client().loginAs({ sub: 'u-koord2', name: 'Inny Koordynator', role: 'tk_koordynator' });
  const scope = services.objects.list({ coordinatorId: userId('u-koord2') });
  assert.equal(scope.length, 0);
  const res = await other.get('/audits');
  assert.equal(res.status, 200);
  assert.doesNotMatch(await res.text(), /Uczelnia Testowa/);
  const objectId = db.prepare(`SELECT id FROM objects WHERE name = 'Uczelnia Testowa'`).get().id;
  assert.equal((await other.get(`/reports/objects/${objectId}`)).status, 404);
  void adm;
});

test('obiekt z audytami lub podobiektami nie może zostać usunięty', async () => {
  const adm = await admin();
  const objectId = db.prepare(`SELECT id FROM objects WHERE name = 'Uczelnia Testowa'`).get().id;
  await adm.post(`/objects/${objectId}/delete`, {});
  assert.ok(services.objects.get(objectId));
});

test('obiekt nie może być własnym potomkiem (cykl w hierarchii)', async () => {
  const adm = await admin();
  const parent = db.prepare(`SELECT id FROM objects WHERE name = 'Uczelnia Testowa'`).get().id;
  const child = db.prepare(`SELECT id FROM objects WHERE name = 'Wydział Testowy'`).get().id;
  const res = await adm.post(`/objects/${parent}`, { name: 'Uczelnia Testowa', type: 'uczelnia', parentId: child });
  assert.equal(res.status, 422);
  assert.equal(services.objects.get(parent).parent_id, null);
});

test('edycja kryterium nie zmienia migawki w istniejących audytach', async () => {
  const adm = await admin();
  const c = services.catalog.criteria.list()[0];
  const before = db.prepare('SELECT text FROM audit_items WHERE criterion_id = ? LIMIT 1').get(c.id).text;
  await adm.post(`/criteria/${c.id}`, {
    code: c.code, area: c.area, category: c.category, text: 'Zmieniona treść', weight: '5', answerType: c.answer_type, position: '1', active: 'on',
  });
  assert.equal(services.catalog.criteria.get(c.id).text, 'Zmieniona treść');
  assert.equal(db.prepare('SELECT text FROM audit_items WHERE criterion_id = ? LIMIT 1').get(c.id).text, before);
});

test('ostatni administrator nie może stracić uprawnień', async () => {
  const adm = await admin();
  const id = userId('u-admin');
  await adm.post(`/users/${id}`, { role: 'auditor', active: 'on' });
  assert.equal(services.users.findById(id).role, 'administrator');
});

test('rola z tokenu SZO nadpisuje rolę lokalną, brak roli ją zachowuje', async () => {
  await new Client().loginAs({ sub: 'u-rola', name: 'R', role: 'tk_koordynator' });
  assert.equal(services.users.findById(userId('u-rola')).role, 'coordinator');
  services.users.update(userId('u-rola'), { role: 'auditor', active: true });
  await new Client().loginAs({ sub: 'u-rola', name: 'R' }); // token bez roli
  assert.equal(services.users.findById(userId('u-rola')).role, 'auditor');
  await new Client().loginAs({ sub: 'u-rola', name: 'R', role: 'tk_admin' });
  assert.equal(services.users.findById(userId('u-rola')).role, 'administrator');
});

test('wyłączone konto nie może się zalogować ani używać tokena', async () => {
  await new Client().loginAs({ sub: 'u-off', name: 'Off', role: 'tk_audytor' });
  services.users.update(userId('u-off'), { role: 'auditor', active: false });
  const res = await fetch(`${base}/audits`, { headers: { authorization: `Bearer ${await token({ sub: 'u-off' })}`, accept: 'application/json' } });
  assert.equal(res.status, 401);
});
