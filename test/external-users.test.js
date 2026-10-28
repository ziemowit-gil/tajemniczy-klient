const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { normalizePhone, maskPhone, LIMITS } = require('../src/services/externalAuth');
const { validatePassword } = require('../src/services/passwords');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-ext-'));
const baseEnv = {
  NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir, SESSION_SECRET: 'session-secret-session-secret-session-secret',
  SZO_AUTH_MODE: 'szo', SZO_BASE_URL: 'https://szo.example.pl', APP_URL: 'https://audytor.feer.org.pl', SZO_API_KEY: 'klucz-importu-1234567890',
  MAIL_MODE: 'log', MAIL_AUTOFLUSH: 'false', SMS_MODE: 'szo',
};
const mailbox = { sent: [], async send(m) { this.sent.push(m); } };
const szo = { sms: [], failSms: false,
  async fetch(url, init) {
    if (url.includes('audytor_sms.php')) {
      if (this.failSms) return new Response('{"ok":false,"error":"x"}', { status: 502 });
      this.sms.push({ ...JSON.parse(init.body), auth: init.headers.Authorization });
      return new Response('{"ok":true}', { status: 200 });
    }
    return new Response('{"ok":true,"users":[]}', { status: 200 });
  } };
const { app, db, services } = createApp(loadConfig(baseEnv), { mailer: mailbox, fetchImpl: (u, i) => szo.fetch(u, i) });

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

class Browser {
  constructor() { this.jar = new Map(); }
  async req(method, url, data) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, { method, headers: cookie ? { cookie } : {}, body: data ? new URLSearchParams(data) : undefined, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) {
      const [p] = line.split(';'); const i = p.indexOf('=');
      if (/Expires=Thu, 01 Jan 1970/i.test(line)) this.jar.delete(p.slice(0, i)); else this.jar.set(p.slice(0, i), p.slice(i + 1));
    }
    return res;
  }
  get(u) { return this.req('GET', u); }
  post(u, d) { return this.req('POST', u, d ?? {}); }
}
async function adminBrowser() {
  const user = services.users.upsertFromIdentity({ externalId: 'szo:adm', name: 'Admin', email: 'admin@example.pl', role: 'administrator' });
  const b = new Browser();
  await services.sessions.issue({ cookie: (n, v) => b.jar.set(n, v) }, user.id);
  return b;
}
const PASSWORD = 'zielony rower jedzie po lesie';
const tokenFromMail = () => /token=([A-Za-z0-9_-]+)/.exec(db.prepare(`SELECT body FROM notifications ORDER BY id DESC`).get().body)?.[1];
const lastCode = () => /logowania (\d{6})/.exec(szo.sms.at(-1).message)[1];
const reset = () => { szo.sms.length = 0; szo.failSms = false; };

async function createExternal(email = 'jan@example.pl', phone = '600 100 200') {
  const admin = await adminBrowser();
  const res = await admin.post('/users/external', { name: 'Jan Zewnętrzny', email, phone });
  assert.equal(res.status, 303);
  await services.notifier.processOutbox();
  return db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email).id;
}

test('numer telefonu: normalizacja do E.164 i maskowanie', () => {
  assert.equal(normalizePhone('600 100 200'), '+48600100200');
  assert.equal(normalizePhone('+48 600-100-200'), '+48600100200');
  assert.equal(normalizePhone('0048600100200'), '+48600100200');
  assert.equal(normalizePhone('48600100200'), '+48600100200');
  assert.equal(normalizePhone('+4915112345678'), '+4915112345678');
  assert.equal(normalizePhone('abc'), null);
  assert.equal(normalizePhone('123'), null);
  assert.equal(maskPhone('+48600100200'), '+48 ••• ••• 200');
});

test('polityka haseł: długość, zakaz oczywistych haseł, e-maila i nazwiska', () => {
  assert.ok(validatePassword('krotkie1', {}));
  assert.ok(validatePassword('password1234', {}));
  assert.ok(validatePassword('jan.kowalski@example.pl1', { email: 'jan.kowalski@example.pl', name: 'Jan Kowalski' }));
  assert.equal(validatePassword(PASSWORD, { email: 'jan@example.pl', name: 'Jan Zewnętrzny' }), null);
});

