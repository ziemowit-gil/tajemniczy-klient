const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-role-'));
const config = loadConfig({
  NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir, SESSION_SECRET: 'session-secret-session-secret-session-secret',
  SZO_AUTH_MODE: 'szo', SZO_BASE_URL: 'https://szo.example.pl', APP_URL: 'https://audytor.feer.org.pl', SZO_API_KEY: 'klucz-importu-1234567890',
  MAIL_MODE: 'log', MAIL_AUTOFLUSH: 'false', ADMIN_EMAILS: 'szef@example.pl',
});

const mailbox = { sent: [], async send(m) { this.sent.push(m); } };
/** Atrapa SZO: lista użytkowników (import) i wymiana kodu na token (logowanie). */
const szo = { directory: [], token: null,
  async fetch(url) {
    if (url.includes('audytor_users.php')) return new Response(JSON.stringify({ ok: true, users: this.directory }), { status: 200 });
    if (url.includes('action=logout')) return new Response('{"ok":true}', { status: 200 });
    return new Response(JSON.stringify(this.token), { status: 200 });
  } };
const { app, db, services } = createApp(config, { mailer: mailbox, fetchImpl: (u, i) => szo.fetch(u, i) });

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

const reset = () => { mailbox.sent.length = 0; db.exec('DELETE FROM notifications'); };
async function adminSession() {
  const user = services.users.upsertFromIdentity({ externalId: 'szo:1', name: 'Admin', email: 'admin@example.pl', role: 'administrator' });
  let cookie = '';
  await services.sessions.issue({ cookie: (n, v) => { cookie = `${n}=${v}`; } }, user.id);
  return cookie;
}
const call = (cookie, method, url, data) => fetch(base + url, { method, headers: { cookie }, body: data ? new URLSearchParams(data) : undefined, redirect: 'manual' });
const roleMails = () => mailbox.sent.filter((m) => /Przydzielenie roli/.test(m.subject));

