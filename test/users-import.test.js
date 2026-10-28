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

const flashOf = (res) => decodeURIComponent((res.headers.getSetCookie().find((c) => c.startsWith('tk_flash=')) || '').split(';')[0].replace(/^tk_flash=/, '').replace(/\+/g, ' '));
const roleOf = (externalId) => withKey.db.prepare('SELECT role FROM users WHERE external_id = ?').get(externalId)?.role;
const importByEmail = (cookie, emails, role) => call(cookie, 'POST', '/users/import/email', { emails, ...(role ? { role } : {}) });

test('import po adresie e-mail: konta z SZO po adresie @feer.org.pl, rola, wiele adresów i dane z SZO', async () => {
  const admin = await session(withKey, { externalId: 'szo:1', name: 'Admin', email: 'admin@example.pl', role: 'administrator' });
  szo.response = list(P(100, 'Jan Kowalski', 'jan.kowalski@feer.org.pl'), P(101, 'Maria Nowak', 'maria.nowak@feer.org.pl'), P(102, 'Ola Test', 'ola.test@feer.org.pl'));

  // formularz jest widoczny, z informacją o dozwolonej domenie
  const page = await (await call(admin, 'GET', '/users/import')).text();
  assert.match(page, /Dodaj osobę po adresie e-mail/);
  assert.match(page, /@feer\.org\.pl/);

  // jeden adres, wielkie litery i spacje; rola domyślna audytor; dane (nazwa) z SZO
  let res = await importByEmail(admin, '  Jan.Kowalski@FEER.org.pl  ');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/users');
  assert.match(flashOf(res), /Zaimportowano \(1\): jan\.kowalski@feer\.org\.pl/);
  const jan = withKey.db.prepare(`SELECT name, email, role FROM users WHERE external_id = 'szo:100'`).get();
  assert.deepEqual({ ...jan }, { name: 'Jan Kowalski', email: 'jan.kowalski@feer.org.pl', role: 'auditor' });

  // kilka adresów (przecinek, średnik, nowa linia) z wybraną rolą
  res = await importByEmail(admin, 'maria.nowak@feer.org.pl,\nola.test@feer.org.pl; maria.nowak@feer.org.pl', 'coordinator');
  assert.match(flashOf(res), /Zaimportowano \(2\)/);
  assert.equal(roleOf('szo:101'), 'coordinator');
  assert.equal(roleOf('szo:102'), 'coordinator');
});

test('import po adresie: nieznany w SZO, już w aplikacji, zła domena i zły format są raportowane osobno', async () => {
  const admin = await session(withKey, { externalId: 'szo:1', name: 'Admin', email: 'admin@example.pl', role: 'administrator' });
  szo.response = list(P(110, 'Ewa Nowa', 'ewa.nowa@feer.org.pl'), P(111, 'Stały Użytkownik', 'staly@feer.org.pl'));
  withKey.services.users.upsertFromIdentity({ externalId: 'szo:111', name: 'Stały Użytkownik', email: 'staly@feer.org.pl', role: 'auditor' });

  const res = await importByEmail(admin, 'ewa.nowa@feer.org.pl brak.takiego@feer.org.pl staly@feer.org.pl obcy@gmail.com niepoprawny feer.org.pl');
  const flash = flashOf(res);
  assert.match(flash, /Zaimportowano \(1\): ewa\.nowa@feer\.org\.pl/);
  assert.match(flash, /Już w aplikacji \(1\): staly@feer\.org\.pl/);
  assert.match(flash, /Nie znaleziono w SZO \(1\): brak\.takiego@feer\.org\.pl\. Sprawdź adres i nadaj/);
  assert.match(flash, /Odrzucono niepoprawne lub spoza dozwolonej domeny \(3\): obcy@gmail\.com, niepoprawny, feer\.org\.pl/);
  assert.ok(flash.length < 1200, 'komunikat mieści się w ciasteczku flash');
  assert.equal(roleOf('szo:110'), 'auditor');
  assert.equal(withKey.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE email = 'obcy@gmail.com'`).get().n, 0);
});

test('import po adresie: tylko obcy lub niepoprawny adres nie pyta SZO i wraca na formularz; puste i zbyt wiele', async () => {
  const admin = await session(withKey, { externalId: 'szo:1', name: 'Admin', email: 'admin@example.pl', role: 'administrator' });
  szo.calls.length = 0;
  let res = await importByEmail(admin, 'ktos@example.pl');
  assert.equal(res.headers.get('location'), '/users/import');
  assert.match(flashOf(res), /domena spoza dozwolonych \(@feer\.org\.pl\): ktos@example\.pl/);
  assert.equal(szo.calls.length, 0, 'odrzucone adresy nie powodują zapytania do SZO');

  res = await importByEmail(admin, '   ');
  assert.match(flashOf(res), /Podaj adres e-mail/);
  const many = Array.from({ length: 51 }, (_, i) => `os${i}@feer.org.pl`).join(',');
  res = await importByEmail(admin, many);
  assert.match(flashOf(res), /Za dużo adresów naraz \(maksymalnie 50\)/);
});

test('import po adresie: błąd SZO, uprawnienia i konfiguracja domen', async () => {
  const admin = await session(withKey, { externalId: 'szo:1', name: 'Admin', email: 'admin@example.pl', role: 'administrator' });
  const auditor = await session(withKey, { externalId: 'szo:2', name: 'Audytor', email: 'a@example.pl', role: 'auditor' });
  assert.equal((await importByEmail(auditor, 'x@feer.org.pl')).status, 403);

  szo.response = { status: 401, json: {} };
  const res = await importByEmail(admin, 'ktos@feer.org.pl');
  assert.equal(res.headers.get('location'), '/users/import');
  assert.match(flashOf(res), /odrzuciło klucz API/);

  // domyślnie feer.org.pl, pusta wartość = dowolna domena, można podać kilka
  assert.deepEqual(loadConfig(envBase).szo.importDomains, ['feer.org.pl']);
  assert.deepEqual(loadConfig({ ...envBase, IMPORT_EMAIL_DOMAINS: '' }).szo.importDomains, []);
  assert.deepEqual(loadConfig({ ...envBase, IMPORT_EMAIL_DOMAINS: ' @feer.org.pl, Example.PL ' }).szo.importDomains, ['feer.org.pl', 'example.pl']);
  const open = boot({ SZO_API_KEY: 'klucz-importu-1234567890', IMPORT_EMAIL_DOMAINS: '' });
  const srv = open.app.listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r));
  try {
    szo.response = list(P(120, 'Obca Domena', 'ktos@example.pl'));
    const cookie = await session(open, { externalId: 'szo:1', name: 'Admin', email: 'admin@example.pl', role: 'administrator' });
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/users/import/email`, { method: 'POST', headers: { cookie }, body: new URLSearchParams({ emails: 'ktos@example.pl' }), redirect: 'manual' });
    assert.match(flashOf(r), /Zaimportowano \(1\)/);
  } finally { srv.close(); }
});
