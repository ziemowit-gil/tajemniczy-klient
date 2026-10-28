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
const group = (html, id) => new RegExp(`<section class="menu-group" aria-labelledby="menu-${id}">([\\s\\S]*?)</section>`).exec(html)?.[1] ?? '';
const labels = (html) => [...html.matchAll(/<span>([^<]+)<\/span><\/a><\/li>/g)].map((m) => m[1]);

test('administrator: menu ma grupy Praca, Zarządzanie i Administracja z właściwymi pozycjami', async () => {
  const html = nav(await page('a'));
  assert.match(html, /<summary class="menu-btn">Menu<\/summary>/);
  assert.deepEqual(labels(group(html, 'work')), ['Pulpit', 'Audyty', 'Dostępność kształcenia']);
  assert.deepEqual(labels(group(html, 'manage')), ['Obiekty', 'Raporty', 'Statystyki', 'Archiwum']);
  assert.deepEqual(labels(group(html, 'admin')), ['Kryteria audytu', 'Scenariusze', 'Pytania: kształcenie', 'Użytkownicy', 'Dziennik operacji', 'Integracja z SZO']);
  assert.match(html, /<h2 id="menu-admin">Administracja<\/h2>/);
  assert.match(html, /<button type="submit" class="link-button">Wyloguj się<\/button>/);
  assert.doesNotMatch(html, /<details class="main-menu" open>/, 'domyślnie zwinięte');
});

test('bieżąca sekcja jest oznaczona aria-current na dokładnie jednej pozycji', async () => {
  const html = nav(await page('a', '/scenarios'));
  assert.match(group(html, 'admin'), /<a href="\/scenarios" aria-current="page">/);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);

  // „Pytania: kształcenie” (/office/questions) nie podświetla równocześnie „Dostępności kształcenia”
  const q = nav(await page('a', '/office/questions'));
  assert.match(group(q, 'admin'), /<a href="\/office\/questions" aria-current="page">/);
  assert.equal((q.match(/aria-current="page"/g) || []).length, 1);

  const audits = nav(await page('a', '/audits'));
  assert.match(group(audits, 'work'), /<a href="\/audits" aria-current="page">/);
});

test('koordynator i audytor nie widzą grupy Administracja; audytor nie widzi zarządzania', async () => {
  const k = nav(await page('k'));
  assert.doesNotMatch(k, /Administracja|Kryteria audytu|Użytkownicy/);
  assert.deepEqual(labels(group(k, 'manage')), ['Obiekty', 'Raporty', 'Statystyki', 'Archiwum']);
  const u = nav(await page('u'));
  assert.doesNotMatch(u, /Administracja|Zarządzanie|Obiekty|Raporty|Statystyki/);
  assert.deepEqual(labels(group(u, 'work')), ['Pulpit', 'Moje audyty', 'Dostępność kształcenia']);
});

test('pulpit jest portalem: baner, kafelki „Aplikacje” z ikonami (bez Pulpitu), panel komunikatów i liczniki statusów', async () => {
  const html = await page('a');
  assert.match(html, /<section class="portal-hero"/);
  assert.match(html, /<h2 id="apps-work" class="portal-h">Aplikacje<\/h2>/);
  assert.match(html, /<a class="app-tile" href="\/audits">\s*<svg class="icon"[^>]*aria-hidden="true"/);
  assert.ok(!html.includes('class="app-tile" href="/"'), 'kafelek Pulpitu nie jest potrzebny na pulpicie');
  assert.match(html, /<h2 id="notices-h" class="portal-h">/);
  assert.match(html, /Wszystkie pozycje według statusu/);
  const aud = await page('u');
  assert.ok(!aud.includes('href="/users"'), 'audytor nie ma kafelka administracji');
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
    assert.match(html, /<a class="tile" href="\/auth\/szo\/start"><strong>Panel Współpracownika<\/strong>/);
    assert.match(html, /<h2 id="login-h">Wybierz sposób logowania<\/h2>/);
    assert.doesNotMatch(html, /SZO/, 'na ekranie logowania nie ma nazwy SZO');
    const denied = await (await fetch(`${b}/login?error=denied`)).text();
    assert.match(denied, /administratora Panelu Współpracownika/);
    assert.doesNotMatch(denied, /SZO/);
    assert.doesNotMatch(await (await fetch(`${b}/login?error=1`)).text(), /SZO/);
  } finally { srv.close(); }
});