async function szoLogin(id, name, email) {
  const jar = new Map();
  const send = async (url) => {
    const res = await fetch(base + url, { headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) { const [p] = line.split(';'); const i = p.indexOf('='); jar.set(p.slice(0, i), p.slice(i + 1)); }
    return res;
  };
  const start = await send('/auth/szo/start');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  szo.token = { access_token: 'ezdc_x', scopes: ['audytor:access'], user: { id, name, email } };
  return send(`/auth/szo/callback?code=${crypto.randomBytes(32).toString('hex')}&state=${state}`);
}

test('treść maila: temat i tekst zgodne z wzorem, czysty tekst, bez emoji', async () => {
  reset();
  const user = services.users.upsertFromIdentity({ externalId: 'szo:50', name: 'Jan Kowalski', email: 'jan@example.pl', role: 'auditor' });
  assert.equal(services.notifier.roleAssignedAuditor(user), true);
  await services.notifier.processOutbox();

  const m = roleMails()[0];
  assert.equal(m.to, 'jan@example.pl');
  assert.equal(m.subject, 'Przydzielenie roli: Audytor dostępności (Tajemniczy klient)', 'dokładnie wskazany temat, bez prefiksu');
  assert.deepEqual(Object.keys(m).sort(), ['subject', 'text', 'to'], 'czysty tekst, bez html');
  for (const fragment of [
    'Dzień dobry,',
    'Informujemy, że w systemie została Ci przydzielona rola Audytora dostępności / Tajemniczego klienta.',
    'Dostęp do panelu audytora uzyskasz po zalogowaniu na stronie:\nhttps://audytor.feer.org.pl',
    'Przyznana rola uprawnia do realizowania przydzielonych audytów dostępności, wprowadzania formularzy z obserwacji (metodą tajemniczego klienta) oraz weryfikacji wymogów i standardów dostępności w wyznaczonym zakresie.',
    'W razie pytań lub problemów z logowaniem prosimy o kontakt z zespołem technicznym.',
    'Z poważaniem,\n\nFundacja Edukacji Empatii Rozwoju „FEER”',
  ]) assert.ok(m.text.includes(fragment), fragment);
  assert.doesNotMatch(m.text, /\p{Extended_Pictographic}/u, 'bez emoji (czytniki ekranu odczytują je nazwami)');
  assert.doesNotMatch(m.text, /<[a-z][^>]*>/i);
});

test('wysyłka jest jedna dziennie na osobę, a opt-out i brak e-maila ją wyłączają', async () => {
  reset();
  const user = services.users.upsertFromIdentity({ externalId: 'szo:51', name: 'Ewa', email: 'ewa@example.pl', role: 'auditor' });
  assert.equal(services.notifier.roleAssignedAuditor(user), true);
  assert.equal(services.notifier.roleAssignedAuditor(user), false, 'duplikat tego samego dnia');
  assert.equal(services.notifier.roleAssignedAuditor(user, new Date(Date.now() + 2 * 86400000)), true, 'kolejnego dnia (np. po ponownym nadaniu roli)');

  reset();
  services.users.setNotify(user.id, false);
  assert.equal(services.notifier.roleAssignedAuditor(services.users.findById(user.id)), false);
  const noMail = services.users.upsertFromIdentity({ externalId: 'szo:52', name: 'Bez maila', email: null, role: 'auditor' });
  assert.equal(services.notifier.roleAssignedAuditor(noMail), false);
});

test('zmiana roli w panelu: mail tylko przy zmianie NA audytora', async () => {
  reset();
  const admin = await adminSession();
  const u = services.users.upsertFromIdentity({ externalId: 'szo:60', name: 'Zmiana', email: 'zmiana@example.pl', role: 'coordinator' });

  await call(admin, 'POST', `/users/${u.id}`, { role: 'auditor', active: 'on' });
  await services.notifier.processOutbox();
  assert.equal(roleMails().length, 1);
  assert.equal(roleMails()[0].to, 'zmiana@example.pl');

  reset();
  await call(admin, 'POST', `/users/${u.id}`, { role: 'auditor', active: 'on' });   // bez zmiany roli
  await call(admin, 'POST', `/users/${u.id}`, { role: 'coordinator', active: 'on' }); // inna rola
  await services.notifier.processOutbox();
  assert.equal(roleMails().length, 0);

  reset();
  services.users.update(u.id, { role: 'auditor', active: false });                    // konto nieaktywne → przywrócenie = nowe nadanie
  await call(admin, 'POST', `/users/${u.id}`, { role: 'auditor', active: 'on' });
  await services.notifier.processOutbox();
  assert.equal(roleMails().length, 1, 'reaktywacja konta audytora');
});

test('import z SZO: mail tylko dla osób zaimportowanych jako audytor', async () => {
  reset();
  const admin = await adminSession();
  szo.directory = [{ id: 70, name: 'Audytor Importowany', email: 'aud70@example.pl' }, { id: 71, name: 'Koordynator Importowany', email: 'koord71@example.pl' }];
  await call(admin, 'POST', '/users/import', [['pick', '70'], ['pick', '71'], ['role_70', 'auditor'], ['role_71', 'coordinator']]);
  await services.notifier.processOutbox();
  assert.deepEqual(roleMails().map((m) => m.to), ['aud70@example.pl']);
});

test('pierwsze logowanie przez SZO: nowa osoba dostaje mail o roli audytora, kolejne logowanie i administrator nie', async () => {
  reset();
  assert.equal((await szoLogin(80, 'Nowa Osoba', 'nowa80@example.pl')).headers.get('location'), '/');
  assert.equal(services.users.list().find((u) => u.external_id === 'szo:80').role, 'auditor');
  await services.notifier.processOutbox();
  assert.deepEqual(roleMails().map((m) => m.to), ['nowa80@example.pl']);

  reset();
  await szoLogin(80, 'Nowa Osoba', 'nowa80@example.pl');   // drugie logowanie
  await szoLogin(81, 'Szef', 'szef@example.pl');            // administrator z ADMIN_EMAILS
  await services.notifier.processOutbox();
  assert.equal(roleMails().length, 0);
  assert.equal(services.users.list().find((u) => u.external_id === 'szo:81').role, 'administrator');
});
