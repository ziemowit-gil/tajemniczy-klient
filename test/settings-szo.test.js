const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { createSettingsService, SZO_API_KEY } = require('../src/services/settings');
const { openDatabase } = require('../src/db');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-set-'));
const env = (extra = {}) => ({
  NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir, SESSION_SECRET: 'session-secret-session-secret-session-secret',
  SZO_AUTH_MODE: 'szo', SZO_BASE_URL: 'https://szo.example.pl', APP_URL: 'https://audytor.example.pl', ...extra,
});
const KEY = 'ezdk_TAJNY-KLUCZ-0123456789abcdef';

/** Atrapa SZO: zapisuje użyty klucz i zwraca zaprogramowane odpowiedzi dla listy użytkowników i poczty. */
const szo = { calls: [], users: { status: 200, json: { ok: true, users: [{ id: 5, name: 'Anna', email: 'anna@example.pl' }] } }, mail: { status: 422, json: { error: 'Temat jest wymagany' } }, down: false,
  async fetch(url, init) {
    if (this.down) throw new Error('ECONNREFUSED');
    this.calls.push({ url, auth: init.headers.Authorization });
    const r = url.includes('audytor_mail') ? this.mail : this.users;
    return new Response(JSON.stringify(r.json), { status: r.status });
  } };
const reset = () => { szo.calls.length = 0; szo.down = false; szo.users = { status: 200, json: { ok: true, users: [{ id: 5, name: 'Anna', email: 'anna@example.pl' }] } }; szo.mail = { status: 422, json: { error: 'Temat jest wymagany' } }; };

const ctx = createApp(loadConfig(env()), { fetchImpl: (u, i) => szo.fetch(u, i) });
const envKeyCtx = createApp(loadConfig(env({ SZO_API_KEY: 'klucz-z-pliku-env-1234567890' })), { fetchImpl: (u, i) => szo.fetch(u, i) });

