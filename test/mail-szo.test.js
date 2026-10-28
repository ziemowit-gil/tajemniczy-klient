const test = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { createMailer, MailError } = require('../src/services/mailer');

const szoCfg = { baseUrl: 'https://szo.example.pl', apiKey: 'klucz-poczty-1234567890', timeoutMs: 2000 };
const mailCfg = { mode: 'szo', smtp: {} };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mailerWith(handler) {
  const calls = [];
  const mailer = createMailer(mailCfg, { szo: szoCfg, fetchImpl: async (url, init) => { calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null }); return handler(calls.length); } });
  return { mailer, calls };
}
const msg = { to: 'anna@example.pl', subject: 'Temat\r\nBcc: obcy@example.pl', text: 'Dzień dobry,\n\nTreść.\n' };

test('szo: żądanie do audytor_mail.php z kluczem, czystym tekstem i bezpiecznym tematem', async () => {
  const { mailer, calls } = mailerWith(() => json(200, { ok: true, queued: 1, skipped: [] }));
  await mailer.send(msg);
  const c = calls[0];
  assert.equal(c.url, 'https://szo.example.pl/api/v1/audytor_mail.php');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers.Authorization, 'Bearer klucz-poczty-1234567890');
  assert.deepEqual(Object.keys(c.body).sort(), ['message', 'recipients', 'subject'], 'brak pola html');
  assert.deepEqual(c.body.recipients, [{ email: 'anna@example.pl' }]);
  assert.equal(c.body.message, msg.text);
  assert.doesNotMatch(c.body.subject, /[\r\n]/, 'brak znaków nowej linii w temacie');
});

test('szo: klasyfikacja błędów na trwałe i przejściowe', async () => {
  const cases = [
    [() => json(422, { error: 'Brak adresatów uprawnionych do powiadomień.' }), true, /odrzuciło wiadomość: Brak adresatów/],
    [() => json(400, { error: 'Wymagane ciało JSON.' }), true, /odrzuciło wiadomość/],
    [() => json(200, { ok: true, queued: 0, skipped: [{ email: 'anna@example.pl', reason: 'adres spoza uprawnionych użytkowników' }] }), true, /pominęło adresata: adres spoza uprawnionych/],
    [() => json(429, { error: 'Przekroczono limit' }), false, /Limit wysyłek/],
    [() => json(500, {}), false, /Błąd SZO \(500\)/],
    [() => json(401, {}), false, /odrzuciło klucz API/],
    [() => json(404, {}), false, /nie ma jeszcze endpointu/],
    [() => new Response('<html>błąd</html>', { status: 200 }), false, /Niepoprawna odpowiedź/],
  ];
  for (const [handler, permanent, re] of cases) {
    const { mailer } = mailerWith(handler);
    await assert.rejects(mailer.send(msg), (err) => err instanceof MailError && err.permanent === permanent && re.test(err.message), String(re));
  }
  const failing = createMailer(mailCfg, { szo: szoCfg, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(failing.send(msg), (err) => err.permanent === false && /niedostępne/.test(err.message));
});

test('konfiguracja: MAIL_MODE=szo wymaga SZO_BASE_URL i APP_URL, a klucz API może pochodzić z panelu', () => {
  const env = { NODE_ENV: 'test', SZO_AUTH_MODE: 'dev', MAIL_MODE: 'szo' };
  assert.throws(() => loadConfig(env), /SZO_BASE_URL/);
  assert.throws(() => loadConfig({ ...env, SZO_BASE_URL: 'https://szo.example.pl' }), /APP_URL/);
  const cfg = loadConfig({ ...env, SZO_BASE_URL: 'https://szo.example.pl', APP_URL: 'https://a.example.pl' });
  assert.equal(cfg.mail.mode, 'szo');
  assert.equal(cfg.szo.apiKey, undefined, 'bez klucza w .env start jest możliwy (klucz wklejany w panelu)');
});

/** Integracja: zdarzenie → kolejka → wysyłka przez (atrapę) SZO. */
function appWith(handler) {
  const calls = [];
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_PATH: ':memory:', SESSION_SECRET: 'session-secret-session-secret-session-secret', SZO_AUTH_MODE: 'dev',
    MAIL_MODE: 'szo', MAIL_AUTOFLUSH: 'false', APP_URL: 'https://audytor.example.pl', SZO_BASE_URL: 'https://szo.example.pl', SZO_API_KEY: 'klucz-poczty-1234567890',
  });
  const ctx = createApp(config, { fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return handler(calls.length); } });
  const user = ctx.services.users.upsertFromIdentity({ externalId: 'szo:5', name: 'Anna Nowak', email: 'anna@example.pl', role: 'auditor' });
  return { ...ctx, calls, user };
}
const approvedAudit = (user) => ({ id: 7, auditor_id: user.id, object_name: 'Uczelnia X' });

test('kolejka przez SZO: poprawna wysyłka oznacza wiadomość jako wysłaną', async () => {
  const t = appWith(() => json(200, { ok: true, queued: 1, skipped: [] }));
  t.services.notifier.auditApproved(approvedAudit(t.user), 'Zgodne');
  const stats = await t.services.notifier.processOutbox();
  assert.equal(stats.sent, 1);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].body.recipients[0].email, 'anna@example.pl');
  assert.match(t.calls[0].body.message, /Komentarz koordynatora: Zgodne/);
  assert.match(t.calls[0].body.message, /https:\/\/audytor\.example\.pl\/audits\/7/);
  assert.doesNotMatch(t.calls[0].body.message, /<[a-z][^>]*>/i);
  assert.equal(t.db.prepare('SELECT status FROM notifications').get().status, 'sent');
});

test('kolejka przez SZO: błąd trwały kończy próby od razu, błąd przejściowy jest ponawiany', async () => {
  const perm = appWith(() => json(422, { error: 'Brak adresatów uprawnionych do powiadomień.' }));
  perm.services.notifier.auditApproved(approvedAudit(perm.user), null);
  assert.equal((await perm.services.notifier.processOutbox()).failed, 1);
  const row = perm.db.prepare('SELECT status, attempts, last_error FROM notifications').get();
  assert.equal(row.status, 'failed');
  assert.equal(row.attempts, 1, 'bez ponawiania po odrzuceniu trwałym');
  assert.match(row.last_error, /Brak adresatów uprawnionych/);

  const transient = appWith(() => json(429, { error: 'Przekroczono limit wysyłek na godzinę.' }));
  transient.services.notifier.auditApproved(approvedAudit(transient.user), null);
  assert.equal((await transient.services.notifier.processOutbox()).retried, 1);
  const retry = transient.db.prepare('SELECT status, attempts FROM notifications').get();
  assert.deepEqual({ ...retry }, { status: 'pending', attempts: 1 });

  // po upływie opóźnienia kolejna próba kończy się sukcesem
  let ok = false;
  const flaky = appWith(() => (ok ? json(200, { ok: true, queued: 1, skipped: [] }) : json(500, {})));
  flaky.services.notifier.auditApproved(approvedAudit(flaky.user), null);
  await flaky.services.notifier.processOutbox();
  ok = true;
  flaky.db.exec(`UPDATE notifications SET next_attempt_at = datetime('now', '-1 minute')`);
  assert.equal((await flaky.services.notifier.processOutbox()).sent, 1);
});
