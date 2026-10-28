const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignJWT } = require('jose');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');

const SECRET = 'szo-test-secret-szo-test-secret-1234';
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-nav-'));
const config = loadConfig({
  NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir, SESSION_SECRET: 'session-secret-session-secret-session-secret',
  SZO_AUTH_MODE: 'jwt', SZO_JWT_SECRET: SECRET, SZO_ROLE_MAP: JSON.stringify({ a: 'administrator', u: 'auditor', k: 'coordinator' }),
});
const { app } = createApp(config);
let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

const key = new TextEncoder().encode(SECRET);
async function page(role, url = '/') {
  const token = await new SignJWT({ name: role, role }).setProtectedHeader({ alg: 'HS256' }).setSubject(`u-${role}`).setExpirationTime('5m').sign(key);
  const login = await fetch(`${base}/auth/callback?token=${token}`, { redirect: 'manual' });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return (await fetch(base + url, { headers: { cookie } })).text();
}
const nav = (html) => /<nav aria-label="Główna">([\s\S]*?)<\/nav>/.exec(html)[1];
const group = (html) => /<details class="nav-group[^"]*">([\s\S]*?)<\/details>/.exec(html)?.[1] ?? '';

test('administrator: pozycje zarządzania są w grupie „Administracja”, codzienna praca w głównym menu', async () => {
  const html = nav(await page('a'));
  const inGroup = group(html);
  for (const label of ['Kryteria audytu', 'Scenariusze', 'Pytania: kształcenie', 'Użytkownicy']) {
    assert.ok(inGroup.includes(`>${label}</a>`), `${label} w grupie`);
  }
  const outside = html.replace(/<details[\s\S]*?<\/details>/, '');
  for (const label of ['Pulpit', 'Audyty', 'Dostępność kształcenia', 'Obiekty', 'Raporty', 'Statystyki']) {
    assert.ok(outside.includes(`>${label}</a>`), `${label} w głównym menu`);
  }
  for (const label of ['Kryteria audytu', 'Scenariusze', 'Użytkownicy']) assert.ok(!outside.includes(`>${label}</a>`), `${label} nie jest w głównym menu`);
  assert.match(html, /<summary>Administracja<\/summary>/);
  assert.match(html, /<details class="nav-group">/, 'domyślnie zwinięta');
});

test('grupa wskazuje bieżącą sekcję tekstowo i atrybutem aria-current na właściwej pozycji', async () => {
  const html = nav(await page('a', '/scenarios'));
  assert.match(html, /<details class="nav-group is-current">/);
  assert.match(html, /<summary>Administracja<span class="sr-only"> \(bieżąca sekcja\)<\/span><\/summary>/);
  assert.match(group(html), /<a href="\/scenarios" aria-current="page">Scenariusze<\/a>/);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1, 'dokładnie jedna bieżąca pozycja');

  // „Pytania: kształcenie” (/office/questions) nie podświetla równocześnie „Dostępności kształcenia”
  const q = nav(await page('a', '/office/questions'));
  assert.match(group(q), /<a href="\/office\/questions" aria-current="page">/);
  assert.equal((q.match(/aria-current="page"/g) || []).length, 1);

  // strona spoza grupy: grupa nie jest oznaczona jako bieżąca
  assert.doesNotMatch(nav(await page('a', '/audits')), /is-current/);
});

test('koordynator i audytor nie widzą grupy Administracja', async () => {
  const k = nav(await page('k'));
  assert.doesNotMatch(k, /nav-group|Administracja|Kryteria audytu|Użytkownicy/);
  assert.match(k, />Obiekty<\/a>/);
  assert.match(k, />Statystyki<\/a>/);
  const u = nav(await page('u'));
  assert.doesNotMatch(u, /nav-group|Administracja|Obiekty|Raporty|Statystyki/);
  assert.match(u, />Moje audyty<\/a>/);
});

