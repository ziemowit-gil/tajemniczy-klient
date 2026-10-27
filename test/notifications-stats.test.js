const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignJWT } = require('jose');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { seedCatalog } = require('../src/db/seed');
const { MAX_ATTEMPTS } = require('../src/services/notifications');

const SECRET = 'szo-test-secret-szo-test-secret-1234';
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-ns-'));
const config = loadConfig({
  NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir,
  SESSION_SECRET: 'session-secret-session-secret-session-secret',
  SZO_AUTH_MODE: 'jwt', SZO_JWT_SECRET: SECRET, SZO_ROLE_MAP: JSON.stringify({ a: 'administrator', u: 'auditor', k: 'coordinator' }),
  MAIL_MODE: 'log', APP_URL: 'https://audytor.example.pl', MAIL_AUTOFLUSH: 'false', MAIL_REMINDER_DAYS: '3',
});

/** Atrapa wysyłki: zapisuje wiadomości i pozwala wymusić błędy. */
const mailbox = { sent: [], failures: 0, async send(msg) { if (this.failures > 0) { this.failures -= 1; throw new Error('SMTP niedostępny'); } this.sent.push(msg); } };
const { app, db, services } = createApp(config, { mailer: mailbox });
seedCatalog(db);

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

const key = new TextEncoder().encode(SECRET);
class Client {
  constructor() { this.jar = new Map(); }
  async req(method, url, data) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const body = data instanceof FormData ? data : data ? new URLSearchParams(data) : undefined;
    const res = await fetch(base + url, { method, body, headers: cookie ? { cookie } : {}, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) { const [p] = line.split(';'); const i = p.indexOf('='); this.jar.set(p.slice(0, i), p.slice(i + 1)); }
    return res;
  }
  get(u) { return this.req('GET', u); }
  post(u, d) { return this.req('POST', u, d ?? []); }
  async login(sub, role, email = `${sub}@example.pl`) {
    const t = await new SignJWT({ name: sub, role, ...(email ? { email } : {}) }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('5m').sign(key);
    await this.get(`/auth/callback?token=${t}`);
    return this;
  }
}
const uid = (ext) => db.prepare('SELECT id FROM users WHERE external_id = ?').get(ext).id;
const idFrom = (res, re) => Number(re.exec(res.headers.get('location'))[1]);
const resetMail = () => { mailbox.sent.length = 0; mailbox.failures = 0; db.exec('DELETE FROM notifications'); };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const BOTH = () => db.prepare(`SELECT id FROM scenarios WHERE title = 'Pełna ocena dostępności obiektu'`).get().id;

async function fillAndSubmit(client, auditId, intent = 'submit') {
  const form = new FormData();
  form.set('intent', intent);
  for (const it of services.audits.items(auditId)) form.set(`answer_${it.id}`, it.answer_type === 'scale' ? '3' : 'tak');
  return client.req('POST', `/audits/${auditId}`, form);
}

test('powiadomienia: przydział audytu → kolejka → wysyłka czystym tekstem z odnośnikiem', async () => {
  const adm = await new Client().login('adm', 'a');
  await new Client().login('aud', 'u');
  await new Client().login('koord', 'k');
  resetMail();
  const uni = services.objects.create({ name: 'Uczelnia\nNagłówek: wstrzyknięty', type: 'uczelnia', parentId: null, address: null, coordinatorId: uid('koord'), notes: null });

  const res = await adm.post('/audits', [['objectId', uni.id], ['auditorId', uid('aud')], ['scenarioIds', BOTH()], ['dueDate', '2026-12-31']]);
  const auditId = idFrom(res, /\/audits\/(\d+)/);

  assert.equal(mailbox.sent.length, 0, 'wysyłka dopiero po przetworzeniu kolejki');
  const queued = db.prepare('SELECT * FROM notifications').all();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].to_email, 'aud@example.pl');
  assert.equal(queued[0].status, 'pending');