test('konfiguracja: SMS_MODE=log zabroniony w produkcji, szo wymaga SZO_BASE_URL', () => {
  assert.throws(() => loadConfig({ ...baseEnv, NODE_ENV: 'production', SMS_MODE: 'log', SESSION_SECRET: 'x'.repeat(40) }));
  assert.throws(() => loadConfig({ ...baseEnv, SZO_BASE_URL: undefined, SMS_MODE: 'szo', SZO_AUTH_MODE: 'dev' }));
  assert.equal(loadConfig({ ...baseEnv, SMS_MODE: undefined }).sms.mode, 'off');
});

test('administrator zakłada konto zewnętrzne: rola tylko Audytor, e-mail z linkiem, hasło dopiero po jego ustawieniu', async () => {
  reset();
  const id = await createExternal();
  const u = services.users.findById(id);
  assert.equal(u.kind, 'external');
  assert.deepEqual(u.roles, ['auditor']);
  assert.equal(u.phone, '+48600100200');
  assert.equal(u.hasPassword, false);
  assert.equal(mailbox.sent.length, 1);
  assert.match(mailbox.sent.at(-1).text, /https:\/\/audytor\.feer\.org\.pl\/ext\/set-password\?token=/);
  assert.match(mailbox.sent.at(-1).text, /72 godziny/);
  assert.ok(!/600 ?100 ?200|\+48600/.test(mailbox.sent.at(-1).text), 'pełny numer nie trafia do e-maila');
  // po wysłaniu treść z linkiem znika z kolejki
  assert.match(db.prepare(`SELECT body FROM notifications WHERE event = 'external_account'`).get().body, /Treść usunięta/);
  // przed ustawieniem hasła nie da się zalogować
  const b = new Browser();
  assert.equal((await b.post('/login/external', { email: 'jan@example.pl', password: PASSWORD })).status, 401);
  assert.equal(szo.sms.length, 0);
});

test('konto zewnętrzne: dodaje tylko administrator, duplikat i błędne dane są odrzucane', async () => {
  const anon = new Browser();
  assert.notEqual((await anon.post('/users/external', { name: 'X Y', email: 'x@example.pl', phone: '600100200' })).status, 200);
  const coord = services.users.upsertFromIdentity({ externalId: 'szo:coord', name: 'Koord', email: 'k@example.pl', role: 'coordinator' });
  const cb = new Browser();
  await services.sessions.issue({ cookie: (n, v) => cb.jar.set(n, v) }, coord.id, 'coordinator');
  assert.equal((await cb.post('/users/external', { name: 'X Y', email: 'x2@example.pl', phone: '600100200' })).status, 403);
  assert.equal(db.prepare(`SELECT 1 FROM users WHERE email = 'x2@example.pl'`).get(), undefined);

  const admin = await adminBrowser();
  for (const bad of [{ name: 'A', email: 'a@example.pl', phone: '600100200' }, { name: 'Ala Ma', email: 'bez-malpy', phone: '600100200' }, { name: 'Ala Ma', email: 'ala@example.pl', phone: '12' }]) {
    await admin.post('/users/external', bad);
  }
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM users WHERE kind = 'external' AND email IN ('a@example.pl','bez-malpy','ala@example.pl')`).get().n, 0);
  await createExternal('dup@example.pl');
  await admin.post('/users/external', { name: 'Dup Dwa', email: 'DUP@example.pl', phone: '600100201' });
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM users WHERE lower(email) = 'dup@example.pl'`).get().n, 1);
});