test('strona logowania: dekoracyjne tło i ikona jako zasoby statyczne, formularz na białej karcie', async () => {
  const html = await (await fetch(`${base}/login`)).text();
  assert.match(html, /<div class="login-hero">\s*<div class="login-box login-card">/);
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/img\/icon\.svg\?v=[0-9a-f]{10}">/);
  assert.doesNotMatch(html, /login-bg/, 'tło jest w CSS, nie w treści strony (dekoracja)');

  const css = await (await fetch(`${base}/css/app.css`)).text();
  assert.match(css, /\.login-hero\s*\{[^}]*url\("\/img\/login-bg\.svg"\)/);
  assert.match(css, /\.login-card\s*\{[^}]*background:\s*#fff/, 'tekst leży na białej karcie');

  for (const file of ['login-bg.svg', 'icon.svg']) {
    const res = await fetch(`${base}/img/${file}`);
    assert.equal(res.status, 200, file);
    assert.match(res.headers.get('content-type'), /image\/svg\+xml/);
    const svg = await res.text();
    assert.doesNotMatch(svg, /<script|onload=|onclick=|href="http|xlink:href|<foreignObject/i, 'SVG bez skryptów i zasobów zewnętrznych');
    assert.ok(svg.length < 6000, 'lekki plik');
  }
  // CSP dopuszcza obrazy z własnej domeny
  const csp = (await fetch(`${base}/login`)).headers.get('content-security-policy');
  assert.match(csp, /img-src 'self'/);
});

test('adresy plików statycznych mają odcisk treści (omijają stare kopie w Cloudflare i przeglądarce)', async () => {
  const html = await (await fetch(`${base}/login`)).text();
  const css = /href="(\/css\/app\.css\?v=([0-9a-f]{10}))"/.exec(html);
  const js = /src="(\/js\/app\.js\?v=([0-9a-f]{10}))"/.exec(html);
  assert.ok(css && js, 'CSS i JS z parametrem wersji');
  assert.notEqual(css[2], js[2], 'różne pliki mają różne odciski');
  assert.equal((await fetch(base + css[1])).status, 200);
  assert.equal((await fetch(base + js[1])).status, 200);
  // ten sam plik zawsze daje ten sam odcisk
  assert.equal(/css\/app\.css\?v=([0-9a-f]{10})/.exec(await (await fetch(`${base}/login`)).text())[1], css[2]);
});

test('stopka: autorzy i wersja aplikacji na każdej stronie, także na logowaniu', async () => {
  const pkg = require('../package.json');
  const major = pkg.version.split('.').slice(0, 2).join('.');
  assert.equal(major, '1.3');
  for (const html of [await (await fetch(`${base}/login`)).text(), await page('a'), await page('u', '/audits')]) {
    assert.match(html, /<footer class="site-footer">\s*<p>Autor: Ziemowit Gil \| Jarosław P\. <span class="version">v\. 1\.3<\/span><\/p>\s*<\/footer>/);
  }
});

test('strona logowania w trybie szo nazywa SZO „Panelem Współpracownika”', async () => {
  const cfg = loadConfig({
    NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir, SESSION_SECRET: 'session-secret-session-secret-session-secret',
    SZO_AUTH_MODE: 'szo', SZO_BASE_URL: 'https://szo.example.pl', APP_URL: 'https://audytor.example.pl',
  });
  const other = createApp(cfg);
  const srv = other.app.listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r));
  try {
    const b = `http://127.0.0.1:${srv.address().port}`;
    const html = await (await fetch(`${b}/login`)).text();
    assert.match(html, />Zaloguj przez Panel Współpracownika</);
    assert.match(html, /w Panelu Współpracownika/);
    assert.doesNotMatch(html, /SZO/, 'na ekranie logowania nie ma nazwy SZO');
    const denied = await (await fetch(`${b}/login?error=denied`)).text();
    assert.match(denied, /administratora Panelu Współpracownika/);
    assert.doesNotMatch(denied, /SZO/);
    assert.doesNotMatch(await (await fetch(`${b}/login?error=1`)).text(), /SZO/);
  } finally { srv.close(); }
});