  const stats = await services.notifier.processOutbox();
  assert.equal(stats.sent, 1);
  const mail = mailbox.sent[0];
  assert.deepEqual(Object.keys(mail).sort(), ['subject', 'text', 'to'], 'wyłącznie czysty tekst: brak pola html');
  assert.equal(mail.to, 'aud@example.pl');
  assert.match(mail.subject, /^\[Tajemniczy Klient\] Przydzielono Ci audyt/);
  assert.doesNotMatch(mail.subject, /[\r\n]/, 'brak znaków nowej linii w temacie');
  assert.match(mail.text, new RegExp(`https://audytor.example.pl/audits/${auditId}`));
  assert.match(mail.text, /Termin wykonania: 2026-12-31/);
  assert.match(mail.text, /https:\/\/audytor.example.pl\/account/);
  assert.doesNotMatch(mail.text, /<[a-z][^>]*>/i, 'brak znaczników HTML');
  assert.equal(db.prepare('SELECT status FROM notifications').get().status, 'sent');
});

test('powiadomienia: złożenie → koordynator, zatwierdzenie i zwrot → audytor; historia zdarzeń', async () => {
  const adm = await new Client().login('adm', 'a');
  const aud = await new Client().login('aud', 'u');
  const coord = await new Client().login('koord', 'k');
  resetMail();
  const uni = services.objects.create({ name: 'Uczelnia Przepływ', type: 'uczelnia', parentId: null, address: null, coordinatorId: uid('koord'), notes: null });
  const faculty = services.objects.create({ name: 'Wydział Przepływ', type: 'wydzial', parentId: uni.id, address: null, coordinatorId: null, notes: null });

  const auditId = idFrom(await adm.post('/audits', [['objectId', faculty.id], ['auditorId', uid('aud')], ['scenarioIds', BOTH()]]), /\/audits\/(\d+)/);
  await services.notifier.processOutbox();
  mailbox.sent.length = 0;

  await fillAndSubmit(aud, auditId, 'save');
  await fillAndSubmit(aud, auditId, 'submit');
  await services.notifier.processOutbox();
  assert.equal(mailbox.sent.length, 1);
  assert.equal(mailbox.sent[0].to, 'koord@example.pl', 'koordynator uczelni (obiekt nadrzędny) dostaje powiadomienie');
  assert.match(mailbox.sent[0].subject, /czeka na weryfikację/);

  await coord.post(`/audits/${auditId}/return`, [['comment', 'Dodaj zdjęcia wejścia']]);
  await services.notifier.processOutbox();
  const returned = mailbox.sent.at(-1);
  assert.equal(returned.to, 'aud@example.pl');
  assert.match(returned.text, /Dodaj zdjęcia wejścia/);

  await aud.post(`/audits/${auditId}`, [['intent', 'submit']]);
  await coord.post(`/audits/${auditId}/approve`, [['comment', 'Zgodne']]);
  await services.notifier.processOutbox();
  assert.match(mailbox.sent.at(-1).subject, /Audyt zatwierdzony/);
  assert.match(mailbox.sent.at(-1).text, /Komentarz koordynatora: Zgodne/);

  // historia: pełna ścieżka z wykonawcami i komentarzami
  const events = services.history.list('audit', auditId);
  assert.deepEqual(events.map((e) => e.action), ['assigned', 'started', 'submitted', 'returned', 'submitted', 'approved']);
  assert.equal(events[0].actor_name, 'adm');
  assert.equal(events[3].actor_name, 'koord');
  assert.equal(events[3].note, 'Dodaj zdjęcia wejścia');
  const html = await (await aud.get(`/audits/${auditId}`)).text();
  assert.match(html, /Historia zmian/);
  assert.match(html, /Zwrócono do poprawy/);
  assert.match(html, /Dodaj zdjęcia wejścia/);
});

