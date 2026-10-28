const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignJWT } = require('jose');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { DECLARATION_PARAGRAPHS, DECLARATION_TEXT, DECLARATION_HASH } = require('../src/domain/declaration');

const SECRET = 'szo-test-secret-szo-test-secret-1234';
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-decl-'));
const env = (extra = {}) => ({
  NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir, SESSION_SECRET: 'session-secret-session-secret-session-secret',
  SZO_AUTH_MODE: 'jwt', SZO_JWT_SECRET: SECRET, SZO_ROLE_MAP: JSON.stringify({ a: 'administrator', u: 'auditor' }), DECLARATION_REQUIRED: 'true', ...extra,
});
const { app, db, services } = createApp(loadConfig(env()));
let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

const key = new TextEncoder().encode(SECRET);
const bearer = (sub, role) => new SignJWT({ name: sub, email: `${sub}@feer.org.pl`, role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('5m').sign(key);
async function login(sub, role) {
  const res = await fetch(`${base}/auth/callback?token=${await bearer(sub, role)}`, { redirect: 'manual' });
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const call = (cookie, method, url, data, headers = {}) => fetch(base + url, { method, headers: { cookie, ...headers }, body: data ? new URLSearchParams(data) : undefined, redirect: 'manual' });

test('treść oświadczenia: dokładnie zatwierdzony tekst, z poprawną nazwą aplikacji', () => {
  assert.equal(DECLARATION_PARAGRAPHS.length, 3);
  assert.match(DECLARATION_PARAGRAPHS[0], /^Ja, niżej podpisany\/a, jako osoba logująca się do aplikacji „Tajemniczy Klient”, oświadczam, że aplikacja jest aplikacją wewnętrzną Fundacji Edukacji Empatii Rozwoju „FEER” i służy do przeprowadzania audytów dostępnościowych uczelni w ramach działalności statutowej Fundacji\.$/);
  assert.match(DECLARATION_PARAGRAPHS[1], /^Zobowiązuję się zachować w tajemnicy dane i informacje niepubliczne, w tym dane osobowe, do których uzyskam dostęp za pośrednictwem aplikacji lub w związku z przeprowadzaniem audytów dostępnościowych, oraz nie udostępniać ich osobom nieupoważnionym\. Zobowiązuję się wykorzystywać je wyłącznie w zakresie niezbędnym do realizacji wskazanych celów, z uwzględnieniem obowiązujących przepisów prawa\.$/);
  assert.equal(DECLARATION_PARAGRAPHS[2], 'Oświadczenie składam elektronicznie za pośrednictwem aplikacji.');
  assert.match(DECLARATION_HASH, /^[0-9a-f]{64}$/);
});

test('konfiguracja: wymóg oświadczenia domyślnie włączony poza testami, można go wyłączyć', () => {
  const base2 = { SESSION_SECRET: 'session-secret-session-secret-session-secret', SZO_AUTH_MODE: 'jwt', SZO_JWT_SECRET: SECRET };
  assert.equal(loadConfig({ ...base2, NODE_ENV: 'production', APP_URL: 'https://a.example.pl' }).declarationRequired, true);
  assert.equal(loadConfig({ ...base2, NODE_ENV: 'development' }).declarationRequired, true);
  assert.equal(loadConfig({ ...base2, NODE_ENV: 'production', DECLARATION_REQUIRED: 'false' }).declarationRequired, false);
  assert.equal(loadConfig({ ...base2, NODE_ENV: 'test' }).declarationRequired, false, 'testy automatyczne bez bramki, o ile jej jawnie nie włączono');
});

test('bramka: bez oświadczenia każda strona przekierowuje na /declaration (wylogowanie i API z tokenem są wyjątkami)', async () => {
  const cookie = await login('nowy', 'u');
  for (const url of ['/', '/audits', '/office', '/account', '/scenarios', '/users']) {
    const res = await call(cookie, 'GET', url);
    assert.equal(res.status, 303, url);
    assert.equal(res.headers.get('location'), '/declaration', url);
  }
  assert.equal((await call(cookie, 'POST', '/audits', {})).headers.get('location'), '/declaration', 'także zapisy');
  const json = await call(cookie, 'GET', '/audits', null, { accept: 'application/json' });
  assert.equal(json.status, 403);
  assert.match((await json.json()).error, /oświadczenia/);

  // wyjątki: wylogowanie, healthz, zasoby statyczne, żądania API z tokenem Bearer
  assert.equal((await call(cookie, 'POST', '/logout')).headers.get('location'), '/login');
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/css/app.css`)).status, 200);
  const api = await fetch(`${base}/audits`, { headers: { authorization: `Bearer ${await bearer('apiuser', 'u')}`, accept: 'application/json' } });
  assert.equal(api.status, 200, 'token Bearer nie wymaga oświadczenia');
});

test('strona oświadczenia: treść, dane osoby, brak nawigacji, możliwość wylogowania', async () => {
  const cookie = await login('Anna', 'u');
  const html = await (await call(cookie, 'GET', '/declaration')).text();
  assert.match(html, /<h1>Oświadczenie składane elektronicznie<\/h1>/);
  assert.match(html, /Osoba składająca oświadczenie:<\/strong> Anna \(Anna@feer\.org\.pl\)/i);
  for (const paragraph of DECLARATION_PARAGRAPHS) assert.ok(html.includes(paragraph.replace(/”/g, '”')), paragraph.slice(0, 40));
  assert.match(html, /<input type="checkbox" id="accept" name="accept" required>/);
  assert.match(html, /<label for="accept">Składam powyższe oświadczenie<\/label>/);
  assert.doesNotMatch(html, /<nav aria-label="Główna">/, 'bez menu do czasu złożenia oświadczenia');
  assert.match(html, /action="\/logout"/);
});

test('złożenie oświadczenia: wymaga zaznaczenia, zapisuje dokładny tekst i dane, odblokowuje aplikację', async () => {
  const cookie = await login('Basia', 'u');
  const none = await call(cookie, 'POST', '/declaration', {});
  assert.equal(none.status, 422);
  assert.match(await none.text(), /Zaznacz pole, aby złożyć oświadczenie/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM declarations').get().n, 0);
  assert.equal((await call(cookie, 'GET', '/audits')).status, 303, 'nadal zablokowana');

  const ok = await call(cookie, 'POST', '/declaration', { accept: 'on' });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/');
  const row = db.prepare(`SELECT d.*, u.external_id FROM declarations d JOIN users u ON u.id = d.user_id WHERE u.external_id = 'Basia'`).get();
  assert.equal(row.text_hash, DECLARATION_HASH);
  assert.equal(row.text, DECLARATION_TEXT, 'zapisana pełna treść oświadczenia');
  assert.equal(row.user_name, 'Basia');
  assert.equal(row.user_email, 'Basia@feer.org.pl');
  assert.match(row.accepted_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  assert.equal((await call(cookie, 'GET', '/audits')).status, 200, 'dostęp po złożeniu');
  assert.equal((await call(cookie, 'GET', '/declaration')).headers.get('location'), '/', 'status zapamiętany: kolejne wejścia bez pytania');
  await call(cookie, 'POST', '/declaration', { accept: 'on' });   // powtórne złożenie nic nie dubluje
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM declarations d JOIN users u ON u.id = d.user_id WHERE u.external_id = ?').get('Basia').n, 1);
});

test('status jest zapamiętany między sesjami, a zmiana treści wymusza ponowne złożenie', async () => {
  const first = await login('Czesia', 'u');
  await call(first, 'POST', '/declaration', { accept: 'on' });
  const second = await login('Czesia', 'u');                     // nowe logowanie = nowa sesja
  assert.equal((await call(second, 'GET', '/audits')).status, 200, 'bez ponownego pytania');

  // symulacja nowej wersji treści: zapisany skrót nie pasuje do aktualnego
  db.prepare(`UPDATE declarations SET text_hash = 'stara-wersja' WHERE user_id = (SELECT id FROM users WHERE external_id = 'Czesia')`).run();
  assert.equal((await call(second, 'GET', '/audits')).headers.get('location'), '/declaration', 'nowa wersja wymaga ponownego złożenia');
  await call(second, 'POST', '/declaration', { accept: 'on' });
  assert.equal((await call(second, 'GET', '/audits')).status, 200);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM declarations WHERE user_id = (SELECT id FROM users WHERE external_id = 'Czesia')`).get().n, 2, 'obie wersje zachowane jako dowód');
});

test('status widoczny dla administratora i dla samej osoby', async () => {
  const admin = await login('Szef', 'a');
  await call(admin, 'POST', '/declaration', { accept: 'on' });
  const someone = await login('Bez', 'u');                         // nie złożył
  const users = await (await call(admin, 'GET', '/users')).text();
  assert.match(users, /<th scope="col">Oświadczenie<\/th>/);
  assert.match(users, /Złożone \d{1,2} \p{L}+\.? \d{4}/u);
  assert.match(users, /<td>Brak<\/td>/);
  assert.match(await (await call(admin, 'GET', '/account')).text(), /Oświadczenie o poufności<\/dt>\s*<dd>złożone/);
  assert.equal((await call(someone, 'GET', '/account')).status, 303);
  assert.equal(services.declarations.isAccepted(db.prepare(`SELECT id FROM users WHERE external_id = 'Bez'`).get().id), false);
});
