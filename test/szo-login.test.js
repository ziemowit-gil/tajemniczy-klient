const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-szo-'));
const config = loadConfig({
  NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir,
  SESSION_SECRET: 'session-secret-session-secret-session-secret',
  SZO_AUTH_MODE: 'szo', SZO_BASE_URL: 'https://szo.example.pl', APP_URL: 'https://audytor.example.pl',
  ADMIN_EMAILS: 'Szef@Example.pl, inny@example.pl',
});

/** Atrapa SZO: zapamiętuje żądania i zwraca zaprogramowaną odpowiedź. */
const szoMock = {
  calls: [],
  tokenResponse: null,
  down: false,
  async fetch(url, init) {
    if (this.down) throw new Error('ECONNREFUSED');
    const body = init.body ? JSON.parse(init.body) : null;
    this.calls.push({ url, body, auth: init.headers.Authorization });
    if (url.includes('action=logout')) return new Response('{"ok":true}', { status: 200 });
    return new Response(JSON.stringify(this.tokenResponse.json), { status: this.tokenResponse.status });
  },
};
const ok = (user, scopes = ['audytor:access']) => ({ status: 200, json: { access_token: 'ezdc_secret', token_type: 'Bearer', scopes, user } });

const { app, db, services } = createApp(config, { fetchImpl: (u, i) => szoMock.fetch(u, i) });
let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

class Browser {
  constructor() { this.jar = new Map(); }
  async get(url) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';'); const i = pair.indexOf('=');
      if (/Expires=Thu, 01 Jan 1970/i.test(line)) this.jar.delete(pair.slice(0, i)); else this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  }
  /** Rozpoczyna logowanie i zwraca parametry wysłane do SZO. */
  async start() {
    const res = await this.get('/auth/szo/start');
    assert.equal(res.status, 303);
    const location = new URL(res.headers.get('location'));
    return { location, params: Object.fromEntries(location.searchParams) };
  }
}
const reset = () => { szoMock.calls.length = 0; szoMock.down = false; };
const code = () => crypto.randomBytes(32).toString('hex');

test('start: przekierowanie do SZO z state, code_challenge (S256), scope i adresem powrotu', async () => {
  reset();
  const b = new Browser();
  const { location, params } = await b.start();
  assert.equal(location.origin + location.pathname, 'https://szo.example.pl/auth/desktop_login.php');
  assert.equal(params.redirect_uri, 'https://audytor.example.pl/auth/szo/callback');
  assert.equal(params.scope, 'audytor:access');
  assert.match(params.state, /^[A-Za-z0-9_-]{32}$/);
  assert.match(params.code_challenge, /^[A-Za-z0-9_-]{43}$/, 'SZO wymaga challenge o długości 43');
  assert.ok(b.jar.has('tk_szo_state'));
  assert.match(decodeURIComponent(params.device), /Tajemniczy Klient/);
});

test('powrót z SZO: wymiana kodu z poprawnym code_verifier, unieważnienie tokenu SZO i sesja', async () => {
  reset();
  const b = new Browser();
  const { params } = await b.start();
  szoMock.tokenResponse = ok({ id: 42, name: 'Jan Kowalski', email: 'Jan@Example.pl' });
  const c = code();

  const res = await b.get(`/auth/szo/callback?code=${c}&state=${params.state}`);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/');
  assert.ok(b.jar.has('tk_session'));
  assert.equal(b.jar.has('tk_szo_state'), false, 'state jest jednorazowy');

  const exchange = szoMock.calls[0];
  assert.equal(exchange.url, 'https://szo.example.pl/api/v1/desktop_token.php');
  assert.equal(exchange.body.grant_type, 'authorization_code');
  assert.equal(exchange.body.code, c);
  const challenge = crypto.createHash('sha256').update(exchange.body.code_verifier).digest('base64url');
  assert.equal(challenge, params.code_challenge, 'verifier pasuje do challenge');

  const revoke = szoMock.calls[1];
  assert.equal(revoke.url, 'https://szo.example.pl/api/v1/desktop_token.php?action=logout');
  assert.equal(revoke.auth, 'Bearer ezdc_secret', 'token SZO unieważniony po odczycie tożsamości');

  const user = db.prepare(`SELECT * FROM users WHERE external_id = 'szo:42'`).get();
  assert.equal(user.name, 'Jan Kowalski');
  assert.equal(user.email, 'jan@example.pl', 'adres znormalizowany do małych liter');
  assert.equal(user.role, 'auditor', 'nowe konto dostaje rolę domyślną');
  assert.equal((await b.get('/audits')).status, 200);
});