test('pełna ścieżka: link → hasło → logowanie hasłem → kod SMS → sesja', async () => {
  reset();
  const id = await createExternal('pelna@example.pl', '+48 601 000 001');
  const token = tokenForUser(id);
  const b = new Browser();
  assert.equal((await b.get(`/ext/set-password?token=${token}`)).status, 200);
  // słabe i niezgodne hasło
  assert.equal((await b.post('/ext/set-password', { token, password: 'krotkie', password2: 'krotkie' })).status, 422);
  assert.equal((await b.post('/ext/set-password', { token, password: PASSWORD, password2: `${PASSWORD}x` })).status, 422);
  assert.equal((await b.post('/ext/set-password', { token, password: PASSWORD, password2: PASSWORD })).status, 303);
  // token jednorazowy
  assert.equal((await b.get(`/ext/set-password?token=${token}`)).status, 400);

  // złe hasło i nieznany adres: ta sama odpowiedź
  const bad1 = await b.post('/login/external', { email: 'pelna@example.pl', password: 'zle haslo zle haslo' });
  const bad2 = await b.post('/login/external', { email: 'nie-ma@example.pl', password: 'zle haslo zle haslo' });
  assert.equal(bad1.status, 401); assert.equal(bad2.status, 401);
  const strip = (h) => h.replace(/value="[^"]*@example\.pl"/, 'value=""');
  assert.equal(strip(await bad1.text()), strip(await bad2.text()), 'ta sama odpowiedź dla nieznanego adresu i błędnego hasła');
  assert.equal(szo.sms.length, 0);

  const ok = await b.post('/login/external', { email: 'Pelna@Example.pl', password: PASSWORD });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/login/verify');
  assert.equal(szo.sms.length, 1);
  assert.equal(szo.sms[0].phone, '+48601000001');
  assert.equal(szo.sms[0].auth, 'Bearer klucz-importu-1234567890');
  assert.match(szo.sms[0].message, /^Tajemniczy Klient: kod logowania \d{6}\. Wazny 5 min\. Nie podawaj go nikomu\.$/);
  // przed kodem nie ma dostępu do aplikacji
  assert.equal((await b.get('/')).status, 303);
  assert.equal((await b.get('/login/verify')).status, 200);
  // zły kod nie loguje, dobry loguje
  assert.equal((await b.post('/login/verify', { code: '000000' === lastCode() ? '111111' : '000000' })).status, 422);
  const done = await b.post('/login/verify', { code: lastCode() });
  assert.equal(done.status, 303);
  assert.equal(done.headers.get('location'), '/');
  assert.equal((await b.get('/')).status, 200, 'po kodzie SMS użytkownik ma sesję');
  // kod jest jednorazowy
  const b2 = new Browser(); b2.jar = new Map(b.jar); b2.jar.delete('tk_session');
  assert.equal((await b2.post('/login/verify', { code: lastCode() })).status, 303);
  assert.equal((await b2.get('/')).headers.get('location'), '/login');
});

function tokenForUser(userId) {
  // token zna tylko e-mail; w testach odtwarzamy go przez wystawienie nowego (poprzednie tracą ważność)
  return services.externalAuth.issueSetPasswordToken(userId);
}

async function readyUser(email, phone = '600 200 300') {
  const id = await createExternal(email, phone);
  services.externalAuth.setPassword(tokenForUser(id), PASSWORD, PASSWORD);
  return id;
}
async function passwordStep(email, b = new Browser()) {
  const res = await b.post('/login/external', { email, password: PASSWORD });
  return { b, res };
}

test('kod SMS: 5 prób, potem wyzwanie jest martwe nawet z poprawnym kodem; kody tylko jako skrót w bazie', async () => {
  reset();
  await readyUser('proby@example.pl');
  const { b, res } = await passwordStep('proby@example.pl');
  assert.equal(res.status, 303);
  const code = lastCode();
  const hash = db.prepare('SELECT code_hash FROM login_challenges ORDER BY created_at DESC LIMIT 1').get().code_hash;
  assert.ok(!hash.includes(code) && hash.length === 64, 'w bazie jest skrót');
  const wrong = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < LIMITS.maxAttempts - 1; i += 1) assert.equal((await b.post('/login/verify', { code: wrong })).status, 422);
  assert.equal((await b.post('/login/verify', { code: wrong })).status, 303);   // ostatnia próba kończy wyzwanie
  assert.equal((await b.post('/login/verify', { code })).status, 303);
  assert.equal((await b.get('/')).headers.get('location'), '/login');
});