test('powiadomienia: brak koordynatora → administratorzy; opt-out, brak e-maila i konto nieaktywne są pomijane', async () => {
  const adm = await new Client().login('adm', 'a');
  const aud = await new Client().login('aud', 'u');
  await new Client().login('bezmaila', 'u', null);
  resetMail();
  const obj = services.objects.create({ name: 'Obiekt Bez Koordynatora', type: 'budynek', parentId: null, address: null, coordinatorId: null, notes: null });
  const auditId = idFrom(await adm.post('/audits', [['objectId', obj.id], ['auditorId', uid('aud')], ['scenarioIds', BOTH()]]), /\/audits\/(\d+)/);
  await services.notifier.processOutbox();
  mailbox.sent.length = 0;
  await fillAndSubmit(aud, auditId);
  await services.notifier.processOutbox();
  assert.deepEqual(mailbox.sent.map((m) => m.to), ['adm@example.pl'], 'fallback do administratora');

  // opt-out w ustawieniach konta
  assert.match(await (await aud.get('/account')).text(), /Powiadomienia e-mail/);
  await aud.post('/account', []);   // brak zaznaczenia = wyłączone
  assert.equal(services.users.findById(uid('aud')).notify_email, 0);
  resetMail();
  services.notifier.auditApproved({ ...services.audits.get(auditId) }, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 0, 'opt-out');
  await aud.post('/account', [['notifyEmail', 'on']]);
  assert.equal(services.users.findById(uid('aud')).notify_email, 1);

  // użytkownik bez adresu i nieaktywny
  services.notifier.auditApproved({ ...services.audits.get(auditId), auditor_id: uid('bezmaila') }, null);
  services.users.update(uid('aud'), { role: 'auditor', active: false });
  services.notifier.auditApproved(services.audits.get(auditId), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 0);
  services.users.update(uid('aud'), { role: 'auditor', active: true });
});

test('kolejka: błędy SMTP są ponawiane z opóźnieniem, po limicie prób status „failed”, jedna wysyłka przy wyścigu', async () => {
  resetMail();
  const user = services.users.findById(uid('aud'));
  db.prepare(`INSERT INTO notifications (user_id, to_email, subject, body, event) VALUES (?, ?, 'T', 'Treść', 'test')`).run(user.id, user.email);

  mailbox.failures = 1;
  let r = await services.notifier.processOutbox();
  assert.equal(r.retried, 1);
  let n = db.prepare('SELECT * FROM notifications').get();
  assert.equal(n.status, 'pending');
  assert.equal(n.attempts, 1);
  assert.match(n.last_error, /SMTP niedostępny/);
  r = await services.notifier.processOutbox();
  assert.equal(r.sent, 0, 'przed upływem opóźnienia nie ponawia');

  db.exec(`UPDATE notifications SET next_attempt_at = datetime('now', '-1 minute')`);
  r = await services.notifier.processOutbox();
  assert.equal(r.sent, 1);
  assert.equal(db.prepare('SELECT status FROM notifications').get().status, 'sent');

  // trwała awaria → failed po MAX_ATTEMPTS
  db.exec('DELETE FROM notifications');
  db.prepare(`INSERT INTO notifications (user_id, to_email, subject, body, event) VALUES (?, ?, 'T', 'Treść', 'test')`).run(user.id, user.email);
  mailbox.failures = 99;
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    await services.notifier.processOutbox();
    db.exec(`UPDATE notifications SET next_attempt_at = datetime('now', '-1 minute') WHERE status = 'pending'`);
  }
  n = db.prepare('SELECT * FROM notifications').get();
  assert.equal(n.status, 'failed');
  assert.equal(n.attempts, MAX_ATTEMPTS);
  mailbox.failures = 0;

  // równoległe procesy nie wysyłają tej samej wiadomości dwa razy
  resetMail();
  for (let i = 0; i < 6; i += 1) db.prepare(`INSERT INTO notifications (user_id, to_email, subject, body, event) VALUES (?, ?, 'T', 'Treść', 'test')`).run(user.id, user.email);
  await Promise.all([services.notifier.processOutbox(), services.notifier.processOutbox(), services.notifier.processOutbox()]);
  assert.equal(mailbox.sent.length, 6);

  // osierocone „sending” po awarii procesu wraca do kolejki
  resetMail();
  db.prepare(`INSERT INTO notifications (user_id, to_email, subject, body, event, status, claimed_at, attempts) VALUES (?, ?, 'T', 'Treść', 'test', 'sending', datetime('now', '-30 minutes'), 1)`).run(user.id, user.email);
  assert.equal((await services.notifier.processOutbox()).sent, 1);
});

