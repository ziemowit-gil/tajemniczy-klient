const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-imp-'));
const envBase = {
  NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir, SESSION_SECRET: 'session-secret-session-secret-session-secret',
  SZO_AUTH_MODE: 'szo', SZO_BASE_URL: 'https://szo.example.pl', APP_URL: 'https://audytor.example.pl',
};

/** Atrapa SZO zwracająca listę z api/v1/audytor_users.php. */
const szo = { calls: [], response: null, down: false,
  async fetch(url, init) {
    if (this.down) throw new Error('ECONNREFUSED');
    this.calls.push({ url, auth: init.headers.Authorization });
    return new Response(JSON.stringify(this.response.json), { status: this.response.status });
  } };
const list = (...users) => ({ status: 200, json: { ok: true, count: users.length, users } });
const P = (id, name, email) => ({ id, name, email, active: true });

function boot(env = {}) {
  const config = loadConfig({ ...envBase, ...env });
  const ctx = createApp(config, { fetchImpl: (u, i) => szo.fetch(u, i) });
  return ctx;
}
const withKey = boot({ SZO_API_KEY: 'klucz-importu-1234567890' });
const noKey = boot();

let server; let base;
test.before(async () => { await new Promise((r) => { server = withKey.app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

/** Sesja administratora/audytora bez przechodzenia przez SZO: cookie wystawiamy tym samym serwisem co aplikacja. */
async function session(ctx, identity) {
  const user = ctx.services.users.upsertFromIdentity(identity);
  let cookie = '';
  await ctx.services.sessions.issue({ cookie: (name, value) => { cookie = `${name}=${value}`; } }, user.id);
  return cookie;
}
const call = (cookie, method, url, data) => fetch(base + url, {
  method, headers: { cookie }, body: data ? new URLSearchParams(data) : undefined, redirect: 'manual',
});

test('import: lista z SZO, wybór osób i ról, dane pochodzą z SZO, a nie z formularza', async () => {
  const admin = await session(withKey, { externalId: 'szo:1', name: 'Admin', email: 'admin@example.pl', role: 'administrator' });
  szo.calls.length = 0;
  szo.response = list(P(10, 'Anna Nowak', 'anna@example.pl'), P(11, 'Piotr Kot', 'piotr@example.pl'), P(1, 'Admin', 'admin@example.pl'));

  const res = await call(admin, 'GET', '/users/import');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Anna Nowak/);
  assert.match(html, /anna@example\.pl/);
  assert.match(html, /Już w aplikacji/, 'administrator zalogowany wcześniej jest oznaczony');
  assert.equal(szo.calls[0].url, 'https://szo.example.pl/api/v1/audytor_users.php');
  assert.equal(szo.calls[0].auth, 'Bearer klucz-importu-1234567890');
  assert.match(html, /id="pick-1"[^>]*disabled/);
  assert.doesNotMatch(html, /id="pick-10"[^>]*disabled/);

  // import: Anna jako koordynator, Piotr bez wybranej roli (domyślnie audytor); sfałszowane dane z formularza są ignorowane
  const post = await call(admin, 'POST', '/users/import', [['pick', '10'], ['pick', '11'], ['role_10', 'coordinator'], ['name_10', 'Podszywacz'], ['email_10', 'zly@example.pl']]);
  assert.equal(post.status, 303);
  const rows = Object.fromEntries(withKey.db.prepare(`SELECT external_id, name, email, role FROM users WHERE external_id IN ('szo:10', 'szo:11')`).all().map((r) => [r.external_id, { ...r }]));
  assert.deepEqual(rows['szo:10'], { external_id: 'szo:10', name: 'Anna Nowak', email: 'anna@example.pl', role: 'coordinator' });
  assert.equal(rows['szo:11'].role, 'auditor');

  // ponowny import tej samej osoby niczego nie dubluje ani nie zmienia roli
  await call(admin, 'POST', '/users/import', [['pick', '10'], ['role_10', 'administrator']]);
  assert.equal(withKey.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE external_id = 'szo:10'`).get().n, 1);
  assert.equal(withKey.services.users.list().find((u) => u.external_id === 'szo:10').role, 'coordinator');
});

test('import: id spoza SZO, nieprawidłowa rola, pusty wybór i błąd SZO', async () => {
  const admin = await session(withKey, { externalId: 'szo:1', name: 'Admin', email: 'admin@example.pl', role: 'administrator' });
  szo.response = list(P(20, 'Ewa Test', 'ewa@example.pl'));
  const before = withKey.db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  await call(admin, 'POST', '/users/import', [['pick', '999']]);                         // id, którego SZO nie zwróciło
  assert.equal(withKey.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, before);
  await call(admin, 'POST', '/users/import', []);                                         // brak wyboru
  assert.equal(withKey.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, before);
  await call(admin, 'POST', '/users/import', [['pick', '20'], ['role_20', 'superadmin']]); // rola spoza listy → audytor
  assert.equal(withKey.services.users.list().find((u) => u.external_id === 'szo:20').role, 'auditor');

  // błędy SZO nie wywracają strony
  for (const [response, text] of [
    [{ status: 401, json: {} }, /odrzuciło klucz API/],
    [{ status: 404, json: {} }, /nie ma jeszcze endpointu/],
    [{ status: 500, json: {} }, /zwróciło błąd/],
    [{ status: 200, json: { cokolwiek: true } }, /Niepoprawna odpowiedź/],
  ]) {
    szo.response = response;
    const res = await call(admin, 'GET', '/users/import');
    assert.equal(res.status, 502);
    assert.match(await res.text(), text);
  }
  szo.down = true;
  assert.match(await (await call(admin, 'GET', '/users/import')).text(), /niedostępne/);
  szo.down = false;
});

test('import: odpowiedź SZO jest sanityzowana (duplikaty, brak e-maila, złe id)', async () => {
  const admin = await session(withKey, { externalId: 'szo:1', name: 'Admin', email: 'admin@example.pl', role: 'administrator' });
  szo.response = list(P(30, 'Ok Osoba', 'OK@Example.PL'), P(30, 'Duplikat', 'dup@example.pl'), P(31, 'Bez maila', ''), P('x', 'Złe id', 'z@example.pl'), P(-5, 'Ujemne', 'u@example.pl'));
  const html = await (await call(admin, 'GET', '/users/import')).text();
  assert.match(html, /ok@example\.pl/, 'e-mail znormalizowany do małych liter');
  assert.doesNotMatch(html, /Duplikat|Bez maila|Złe id|Ujemne/);
});

test('import: tylko administrator; bez klucza API strona pokazuje instrukcję konfiguracji', async () => {
  const auditor = await session(withKey, { externalId: 'szo:2', name: 'Audytor', email: 'a@example.pl', role: 'auditor' });
  assert.equal((await call(auditor, 'GET', '/users/import')).status, 403);
  assert.equal((await call(auditor, 'POST', '/users/import', [['pick', '10']])).status, 403);

  // wersja bez SZO_API_KEY (osobna instancja z własną bazą)
  const srv = noKey.app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  try {
    const b = `http://127.0.0.1:${srv.address().port}`;
    const admin = await session(noKey, { externalId: 'szo:1', name: 'Admin', email: 'admin@example.pl', role: 'administrator' });
    const page = await (await fetch(`${b}/users/import`, { headers: { cookie: admin } })).text();
    assert.match(page, /Import z SZO nie jest skonfigurowany/);
    assert.match(page, /audytor:users/);
    const list2 = await (await fetch(`${b}/users`, { headers: { cookie: admin } })).text();
    assert.doesNotMatch(list2, /Importuj z SZO/, 'przycisk ukryty bez klucza');
  } finally { srv.close(); }
});

test('strona użytkowników pokazuje przycisk importu, gdy klucz jest ustawiony', async () => {
  const admin = await session(withKey, { externalId: 'szo:1', name: 'Admin', email: 'admin@example.pl', role: 'administrator' });
  assert.match(await (await call(admin, 'GET', '/users')).text(), /href="\/users\/import"/);
});