test('ADMIN_EMAILS: wskazane adresy zawsze są administratorami; reszta zachowuje rolę nadaną w aplikacji', async () => {
  reset();
  const b = new Browser();
  let { params } = await b.start();
  szoMock.tokenResponse = ok({ id: 7, name: 'Szef', email: 'szef@example.pl' });
  await b.get(`/auth/szo/callback?code=${code()}&state=${params.state}`);
  assert.equal(services.users.findById(db.prepare(`SELECT id FROM users WHERE external_id = 'szo:7'`).get().id).role, 'administrator');
  assert.equal((await b.get('/users')).status, 200);

  // zwykły użytkownik: administrator zmienia rolę, ponowne logowanie jej nie nadpisuje
  const b2 = new Browser();
  ({ params } = await b2.start());
  szoMock.tokenResponse = ok({ id: 8, name: 'Koordynator', email: 'k@example.pl' });
  await b2.get(`/auth/szo/callback?code=${code()}&state=${params.state}`);
  const id = db.prepare(`SELECT id FROM users WHERE external_id = 'szo:8'`).get().id;
  services.users.update(id, { role: 'coordinator', active: true });
  const b3 = new Browser();
  ({ params } = await b3.start());
  await b3.get(`/auth/szo/callback?code=${code()}&state=${params.state}`);
  assert.equal(services.users.findById(id).role, 'coordinator');
});