test('przypomnienia o terminach: raz na rodzaj, tylko dla audytów w toku', async () => {
  const adm = await new Client().login('adm', 'a');
  resetMail();
  const obj = services.objects.create({ name: 'Obiekt Terminy', type: 'budynek', parentId: null, address: null, coordinatorId: null, notes: null });
  const mk = async (due) => idFrom(await adm.post('/audits', [['objectId', obj.id], ['auditorId', uid('aud')], ['scenarioIds', BOTH()], ['dueDate', due]]), /\/audits\/(\d+)/);
  const soon = await mk('2026-11-12'); const today = await mk('2026-11-10'); const late = await mk('2026-11-01'); await mk('2026-12-24');
  resetMail(); // pomija powiadomienia o przydziale
  const now = new Date('2026-11-10T09:00:00Z');

  assert.equal(services.notifier.sendDueReminders(now), 3, 'za 2 dni, dziś i po terminie; termin za 44 dni pominięty');
  assert.equal(services.notifier.sendDueReminders(now), 0, 'idempotentne');
  await services.notifier.processOutbox();
  const subjects = mailbox.sent.map((m) => m.subject).join('|');
  assert.match(subjects, /Zbliża się termin audytu/);
  assert.match(subjects, /Dziś mija termin audytu/);
  assert.match(subjects, /Audyt po terminie/);
  assert.match(mailbox.sent.find((m) => /Zbliża/.test(m.subject)).text, /Za 2 dni \(2026-11-12\)/);
  // następnego dnia audyt, którego termin minął wczoraj, dostaje przypomnienie „po terminie” (nowy rodzaj), reszta bez zmian
  assert.equal(services.notifier.sendDueReminders(new Date('2026-11-11T09:00:00Z')), 1);

  // audyty złożone nie dostają przypomnień
  db.prepare(`UPDATE audits SET status = 'submitted' WHERE id IN (?, ?, ?)`).run(soon, today, late);
  resetMail();
  assert.equal(services.notifier.sendDueReminders(new Date('2026-11-20T09:00:00Z')), 0);
});

test('tryb MAIL_MODE=off: powiadomienia nie są kolejkowane', async () => {
  const offConfig = loadConfig({
    NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir, SESSION_SECRET: 'session-secret-session-secret-session-secret',
    SZO_AUTH_MODE: 'dev', MAIL_MODE: 'off',
  });
  const off = createApp(offConfig, { mailer: mailbox });
  const u = off.services.users.upsertFromIdentity({ externalId: 'x', name: 'X', email: 'x@example.pl', role: 'auditor' });
  assert.equal(off.services.notifier.enabled, false);
  off.services.notifier.auditApproved({ id: 1, auditor_id: u.id, object_name: 'O' }, null);
  assert.equal(off.db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 0);
  assert.deepEqual(await off.services.notifier.processOutbox(), { sent: 0, failed: 0, retried: 0 });
});