test('kod SMS: wygasa po 5 minutach, a ponowne wysłanie ma odstęp i limit', async () => {
  reset();
  await readyUser('wygasa@example.pl');
  const { b } = await passwordStep('wygasa@example.pl');
  const code = lastCode();
  // odstęp między wysyłkami
  assert.equal((await b.post('/login/verify/resend')).status, 303);
  assert.equal(szo.sms.length, 1, 'za wcześnie na kolejny kod');
  db.exec(`UPDATE login_challenges SET last_sent_at = datetime('now', '-2 minutes')`);
  await b.post('/login/verify/resend');
  assert.equal(szo.sms.length, 2);
  // stary kod nie działa po wysłaniu nowego (chyba że to ten sam przypadkiem)
  const fresh = lastCode();
  if (fresh !== code) assert.equal((await b.post('/login/verify', { code })).status, 422);
  // limit ponowień
  for (let i = 0; i < 5; i += 1) { db.exec(`UPDATE login_challenges SET last_sent_at = datetime('now', '-2 minutes')`); await b.post('/login/verify/resend'); }
  assert.ok(szo.sms.length <= LIMITS.maxSends, `wysłano ${szo.sms.length} SMS-ów`);
  // wygaśnięcie
  const b2 = (await passwordStep('wygasa@example.pl')).b;
  const c2 = lastCode();
  db.exec(`UPDATE login_challenges SET expires_at = datetime('now', '-1 minutes')`);
  assert.equal((await b2.post('/login/verify', { code: c2 })).status, 303);
  assert.equal((await b2.get('/')).headers.get('location'), '/login');
});

test('blokada konta po serii błędnych haseł; dobre hasło w czasie blokady też jest odrzucane', async () => {
  reset();
  await readyUser('blok@example.pl');
  const b = new Browser();
  for (let i = 0; i < LIMITS.maxFailedLogins; i += 1) assert.equal((await b.post('/login/external', { email: 'blok@example.pl', password: 'zle zle zle zle zle' })).status, 401);
  assert.equal((await b.post('/login/external', { email: 'blok@example.pl', password: PASSWORD })).status, 401);
  assert.equal(szo.sms.length, 0);
  db.exec(`UPDATE users SET locked_until = datetime('now', '-1 minutes') WHERE email = 'blok@example.pl'`);
  assert.equal((await b.post('/login/external', { email: 'blok@example.pl', password: PASSWORD })).status, 303);
});

test('awaria wysyłki SMS: logowanie nie przechodzi dalej, a wyzwanie nie zostaje w bazie', async () => {
  reset();
  await readyUser('awaria@example.pl');
  szo.failSms = true;
  const b = new Browser();
  const res = await b.post('/login/external', { email: 'awaria@example.pl', password: PASSWORD });
  assert.equal(res.status, 503);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM login_challenges WHERE user_id = (SELECT id FROM users WHERE email = ?)').get('awaria@example.pl').n, 0);
  assert.equal((await b.get('/login/verify')).status, 303);
});

test('konto nieaktywne nie loguje się; sesja wyłączonego konta przestaje działać', async () => {
  reset();
  const id = await readyUser('off@example.pl');
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
  assert.equal((await new Browser().post('/login/external', { email: 'off@example.pl', password: PASSWORD })).status, 401);
  assert.equal(szo.sms.length, 0);
});

test('administrator: ponowny link unieważnia poprzedni, zmiana numeru, brak ról dodatkowych dla kont zewnętrznych', async () => {
  reset();
  const id = await createExternal('admin-akcje@example.pl');
  const first = tokenFromMail();
  const admin = await adminBrowser();
  mailbox.sent.length = 0;
  assert.equal((await admin.post(`/users/${id}/external/link`)).status, 303);
  await services.notifier.processOutbox();
  assert.equal(mailbox.sent.length, 1);
  assert.match(mailbox.sent[0].subject, /Nowy link/);
  assert.equal(services.externalAuth.userForToken(first), null, 'stary link nie działa');
  await admin.post(`/users/${id}/external/phone`, { phone: '700 800 900' });
  assert.equal(services.users.findById(id).phone, '+48700800900');
  await admin.post(`/users/${id}/external/phone`, { phone: 'xyz' });
  assert.equal(services.users.findById(id).phone, '+48700800900');
  await admin.post(`/users/${id}`, { coordinator: 'on', active: 'on' });
  assert.deepEqual(services.users.findById(id).roles, ['auditor']);
  // konto z SZO nie ma akcji „link do hasła”
  const szoUser = services.users.upsertFromIdentity({ externalId: 'szo:zwykly', name: 'Zwykły', email: 'z@feer.org.pl', role: null });
  assert.equal((await admin.post(`/users/${szoUser.id}/external/link`)).status, 404);
  // widok listy
  const html = await (await admin.get('/users')).text();
  assert.match(html, /Zewnętrzne \(hasło \+ SMS\)/);
  assert.ok(!html.includes('+48700800900'), 'numer na liście jest zamaskowany');
});

