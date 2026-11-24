const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignJWT, generateKeyPair, createLocalJWKSet, exportJWK } = require('jose');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');

const ISSUER = 'https://logto.example.pl/oidc';
const APP_ID = 'tkapp123';
const SECRET = 'sekret-aplikacji-logto-123456';
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-logto-'));
const config = loadConfig({
  NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir,
  SESSION_SECRET: 'session-secret-session-secret-session-secret',
  SZO_AUTH_MODE: 'logto', APP_URL: 'https://audytor.example.pl',
  LOGTO_ENDPOINT: 'https://logto.example.pl/', LOGTO_APP_ID: APP_ID, LOGTO_APP_SECRET: SECRET,
  LOGTO_ALLOWED_DOMAINS: 'feer.example.pl', ADMIN_EMAILS: 'szef@inna.pl',
});

let keys;
/** Atrapa Logto: discovery, token (id_token podpisany kluczem testowym) i userinfo. */
const logtoMock = {
  calls: [],
  claims: null,       // claimy do id_token przy następnej wymianie kodu
  userinfo: null,
  tokenStatus: 200,
  nonce: null,
  async fetch(url, init = {}) {
    this.calls.push({ url, init });
    if (url === 'https://logto.example.pl/oidc/.well-known/openid-configuration') {
      return Response.json({
        issuer: ISSUER, authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`,
        userinfo_endpoint: `${ISSUER}/me`, jwks_uri: `${ISSUER}/jwks`,
      });
    }
    if (url === `${ISSUER}/token`) {
      if (this.tokenStatus !== 200) return Response.json({ error: 'invalid_grant' }, { status: this.tokenStatus });
      const idToken = await new SignJWT({ nonce: this.nonce, ...this.claims })
        .setProtectedHeader({ alg: 'ES384', kid: 'k1' }).setIssuer(this.claims.iss || ISSUER).setAudience(this.claims.aud || APP_ID)
        .setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
      return Response.json({ access_token: 'at', id_token: idToken, token_type: 'Bearer' });
    }
    if (url === `${ISSUER}/me`) return Response.json(this.userinfo || {});
    return new Response('nie', { status: 404 });
  },
};

let app; let db; let services; let server; let base;
test.before(async () => {
  keys = await generateKeyPair('ES384');
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'ES384' };
  ({ app, db, services } = createApp(config, { fetchImpl: (u, i) => logtoMock.fetch(u, i), logtoJwks: createLocalJWKSet({ keys: [jwk] }) }));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
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
  async start() {
    const res = await this.get('/auth/logto/start');
    assert.equal(res.status, 303);
    const location = new URL(res.headers.get('location'));
    const params = Object.fromEntries(location.searchParams);
    logtoMock.nonce = params.nonce;
    return { location, params };
  }
  /** Pełne logowanie: start → (Logto) → powrót z kodem. Zwraca odpowiedź z powrotu. */
  async login(claims, userinfo = null) {
    const { params } = await this.start();
    logtoMock.claims = claims; logtoMock.userinfo = userinfo;
    return this.get(`/auth/logto/callback?code=kod_${crypto.randomBytes(8).toString('hex')}&state=${params.state}`);
  }
}
const reset = () => { logtoMock.calls.length = 0; logtoMock.tokenStatus = 200; };

test('start: przekierowanie do Logto z client_id, PKCE S256, state, nonce i adresem powrotu', async () => {
  reset();
  const b = new Browser();
  const { location, params } = await b.start();
  assert.equal(location.origin + location.pathname, `${ISSUER}/auth`);
  assert.equal(params.client_id, APP_ID);
  assert.equal(params.redirect_uri, 'https://audytor.example.pl/auth/logto/callback');
  assert.equal(params.response_type, 'code');
  assert.equal(params.scope, 'openid profile email');
  assert.equal(params.code_challenge_method, 'S256');
  assert.match(params.code_challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(params.state && params.nonce);
  assert.ok(b.jar.has('tk_logto_state'));
});

test('powrót: wymiana kodu (Basic + code_verifier), weryfikacja id_token i sesja; nowe konto z dozwolonej domeny', async () => {
  reset();
  const b = new Browser();
  const res = await b.login({ sub: 'u1', name: 'Anna Nowak', email: 'Anna@Feer.example.pl', email_verified: true });
  assert.equal(res.headers.get('location'), '/');
  assert.ok(b.jar.has('tk_session'));
  assert.equal(b.jar.has('tk_logto_state'), false, 'state jest jednorazowy');

  const exchange = logtoMock.calls.find((c) => c.url === `${ISSUER}/token`);
  assert.equal(exchange.init.headers.Authorization, `Basic ${Buffer.from(`${APP_ID}:${SECRET}`).toString('base64')}`);
  const form = new URLSearchParams(exchange.init.body);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('redirect_uri'), 'https://audytor.example.pl/auth/logto/callback');
  assert.ok(form.get('code_verifier'));

  const user = db.prepare(`SELECT * FROM users WHERE external_id = 'logto:u1'`).get();
  assert.equal(user.name, 'Anna Nowak');
  assert.equal(user.email, 'anna@feer.example.pl');
  assert.equal(user.role, 'auditor');
  assert.equal((await b.get('/audits')).status, 200);
});

test('konto pracownika z SZO (np. zaimportowane) przejmuje logowanie Logto po potwierdzonym e-mailu, także spoza domeny', async () => {
  reset();
  db.prepare(`INSERT INTO users (external_id, name, email, role) VALUES ('szo:77', 'Ewa', 'ewa@partner.pl', 'coordinator')`).run();
  const id = db.prepare(`SELECT id FROM users WHERE external_id = 'szo:77'`).get().id;
  db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, 'auditor'), (?, 'coordinator')`).run(id, id);

  // niepotwierdzony adres nie przejmuje konta i nie zakłada nowego
  let b = new Browser();
  let res = await b.login({ sub: 'u77', name: 'Ewa', email: 'ewa@partner.pl', email_verified: false });
  assert.equal(res.headers.get('location'), '/login?error=denied');
  assert.equal(db.prepare(`SELECT external_id FROM users WHERE id = ?`).get(id).external_id, 'szo:77');

  b = new Browser();
  res = await b.login({ sub: 'u77', name: 'Ewa', email: 'ewa@partner.pl', email_verified: true });
  assert.equal(res.headers.get('location'), '/');
  assert.equal(db.prepare(`SELECT external_id FROM users WHERE id = ?`).get(id).external_id, 'logto:u77');
  assert.equal(services.users.findById(id).role, 'coordinator', 'rola nadana w aplikacji zostaje');
});

test('odrzucenia: obca domena bez konta, zły state, zła audiencja, zły nonce, błąd tokenu, wyłączone konto', async () => {
  reset();
  let b = new Browser();
  let res = await b.login({ sub: 'obcy', name: 'Obcy', email: 'obcy@gmail.com', email_verified: true });
  assert.equal(res.headers.get('location'), '/login?error=denied');
  assert.equal(db.prepare(`SELECT 1 FROM users WHERE external_id = 'logto:obcy'`).get(), undefined);

  b = new Browser();
  await b.start();
  reset();
  res = await b.get('/auth/logto/callback?code=kod_abcdefghij&state=zly');
  assert.equal(res.headers.get('location'), '/login?error=1');
  assert.equal(logtoMock.calls.some((c) => c.url.endsWith('/token')), false, 'bez prawidłowego state nie pytamy Logto');

  b = new Browser();
  res = await b.login({ sub: 'u1', email: 'anna@feer.example.pl', email_verified: true, aud: 'inna-aplikacja' });
  assert.equal(res.headers.get('location'), '/login?error=1');

  b = new Browser();
  const { params } = await b.start();
  logtoMock.nonce = 'podmieniony'; logtoMock.claims = { sub: 'u1', email: 'anna@feer.example.pl', email_verified: true };
  res = await b.get(`/auth/logto/callback?code=kod_abcdefghij&state=${params.state}`);
  assert.equal(res.headers.get('location'), '/login?error=1');

  b = new Browser();
  logtoMock.tokenStatus = 400;
  res = await b.login({ sub: 'u1' });
  assert.equal(res.headers.get('location'), '/login?error=1');
  logtoMock.tokenStatus = 200;

  db.prepare(`UPDATE users SET active = 0 WHERE external_id = 'logto:u1'`).run();
  b = new Browser();
  res = await b.login({ sub: 'u1', email: 'anna@feer.example.pl', email_verified: true });
  assert.equal(res.headers.get('location'), '/login?error=denied');
  assert.equal(b.jar.has('tk_session'), false);
});

test('e-mail z userinfo, gdy brak go w id_token; ADMIN_EMAILS daje administratora także spoza domeny', async () => {
  reset();
  const b = new Browser();
  const res = await b.login({ sub: 'boss' }, { sub: 'boss', name: 'Szef', email: 'Szef@Inna.pl', email_verified: true });
  assert.equal(res.headers.get('location'), '/');
  const user = db.prepare(`SELECT * FROM users WHERE external_id = 'logto:boss'`).get();
  assert.equal(user.email, 'szef@inna.pl');
  assert.equal(user.role, 'administrator');
});

test('strona logowania w trybie logto: przycisk FEER SSO, bez Panelu Współpracownika; SZO wyłączone', async () => {
  const b = new Browser();
  const html = await (await b.get('/login')).text();
  assert.match(html, /href="\/auth\/logto\/start"/);
  assert.match(html, />FEER SSO</);
  assert.doesNotMatch(html, /auth\/szo\/start/);
  assert.equal((await b.get('/auth/szo/start')).headers.get('location'), '/login');
  assert.match(await (await b.get('/login?error=denied')).text(), /FEER SSO nie ma dostępu/);
});

test('konfiguracja trybu logto wymaga adresu, aplikacji, sekretu i APP_URL', () => {
  const env = { NODE_ENV: 'test', SZO_AUTH_MODE: 'logto' };
  assert.throws(() => loadConfig(env), /LOGTO_ENDPOINT, LOGTO_APP_ID i LOGTO_APP_SECRET/);
  assert.throws(() => loadConfig({ ...env, LOGTO_ENDPOINT: 'https://l.pl', LOGTO_APP_ID: 'a', LOGTO_APP_SECRET: 'x'.repeat(20) }), /APP_URL/);
  const cfg = loadConfig({ ...env, LOGTO_ENDPOINT: 'https://l.pl/', LOGTO_APP_ID: 'a', LOGTO_APP_SECRET: 'x'.repeat(20), APP_URL: 'https://a.pl', LOGTO_ALLOWED_DOMAINS: '@Feer.org.pl, x.pl' });
  assert.equal(cfg.logto.endpoint, 'https://l.pl');
  assert.deepEqual(cfg.logto.allowedDomains, ['feer.org.pl', 'x.pl']);
});

test('tylko FEER SSO: bez formularza hasła i rejestracji, trasy kont zewnętrznych nieczynne, sesja konta zewnętrznego nieważna', async () => {
  const b = new Browser();
  const html = await (await b.get('/login')).text();
  assert.doesNotMatch(html, /type="password"/);
  assert.doesNotMatch(html, /\/register/);
  assert.doesNotMatch(html, /kod SMS/i);
  assert.equal(services.externalAuth.enabled, false);
  for (const url of ['/register', '/ext/set-password?token=x']) assert.equal((await b.get(url)).headers.get('location'), '/login', url);
  for (const url of ['/login/external', '/register', '/ext/set-password']) {
    const res = await fetch(base + url, { method: 'POST', body: new URLSearchParams({ email: 'a@b.pl', password: 'x', code: '1234567', token: 'x' }), redirect: 'manual', headers: { origin: base } });
    assert.equal(res.headers.get('location'), '/login', url);
  }

  // istniejące konto zewnętrzne z ważnym ciasteczkiem sesji nie wchodzi do aplikacji
  const info = db.prepare(`INSERT INTO users (external_id, name, email, role, kind) VALUES ('ext:1', 'Zewn', 'z@gmail.com', 'auditor', 'external')`).run();
  db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, 'auditor')`).run(info.lastInsertRowid);
  let cookie = '';
  await services.sessions.issue({ cookie: (name, value) => { cookie = `${name}=${value}`; } }, Number(info.lastInsertRowid), 'auditor');
  const res = await fetch(`${base}/audits`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /^\/login/);

  // kontrola: ten sam sposób wystawienia sesji działa dla pracownika
  const staff = db.prepare(`SELECT id FROM users WHERE external_id = 'logto:boss'`).get().id;
  await services.sessions.issue({ cookie: (name, value) => { cookie = `${name}=${value}`; } }, staff, 'administrator');
  assert.equal((await fetch(`${base}/audits`, { headers: { cookie }, redirect: 'manual' })).status, 200);
});