test('załączniki w ocenach kształcenia: dodawanie, kontrola sygnatury, dostęp, usuwanie i historia', async () => {
  const adm = await new Client().login('adm', 'a');
  const aud = await new Client().login('aud', 'u');
  const other = await new Client().login('aud2', 'u');
  const coord = await new Client().login('koord', 'k');
  const uni = services.objects.create({ name: 'Uczelnia Załączniki', type: 'uczelnia', parentId: null, address: null, coordinatorId: uid('koord'), notes: null });
  const rid = idFrom(await aud.post('/office', [['objectId', uni.id], ['programme', 'Prawo'], ['studyLevel', 'jednolite'], ['studyMode', 'stacjonarne'], ['disability', 'wzroku']]), /\/office\/(\d+)/);
  const item = services.office.items(rid)[0];

  assert.match(await (await aud.get(`/office/${rid}`)).text(), /type="file"/);

  const form = new FormData();
  form.set('intent', 'save');
  form.set(`answer_${item.id}`, '3');
  form.append(`files_${item.id}`, new Blob([PNG], { type: 'image/png' }), 'odpowiedź biura.png');
  form.append(`files_${item.id}`, new Blob(['nie obraz'], { type: 'image/png' }), 'falsz.png');
  const res = await aud.req('POST', `/office/${rid}`, form);
  assert.equal(res.status, 303);

  // niedozwolony typ pliku odrzuca cały zapis (nic się nie zapisuje), z komunikatem
  const badType = new FormData();
  badType.set('intent', 'save');
  badType.set(`answer_${item.id}`, '0');
  badType.append(`files_${item.id}`, new Blob(['x'], { type: 'text/plain' }), 'plik.txt');
  const rejected = await aud.req('POST', `/office/${rid}`, badType);
  assert.equal(rejected.status, 303);
  assert.equal(services.office.items(rid)[0].answer, '3', 'odpowiedź bez zmian po odrzuconym zapisie');
  assert.match(decodeURIComponent((aud.jar.get('tk_flash') || '').replace(/\+/g, ' ')), /Dozwolone załączniki/);

  const files = db.prepare('SELECT * FROM office_attachments').all();
  assert.equal(files.length, 1, 'tylko prawdziwy obraz zapisany');
  assert.equal(files[0].original_name, 'odpowiedź biura.png');
  assert.equal(fs.readdirSync(uploadDir).filter((f) => f.endsWith('.png')).length >= 1, true);
  assert.match(await (await aud.get(`/office/${rid}`)).text(), /odpowiedź biura\.png/);

  // dostęp do pliku
  assert.equal((await aud.get(`/office/${rid}/attachments/${files[0].id}`)).status, 200);
  assert.equal((await coord.get(`/office/${rid}/attachments/${files[0].id}`)).status, 200);
  assert.equal((await adm.get(`/office/${rid}/attachments/${files[0].id}`)).status, 200);
  assert.equal((await other.get(`/office/${rid}/attachments/${files[0].id}`)).status, 404);
  assert.equal((await other.post(`/office/${rid}/attachments/${files[0].id}/delete`)).status, 404);
  assert.equal((await coord.post(`/office/${rid}/attachments/${files[0].id}/delete`)).status, 403);

  // plik z cudzego pytania nie zostanie przypisany
  const foreign = new FormData();
  foreign.set('intent', 'save');
  foreign.append('files_999999', new Blob([PNG], { type: 'image/png' }), 'obcy.png');
  await aud.req('POST', `/office/${rid}`, foreign);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM office_attachments').get().n, 1);

  // usuwanie przez autora
  await aud.post(`/office/${rid}/attachments/${files[0].id}/delete`);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM office_attachments').get().n, 0);
  assert.equal(fs.existsSync(path.join(uploadDir, files[0].stored_name)), false, 'plik usunięty z dysku');

  // usunięcie oceny kasuje pliki
  const again = new FormData();
  again.set('intent', 'save');
  again.append(`files_${item.id}`, new Blob([PNG], { type: 'image/png' }), 'drugi.png');
  await aud.req('POST', `/office/${rid}`, again);
  const stored = db.prepare('SELECT stored_name FROM office_attachments').get().stored_name;
  assert.equal(fs.existsSync(path.join(uploadDir, stored)), true);
  await aud.post(`/office/${rid}/delete`);
  assert.equal(fs.existsSync(path.join(uploadDir, stored)), false, 'pliki oceny usunięte razem z nią');

  const events = services.history.list('review', rid).map((e) => e.action);
  assert.deepEqual(events, ['created', 'attachment_added', 'attachment_removed', 'attachment_added']);
});

test('ocena kształcenia: powiadomienia i historia (przydział, scenariusze, złożenie, zatwierdzenie)', async () => {
  const adm = await new Client().login('adm', 'a');
  const aud = await new Client().login('aud', 'u');
  const coord = await new Client().login('koord', 'k');
  resetMail();
  const uni = services.objects.create({ name: 'Uczelnia Powiadomień', type: 'uczelnia', parentId: null, address: null, coordinatorId: uid('koord'), notes: null });
  const e1 = services.catalog.scenarios.list({ usage: 'education' })[0];

  const rid = idFrom(await adm.post('/office', [['objectId', uni.id], ['auditorId', uid('aud')], ['programme', 'Chemia'], ['studyLevel', 'I'], ['studyMode', 'stacjonarne'], ['disability', 'sluchu'], ['scenarioIds', e1.id]]), /\/office\/(\d+)/);
  await adm.post(`/office/${rid}/scenarios`, [['scenarioIds', e1.id], ['scenarioIds', services.catalog.scenarios.list({ usage: 'education' })[1].id]]);
  await services.notifier.processOutbox();
  assert.deepEqual(mailbox.sent.map((m) => m.subject.replace(/^\[Tajemniczy Klient\] /, '').split(':')[0]), ['Przydzielono Ci ocenę', 'Zmieniono scenariusze oceny']);

  mailbox.sent.length = 0;
  const form = { intent: 'submit' };
  for (const it of services.office.items(rid)) form[`answer_${it.id}`] = it.answer_type === 'scale' ? '2' : 'tak';
  await aud.post(`/office/${rid}`, Object.entries(form));
  await coord.post(`/office/${rid}/approve`, [['comment', 'OK']]);
  await services.notifier.processOutbox();
  assert.deepEqual(mailbox.sent.map((m) => m.to), ['koord@example.pl', 'aud@example.pl']);
  assert.match(mailbox.sent[0].text, new RegExp(`/office/${rid}`));
  assert.deepEqual(services.history.list('review', rid).map((e) => e.action), ['created', 'scenarios_changed', 'submitted', 'approved']);
});