let server; let base;
test.before(async () => { await new Promise((r) => { server = ctx.app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

async function session(c, identity) {
  const user = c.services.users.upsertFromIdentity(identity);
  let cookie = '';
  await c.services.sessions.issue({ cookie: (n, v) => { cookie = `${n}=${v}`; } }, user.id);
  return cookie;
}
const admin = (c = ctx) => session(c, { externalId: 'szo:1', name: 'Zofia Admin', email: 'z@example.pl', role: 'administrator' });
const call = (cookie, method, url, data, b = base) => fetch(b + url, { method, headers: { cookie }, body: data ? new URLSearchParams(data) : undefined, redirect: 'manual' });
const flashOf = (res) => decodeURIComponent((res.headers.getSetCookie().find((c) => c.startsWith('tk_flash=')) || '').split(';')[0].replace(/^tk_flash=/, '').replace(/\+/g, ' '));

test('usługa ustawień: szyfrowanie, odporność na zły sekret i podmianę nazwy, brak jawnego tekstu w bazie', () => {
  const db = openDatabase(':memory:');
  const mk = (secret, apiKey) => createSettingsService(db, { sessionSecret: secret, szo: { apiKey } });
  const a = mk('a'.repeat(40), null);
  assert.equal(a.szoApiKey(), null);
  a.setSecret(SZO_API_KEY, KEY, null);
  assert.equal(a.szoApiKey(), KEY);
  assert.equal(a.getSecret(SZO_API_KEY), KEY);
  const stored = db.prepare('SELECT value FROM app_settings').get().value;
  assert.ok(stored.startsWith('v1:'));
  assert.ok(!stored.includes('TAJNY') && !Buffer.from(stored.split(':')[3], 'base64').toString('utf8').includes('TAJNY'));

  // dwa zapisy tej samej wartości dają różny szyfrogram (losowy IV)
  a.setSecret(SZO_API_KEY, KEY, null);
  assert.notEqual(db.prepare('SELECT value FROM app_settings').get().value, stored);

  // inny SESSION_SECRET: wartość nie do odczytu, aplikacja wraca do klucza z .env
  const b = mk('b'.repeat(40), 'klucz-env-abcdefgh');
  assert.equal(b.getSecret(SZO_API_KEY), undefined);
  assert.equal(b.szoApiKey(), 'klucz-env-abcdefgh');
  assert.equal(b.szoApiKeyInfo().unreadable, true);
  assert.equal(mk('b'.repeat(40), null).szoApiKey(), null);

  // zmanipulowany szyfrogram lub inna nazwa ustawienia
  const parts = stored.split(':'); parts[3] = Buffer.from('zmieniony').toString('base64');
  db.prepare('UPDATE app_settings SET value = ?').run(parts.join(':'));
  assert.equal(a.getSecret(SZO_API_KEY), undefined);
  a.setSecret(SZO_API_KEY, KEY, null);
  db.prepare(`UPDATE app_settings SET name = 'inne'`).run();
  assert.equal(a.getSecret(SZO_API_KEY), null);

  assert.throws(() => a.setSecret('nieznane', 'x'.repeat(20), null), /Nieznane ustawienie/);
  assert.equal(a.clear('inne'), true);
});

test('dostęp: tylko administrator; pozycja w grupie „Administracja”', async () => {
  const auditor = await session(ctx, { externalId: 'szo:2', name: 'Audytor', email: 'a@example.pl', role: 'auditor' });
  const coord = await session(ctx, { externalId: 'szo:3', name: 'Koord', email: 'k@example.pl', role: 'coordinator' });
  for (const cookie of [auditor, coord]) {
    assert.equal((await call(cookie, 'GET', '/settings/szo')).status, 403);
    assert.equal((await call(cookie, 'POST', '/settings/szo', { apiKey: KEY })).status, 403);
    assert.equal((await call(cookie, 'POST', '/settings/szo/check')).status, 403);
    assert.equal((await call(cookie, 'POST', '/settings/szo/clear')).status, 403);
  }
  assert.equal((await fetch(`${base}/settings/szo`, { redirect: 'manual' })).status, 303, 'niezalogowany trafia na logowanie');
  assert.match(await (await call(await admin(), 'GET', '/users')).text(), /href="\/settings\/szo"[^>]*>Integracja z SZO</);
});

test('wklejanie klucza: zapis zaszyfrowany, klucz nigdy nie wraca do przeglądarki ani do komunikatów', async () => {
  reset();
  const cookie = await admin();
  const empty = await (await call(cookie, 'GET', '/settings/szo')).text();
  assert.match(empty, /Klucz API<\/dt>\s*<dd>\s*brak/);
  assert.match(empty, /type="password"/);
  assert.equal(ctx.services.szoDirectoryEnabled, undefined);

  const res = await call(cookie, 'POST', '/settings/szo', { apiKey: `  ${KEY}  ` });
  assert.equal(res.status, 303);
  const flash = flashOf(res);
  assert.match(flash, /Zapisano klucz API/);
  assert.match(flash, /Import użytkowników: działa \(kont z uprawnieniem do aplikacji: 1\)/);
  assert.match(flash, /Wysyłka e-mail: działa/);
  assert.ok(!flash.includes('TAJNY'), 'klucz nie trafia do komunikatu');
  assert.equal(szo.calls[0].auth, `Bearer ${KEY}`, 'sprawdzenie użyło zapisanego klucza (po przycięciu spacji)');

  const html = await (await call(cookie, 'GET', '/settings/szo')).text();
  assert.match(html, /zapisany w panelu \(kończy się na „cdef”\)/);
  assert.match(html, /Zofia Admin/);
  assert.ok(!html.includes('TAJNY') && !html.includes(KEY), 'klucz nie jest wyświetlany ponownie');
  assert.doesNotMatch(html, /value="ezdk/, 'pole formularza nie jest wstępnie wypełniane');

  const stored = ctx.db.prepare('SELECT value, updated_by FROM app_settings').get();
  assert.ok(!stored.value.includes('TAJNY'));
  assert.ok(stored.updated_by);
});

test('zapisany klucz jest używany przez import i wysyłkę poczty, a import włącza się bez zmian w .env', async () => {
  reset();
  assert.equal(ctx.services.szoDirectory?.enabled, undefined);
  const cookie = await admin();
  const page = await (await call(cookie, 'GET', '/users/import')).text();
  assert.match(page, /Anna/, 'lista użytkowników z SZO pobrana kluczem z panelu');
  assert.equal(szo.calls.at(-1).auth, `Bearer ${KEY}`);
  assert.match(await (await call(cookie, 'GET', '/users')).text(), /Importuj z SZO/);

  // mailer używa tego samego klucza (tryb szo)
  const cfg = loadConfig(env({ MAIL_MODE: 'szo' }));
  const mailCtx = createApp(cfg, { db: ctx.db, fetchImpl: (u, i) => szo.fetch(u, i) });
  szo.mail = { status: 200, json: { ok: true, queued: 1, skipped: [] } };
  szo.calls.length = 0;
  const user = mailCtx.services.users.upsertFromIdentity({ externalId: 'szo:9', name: 'Ewa', email: 'ewa@example.pl', role: 'auditor' });
  mailCtx.services.notifier.auditApproved({ id: 1, auditor_id: user.id, object_name: 'O' }, null);
  await mailCtx.services.notifier.processOutbox();
  assert.equal(szo.calls.at(-1).url, 'https://szo.example.pl/api/v1/audytor_mail.php');
  assert.equal(szo.calls.at(-1).auth, `Bearer ${KEY}`, 'poczta używa klucza z panelu');
});

test('walidacja: zbyt krótki, ze spacjami lub pusty klucz jest odrzucany bez zapisu i bez odesłania wartości', async () => {
  const cookie = await admin();
  const before = ctx.db.prepare('SELECT value FROM app_settings').get().value;
  for (const bad of ['krotki', 'ma spacje w srodku 1234567890', '', 'zly<znak>1234567890123456', 'x'.repeat(301)]) {
    const res = await call(cookie, 'POST', '/settings/szo', { apiKey: bad });
    assert.equal(res.status, 422, JSON.stringify(bad));
    const html = await res.text();
    assert.match(html, /field-error/);
    if (bad.length > 3) assert.ok(!html.includes(bad), 'odrzucona wartość nie jest odsyłana');
  }
  assert.equal(ctx.db.prepare('SELECT value FROM app_settings').get().value, before, 'zapisany klucz bez zmian');
});

test('sprawdzanie połączenia: uprawnienia, brak endpointów, niedostępne SZO', async () => {
  const cookie = await admin();
  const check = async () => (await call(cookie, 'POST', '/settings/szo/check')).text();

  reset();
  let html = await check();
  assert.match(html, /Import użytkowników:<\/strong> OK, działa/);
  assert.match(html, /Wysyłka e-mail:<\/strong> OK, działa/);

  reset(); szo.users = { status: 403, json: {} }; szo.mail = { status: 403, json: {} };
  html = await check();
  assert.match(html, /nie ma uprawnienia „lista użytkowników”/);
  assert.match(html, /nie ma uprawnienia „wysyłka powiadomień”/);

  reset(); szo.mail = { status: 404, json: {} };
  html = await check();
  assert.match(html, /Import użytkowników:<\/strong> OK/);
  assert.match(html, /nie ma jeszcze endpointu wysyłki/);

  reset(); szo.down = true;
  assert.match(await check(), /SZO jest niedostępne/);
  reset();
});

test('usuwanie klucza z panelu: powrót do klucza z .env albo brak klucza', async () => {
  reset();
  // instancja z kluczem w .env i kluczem w panelu: panel ma pierwszeństwo, po usunięciu działa .env
  const cookie = await admin(envKeyCtx);
  const srv = envKeyCtx.app.listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.match(await (await call(cookie, 'GET', '/settings/szo', null, b)).text(), /z pliku <code>\.env<\/code> \(kończy się na „7890”\)/);
    await call(cookie, 'POST', '/settings/szo', { apiKey: KEY }, b);
    assert.equal(envKeyCtx.services.settings.szoApiKey(), KEY, 'panel ma pierwszeństwo przed .env');
    const res = await call(cookie, 'POST', '/settings/szo/clear', null, b);
    assert.match(flashOf(res), /Aplikacja używa teraz klucza z pliku \.env/);
    assert.equal(envKeyCtx.services.settings.szoApiKey(), 'klucz-z-pliku-env-1234567890');
  } finally { srv.close(); }

  // instancja bez klucza w .env: po usunięciu import przestaje działać
  const cookie2 = await admin();
  const res = await call(cookie2, 'POST', '/settings/szo/clear');
  assert.match(flashOf(res), /Nie ma już żadnego klucza API/);
  assert.equal(ctx.services.settings.szoApiKey(), null);
  assert.doesNotMatch(await (await call(cookie2, 'GET', '/users')).text(), /Importuj z SZO/);
  assert.match(await (await call(cookie2, 'GET', '/users/import')).text(), /Import z SZO nie jest skonfigurowany/);
  assert.match(flashOf(await call(cookie2, 'POST', '/settings/szo/clear')), /nie było zapisanego klucza/);
});

test('zmiana SESSION_SECRET: strona ostrzega, że zapisany klucz jest nieczytelny', async () => {
  ctx.services.settings.setSecret(SZO_API_KEY, KEY, null);
  const rotated = createApp(loadConfig(env({ SESSION_SECRET: 'inny-sekret-sesji-inny-sekret-sesji-123456' })), { db: ctx.db, fetchImpl: (u, i) => szo.fetch(u, i) });
  const srv = rotated.app.listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r));
  try {
    const cookie = await admin(rotated);
    const html = await (await call(cookie, 'GET', '/settings/szo', null, `http://127.0.0.1:${srv.address().port}`)).text();
    assert.match(html, /nie da się odczytać/);
    assert.equal(rotated.services.szoDirectory?.enabled, undefined);
    assert.equal(rotated.services.settings.szoApiKey(), null);
  } finally { srv.close(); ctx.services.settings.clear(SZO_API_KEY); }
});