test('ekran logowania pokazuje formularz konta zewnętrznego tylko przy włączonym SMS', async () => {
  const html = await (await new Browser().get('/login')).text();
  assert.match(html, /<a class="tile" href="\/login\?metoda=zewnetrzne#ext-login"><strong>Konto zewnętrzne<\/strong>/);
  assert.ok(!html.includes('action="/login/external"'), 'formularz pojawia się dopiero po wyborze kafelka');
  const chosen = await (await new Browser().get('/login?metoda=zewnetrzne')).text();
  assert.match(chosen, /action="\/login\/external"/);
  assert.match(chosen, /<h1 id="ext-login">Logowanie kontem zewnętrznym<\/h1>/);
  assert.match(chosen, /Krok 1 z 2/);
  assert.match(chosen, /href="\/login">Wróć do wyboru sposobu logowania/);
  assert.ok(!chosen.includes('class="tile"'), 'na ekranie logowania zewnętrznego nie ma kafelków wyboru');
  const off = createApp(loadConfig({ ...baseEnv, SMS_MODE: 'off' }), { mailer: mailbox });
  const s = await new Promise((r) => { const x = off.app.listen(0, '127.0.0.1', () => r(x)); });
  const page = await (await fetch(`http://127.0.0.1:${s.address().port}/login`)).text();
  assert.ok(!page.includes('/login/external'));
  assert.equal((await fetch(`http://127.0.0.1:${s.address().port}/ext/set-password?token=x`)).status, 400);
  const post = await fetch(`http://127.0.0.1:${s.address().port}/login/external`, { method: 'POST', body: new URLSearchParams({ email: 'a@b.pl', password: 'x' }), redirect: 'manual' });
  assert.equal(post.status, 303);
  s.close();
});

const codeFrom = async (res) => /<span aria-hidden="true">(\d{7})<\/span>/.exec(await res.text())?.[1];

test('rejestracja kodem: administrator generuje 7-cyfrowy kod (widoczny raz, w bazie tylko skrót), osoba zakłada konto i loguje się z SMS', async () => {
  reset();
  const admin = await adminBrowser();
  const res = await admin.post('/users/invitations', { email: 'Nowa.Osoba@Example.pl', name: 'Nowa Osoba' });
  assert.equal(res.status, 200);
  const code = await codeFrom(res);
  assert.match(code, /^\d{7}$/);
  const row = db.prepare(`SELECT * FROM registration_codes WHERE email = 'nowa.osoba@example.pl'`).get();
  assert.ok(row && row.code_hash.length === 64 && !row.code_hash.includes(code), 'w bazie jest skrót, nie kod');
  assert.equal(JSON.stringify(row).includes(code), false);
  // lista zaproszeń nie ujawnia kodu
  assert.ok(!(await (await admin.get('/users')).text()).includes(code));

  const b = new Browser();
  assert.match(await (await b.get('/register')).text(), /Załóż konto kodem/);
  assert.match(await (await b.get('/login')).text(), /href="\/register"/);
  const base = { email: 'nowa.osoba@example.pl', name: 'Nowa Osoba', phone: '601 111 222', password: PASSWORD, repeat: PASSWORD };
  // słabe hasło: kod nie jest zużyty
  assert.equal((await b.post('/register', { ...base, code, password: 'krotkie', repeat: 'krotkie' })).status, 422);
  assert.equal(db.prepare('SELECT used_at FROM registration_codes WHERE id = ?').get(row.id).used_at, null);
  assert.equal((await b.post('/register', { ...base, code })).status, 303);
  const user = db.prepare(`SELECT * FROM users WHERE email = 'nowa.osoba@example.pl'`).get();
  assert.equal(user.kind, 'external');
  assert.equal(user.phone, '+48601111222');
  assert.ok(user.password_hash && !user.password_hash.includes(PASSWORD));
  assert.deepEqual(services.users.findById(user.id).roles, ['auditor']);
  // kod jednorazowy
  assert.equal((await b.post('/register', { ...base, code, email: 'nowa.osoba@example.pl' })).status, 401);

  // logowanie: hasło + SMS
  const login = await b.post('/login/external', { email: 'nowa.osoba@example.pl', password: PASSWORD });
  assert.equal(login.status, 303);
  assert.equal(szo.sms.at(-1).phone, '+48601111222');
  assert.equal((await b.post('/login/verify', { code: lastCode() })).status, 303);
  assert.equal((await b.get('/')).status, 200);
});