test('statystyki: ranking z miejscami ex aequo, trend kwartalny ze zmianą, zakres koordynatora i CSV', async () => {
  const adm = await new Client().login('adm', 'a');
  const aud = await new Client().login('aud', 'u');
  const coordA = await new Client().login('koordA', 'k');
  const coordB = await new Client().login('koordB', 'k');
  db.exec(`DELETE FROM audits; DELETE FROM office_reviews; UPDATE objects SET parent_id = NULL; DELETE FROM objects;`);
  const mkUni = (name, coordinator) => services.objects.create({ name, type: 'uczelnia', parentId: null, address: null, coordinatorId: coordinator ? uid(coordinator) : null, notes: null });
  const alfa = mkUni('Alfa', 'koordA'); const beta = mkUni('Beta', 'koordB'); const gamma = mkUni('Gamma', 'koordA'); mkUni('Delta', null);

  const approved = (obj, answer, approvedAt) => {
    const a = services.audits.create({ objectId: obj.id, auditorId: uid('aud'), scenarioIds: [BOTH()], dueDate: null }, uid('adm'));
    for (const it of services.audits.items(a.id)) db.prepare('UPDATE audit_items SET answer = ? WHERE id = ?').run(it.answer_type === 'scale' ? answer.scale : answer.ternary, it.id);
    db.prepare(`UPDATE audits SET status = 'approved', approved_at = ? WHERE id = ?`).run(approvedAt, a.id);
    return a;
  };
  const best = { scale: '3', ternary: 'tak' }; const mid = { scale: '2', ternary: 'czesciowo' };
  approved(alfa, best, '2026-02-10 10:00:00');   // Q1 100%
  approved(alfa, mid, '2026-05-10 10:00:00');    // Q2 niższy
  approved(beta, best, '2026-05-11 10:00:00');
  approved(gamma, best, '2026-05-12 10:00:00');

  // ocena kształcenia dla Alfa (Q2)
  const r = services.office.create({ objectId: alfa.id, programme: 'Fizyka', studyLevel: 'I', studyMode: 'stacjonarne', disability: 'ruchowa', scenarioIds: [] }, uid('aud'));
  for (const it of services.office.items(r.id)) db.prepare('UPDATE office_review_items SET answer = ? WHERE id = ?').run(it.answer_type === 'scale' ? '3' : 'tak', it.id);
  db.prepare(`UPDATE office_reviews SET status = 'approved', approved_at = '2026-05-20 10:00:00' WHERE id = ?`).run(r.id);

  const ranking = services.stats.ranking({ id: uid('adm'), role: 'administrator' });
  assert.deepEqual(ranking.map((x) => [x.name, x.rank]), [['Beta', 1], ['Gamma', 1], ['Alfa', 3], ['Delta', null]], 'ex aequo: 1, 1, 3; bez wyników na końcu');
  const alfaRow = ranking.find((x) => x.name === 'Alfa');
  assert.equal(alfaRow.audits.count, 2);
  assert.ok(alfaRow.audits.total < 100 && alfaRow.audits.total > 80);
  assert.equal(alfaRow.education.percent, 100);
  assert.equal(alfaRow.education.count, 1);

  const trend = services.stats.trend({ id: uid('adm'), role: 'administrator' }).find((t) => t.name === 'Alfa');
  assert.deepEqual(trend.periods.map((p) => p.period), ['2026-Q1', '2026-Q2']);
  assert.equal(trend.periods[0].audits.total, 100);
  assert.equal(trend.periods[0].change.audits, null);
  assert.ok(trend.periods[1].change.audits < 0, 'spadek względem Q1');
  assert.equal(trend.periods[1].education.percent, 100);

  // zakres koordynatora: koordA widzi tylko Alfa i Gamma
  const scope = services.stats.ranking({ id: uid('koordA'), role: 'coordinator' }).map((x) => x.name).sort();
  assert.deepEqual(scope, ['Alfa', 'Gamma']);

  // strona i CSV
  assert.equal((await aud.get('/stats')).status, 403);
  const html = await (await coordA.get('/stats')).text();
  assert.match(html, /Ranking obiektów/);
  assert.match(html, /2026-Q2/);
  assert.doesNotMatch(html, /Beta/);
  const csv = Buffer.from(await (await adm.get('/stats/ranking.csv')).arrayBuffer());
  assert.deepEqual([...csv.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(csv.toString('utf8'), /1;Beta;1;100%/);
  const trendCsv = (await (await adm.get('/stats/trend.csv')).text());
  assert.match(trendCsv, /Alfa;2026-Q2;/);
  assert.equal((await aud.get('/stats/ranking.csv')).status, 403);
  void coordB;
});

test('migracja 005: historia uzupełniona dla audytów i ocen sprzed migracji', () => {
  const { DatabaseSync } = require('node:sqlite');
  const { migrate } = require('../src/db');
  const dir = path.join(__dirname, '../src/db/migrations');
  const old = new DatabaseSync(':memory:');
  old.exec('PRAGMA foreign_keys = ON');
  old.exec(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  for (const f of ['001_init.sql', '002_office_reviews.sql', '003_multiple_scenarios.sql', '004_scenario_details.sql']) {
    old.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    old.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(f);
  }
  old.exec(`INSERT INTO users (external_id, name, role) VALUES ('adm', 'Admin', 'administrator'), ('aud', 'Audytor', 'auditor'), ('k', 'Koord', 'coordinator');
    INSERT INTO objects (name, type) VALUES ('Uczelnia', 'uczelnia');
    INSERT INTO scenarios (title, areas) VALUES ('S', 'OZN');
    INSERT INTO audits (object_id, auditor_id, scenario_id, assigned_by, reviewer_id, status, created_at, submitted_at, approved_at, review_comment)
      VALUES (1, 2, 1, 1, 3, 'approved', '2026-01-01 10:00:00', '2026-01-05 10:00:00', '2026-01-06 10:00:00', 'Ok');
    INSERT INTO audits (object_id, auditor_id, scenario_id, assigned_by, status, created_at) VALUES (1, 2, 1, 1, 'assigned', '2026-02-01 10:00:00');
    INSERT INTO office_reviews (object_id, auditor_id, programme, study_level, study_mode, disability, status, created_at)
      VALUES (1, 2, 'Prawo', 'I', 'stacjonarne', 'ruchowa', 'in_progress', '2026-03-01 10:00:00');`);
  migrate(old);

  const rows = (type, id) => old.prepare('SELECT action, actor_name, note, created_at FROM history_events WHERE entity_type = ? AND entity_id = ? ORDER BY id').all(type, id).map((r) => ({ ...r }));
  assert.deepEqual(rows('audit', 1), [
    { action: 'assigned', actor_name: 'Admin', note: null, created_at: '2026-01-01 10:00:00' },
    { action: 'submitted', actor_name: 'Audytor', note: null, created_at: '2026-01-05 10:00:00' },
    { action: 'approved', actor_name: 'Koord', note: 'Ok', created_at: '2026-01-06 10:00:00' },
  ]);
  assert.deepEqual(rows('audit', 2).map((r) => r.action), ['assigned']);
  assert.deepEqual(rows('review', 1).map((r) => r.action), ['created']);
  assert.equal(old.prepare('SELECT notify_email FROM users WHERE id = 1').get().notify_email, 1, 'powiadomienia domyślnie włączone');
});