test('odrzucenia: zły state, brak cookie, powtórzenie, błąd SZO, brak uprawnienia, wyłączone konto', async () => {
  reset();
  szoMock.tokenResponse = ok({ id: 50, name: 'X', email: 'x@example.pl' });

  // zły state
  let b = new Browser();
  await b.start();
  let res = await b.get(`/auth/szo/callback?code=${code()}&state=ZLYSTATEZLYSTATEZLYSTATEZLYSTATE12`);
  assert.equal(res.headers.get('location'), '/login?error=1');
  assert.equal(b.jar.has('tk_session'), false);
  assert.equal(szoMock.calls.length, 0, 'bez prawidłowego state nie pytamy SZO');

  // brak cookie (np. inna przeglądarka)
  b = new Browser();
  res = await b.get(`/auth/szo/callback?code=${code()}&state=abc`);
  assert.equal(res.headers.get('location'), '/login?error=1');

  // powtórzenie tego samego powrotu
  b = new Browser();
  const { params } = await b.start();
  const url = `/auth/szo/callback?code=${code()}&state=${params.state}`;
  assert.equal((await b.get(url)).headers.get('location'), '/');
  const again = new Browser();
  again.jar.set('tk_szo_state', 'skradzione');
  assert.equal((await again.get(url)).headers.get('location'), '/login?error=1');
  assert.equal((await b.get(url)).headers.get('location'), '/login?error=1', 'state zużyty');

  // niepoprawny kod
  b = new Browser();
  let p = (await b.start()).params;
  res = await b.get(`/auth/szo/callback?code=nieheks&state=${p.state}`);
  assert.equal(res.headers.get('location'), '/login?error=1');

  // użytkownik odmówił zgody w SZO
  b = new Browser();
  p = (await b.start()).params;
  res = await b.get(`/auth/szo/callback?error=access_denied&state=${p.state}`);
  assert.equal(res.headers.get('location'), '/login?error=denied');

  // SZO: konto bez uprawnienia do aplikacji (403) i zwrócone scope'y bez audytor:access
  b = new Browser();
  p = (await b.start()).params;
  szoMock.tokenResponse = { status: 403, json: { error: 'Konto nie ma uprawnień' } };
  res = await b.get(`/auth/szo/callback?code=${code()}&state=${p.state}`);
  assert.equal(res.headers.get('location'), '/login?error=denied');

  reset();
  b = new Browser();
  p = (await b.start()).params;
  szoMock.tokenResponse = ok({ id: 51, name: 'Y', email: 'y@example.pl' }, ['ezd:read', 'crm:read']);
  res = await b.get(`/auth/szo/callback?code=${code()}&state=${p.state}`);
  assert.equal(res.headers.get('location'), '/login?error=denied');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM users WHERE external_id = 'szo:51'`).get().n, 0, 'konto bez scope nie powstaje');
  assert.ok(szoMock.calls.some((c) => c.url.includes('action=logout')), 'token SZO unieważniony także przy odmowie');

  // SZO niedostępne
  b = new Browser();
  p = (await b.start()).params;
  szoMock.down = true;
  res = await b.get(`/auth/szo/callback?code=${code()}&state=${p.state}`);
  assert.equal(res.headers.get('location'), '/login?error=1');
  szoMock.down = false;

  // wyłączone konto w aplikacji
  b = new Browser();
  p = (await b.start()).params;
  szoMock.tokenResponse = ok({ id: 60, name: 'Z', email: 'z@example.pl' });
  await b.get(`/auth/szo/callback?code=${code()}&state=${p.state}`);
  const id = db.prepare(`SELECT id FROM users WHERE external_id = 'szo:60'`).get().id;
  services.users.update(id, { role: 'auditor', active: false });
  const off = new Browser();
  p = (await off.start()).params;
  res = await off.get(`/auth/szo/callback?code=${code()}&state=${p.state}`);
  assert.equal(res.headers.get('location'), '/login?error=denied');
  assert.equal(off.jar.has('tk_session'), false);
});

test('strona logowania w trybie szo: przycisk do /auth/szo/start; endpointy dev i JWT wyłączone', async () => {
  const b = new Browser();
  const html = await (await b.get('/login')).text();
  assert.match(html, /href="\/auth\/szo\/start"/);
  assert.doesNotMatch(html, /Zaloguj \(test\)/);
  const res = await fetch(`${base}/auth/dev`, { method: 'POST', body: new URLSearchParams({ name: 'X', role: 'administrator' }), redirect: 'manual' });
  assert.equal(res.status, 303, 'trasa /auth/dev nie istnieje w tym trybie: żądanie trafia na logowanie');
  assert.equal(res.headers.get('location'), '/login');
  assert.equal(res.headers.getSetCookie().some((c) => c.startsWith('tk_session=')), false, 'bez sesji');
  const denied = await b.get('/login?error=denied');
  assert.match(await denied.text(), /nie ma dostępu do aplikacji/);
  assert.equal((await b.get('/auth/callback?token=cokolwiek')).headers.get('location'), '/login', 'callback JWT nieaktywny w trybie szo');
});

test('konfiguracja trybu szo wymaga SZO_BASE_URL i APP_URL', () => {
  const env = { NODE_ENV: 'test', SZO_AUTH_MODE: 'szo' };
  assert.throws(() => loadConfig(env), /SZO_BASE_URL/);
  assert.throws(() => loadConfig({ ...env, SZO_BASE_URL: 'https://szo.example.pl' }), /APP_URL/);
  const cfg = loadConfig({ ...env, SZO_BASE_URL: 'https://szo.example.pl', APP_URL: 'https://a.example.pl', ADMIN_EMAILS: ' A@x.pl,b@x.pl ,, ' });
  assert.deepEqual(cfg.szo.adminEmails, ['a@x.pl', 'b@x.pl']);
});