test('rejestracja kodem: zły kod, cudzy adres, 5 prób, wygaśnięcie i unieważnienie dają tę samą odpowiedź; tylko administrator; zajęty adres', async () => {
  reset();
  const admin = await adminBrowser();
  const code = await codeFrom(await admin.post('/users/invitations', { email: 'proby2@example.pl' }));
  const b = new Browser();
  const body = (o) => ({ code, email: 'proby2@example.pl', name: 'Jan Próby', phone: '602000000', password: PASSWORD, repeat: PASSWORD, ...o });
  const wrong = code === '1234567' ? '7654321' : '1234567';
  const r1 = await b.post('/register', body({ code: wrong }));
  const r2 = await b.post('/register', body({ email: 'nieznany@example.pl' }));
  assert.equal(r1.status, 401); assert.equal(r2.status, 401);
  const strip = (h) => h.replace(/value="[^"]*"/g, '');
  assert.equal(strip(await r1.text()), strip(await r2.text()), 'jednakowa odpowiedź');
  for (let i = 0; i < 3; i += 1) await b.post('/register', body({ code: wrong }));   // razem 4 błędne
  assert.equal((await b.post('/register', body({ code: wrong }))).status, 401);       // 5. błędna
  assert.equal((await b.post('/register', body({}))).status, 401, 'po 5 próbach nawet dobry kod nie działa');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM users WHERE email = 'proby2@example.pl'`).get().n, 0);

  // wygaśnięcie i unieważnienie
  const c2 = await codeFrom(await admin.post('/users/invitations', { email: 'proby2@example.pl' }));
  db.exec(`UPDATE registration_codes SET expires_at = datetime('now', '-1 minutes') WHERE used_at IS NULL`);
  assert.equal((await b.post('/register', body({ code: c2 }))).status, 401);
  const c3 = await codeFrom(await admin.post('/users/invitations', { email: 'proby2@example.pl' }));
  const id = db.prepare(`SELECT id FROM registration_codes WHERE used_at IS NULL`).get().id;
  await admin.post(`/users/invitations/${id}/revoke`);
  assert.equal((await b.post('/register', body({ code: c3 }))).status, 401);

  // uprawnienia i zajęty adres
  assert.notEqual((await new Browser().post('/users/invitations', { email: 'x@example.pl' })).status, 200);
  await admin.post('/users/invitations', { email: 'bad' });
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM registration_codes WHERE email = 'bad'`).get().n, 0);
  await createExternal('zajety@example.pl');
  await admin.post('/users/invitations', { email: 'zajety@example.pl' });
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM registration_codes WHERE email = 'zajety@example.pl'`).get().n, 0);
});

test('rejestracja kodem jest niedostępna przy wyłączonym SMS', async () => {
  const off = createApp(loadConfig({ ...baseEnv, SMS_MODE: 'off' }), { mailer: mailbox });
  const s = await new Promise((r) => { const x = off.app.listen(0, '127.0.0.1', () => r(x)); });
  const root = `http://127.0.0.1:${s.address().port}`;
  const get = await fetch(`${root}/register`, { redirect: 'manual' });
  assert.equal(get.status, 303);
  assert.equal(get.headers.get('location'), '/login');
  s.close();
});
