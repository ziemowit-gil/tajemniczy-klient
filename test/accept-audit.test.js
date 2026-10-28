const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { seedCatalog } = require('../src/db/seed');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-accept-'));
const config = loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir, SESSION_SECRET: 'session-secret-session-secret-session-secret', SZO_AUTH_MODE: 'dev' });
const { app, db, services } = createApp(config);
seedCatalog(db);
let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

async function as(user, role) {
  let cookie = '';
  await services.sessions.issue({ cookie: (n, v) => { cookie = `${n}=${v}`; } }, user.id, role);
  return (method, url, data) => fetch(base + url, { method, headers: { cookie }, body: data ? new URLSearchParams(data) : undefined, redirect: 'manual' });
}
const mk = (ext, name, role, email = null) => services.users.upsertFromIdentity({ externalId: ext, name, email, role });

function setup() {
  const admin = mk('dev:adm', 'Admin', 'administrator');
  const tk = mk('dev:tk', 'Tester', null);
  const object = services.objects.create({ parentId: null, name: 'Biblioteka', type: 'budynek', address: null, coordinatorId: admin.id, notes: null });
  const scenarioId = db.prepare('SELECT id FROM scenarios WHERE active = 1 ORDER BY id LIMIT 1').get().id;
  const audit = services.audits.create({ objectId: object.id, auditorId: tk.id, scenarioIds: [scenarioId], dueDate: null }, admin.id);
  return { admin, tk, audit };
}

test('Przyjmij audyt: widoczny tylko dla przydzielonego TK; po przyjęciu status „W trakcie” i wpis w historii', async () => {
  const { tk, audit, admin } = setup();
  assert.equal(audit.status, 'assigned');
  const other = mk('dev:inny', 'Inny TK', null);
  const html = await (await (await as(tk, 'auditor'))('GET', `/audits/${audit.id}`)).text();
  assert.match(html, /Przyjmij audyt/);
  assert.match(html, new RegExp(`action="/audits/${audit.id}/accept"`));

  // nie przyjmie: inny TK, administrator, koordynator
  await (await as(other, 'auditor'))('POST', `/audits/${audit.id}/accept`);
  assert.equal(services.audits.get(audit.id).status, 'assigned');
  assert.equal((await (await as(admin, 'administrator'))('POST', `/audits/${audit.id}/accept`)).status, 403);
  assert.equal(services.audits.get(audit.id).status, 'assigned');
  const adminView = await (await (await as(admin, 'administrator'))('GET', `/audits/${audit.id}`)).text();
  assert.ok(!adminView.includes('Przyjmij audyt'));

  const res = await (await as(tk, 'auditor'))('POST', `/audits/${audit.id}/accept`);
  assert.equal(res.status, 303);
  const after = services.audits.get(audit.id);
  assert.equal(after.status, 'in_progress');
  assert.ok(after.started_at);
  assert.deepEqual(services.history.list('audit', audit.id).map((e) => e.action), ['accepted']);
  // drugi raz nie
  await (await as(tk, 'auditor'))('POST', `/audits/${audit.id}/accept`);
  assert.equal(services.history.list('audit', audit.id).filter((e) => e.action === 'accepted').length, 1);
  assert.ok(!(await (await (await as(tk, 'auditor'))('GET', `/audits/${audit.id}`)).text()).includes('Przyjmij audyt'));
});

test('administrator przełączony na rolę Audytor widzi w „Moje audyty” audyt przydzielony sobie i może go przyjąć', async () => {
  const admin = mk('dev:adm', 'Admin', 'administrator');
  const object = services.objects.create({ parentId: null, name: 'Urząd', type: 'budynek', address: null, coordinatorId: admin.id, notes: null });
  const scenarioId = db.prepare('SELECT id FROM scenarios WHERE active = 1 ORDER BY id LIMIT 1').get().id;
  const audit = services.audits.create({ objectId: object.id, auditorId: admin.id, scenarioIds: [scenarioId], dueDate: null }, admin.id);
  const html = await (await (await as(admin, 'auditor'))('GET', '/audits')).text();
  assert.match(html, /Urząd/);
  assert.equal((await (await as(admin, 'auditor'))('POST', `/audits/${audit.id}/accept`)).status, 303);
  assert.equal(services.audits.get(audit.id).status, 'in_progress');
});

test('logowanie z SZO przejmuje istniejące konto o tym samym adresie e-mail zamiast tworzyć duplikat', () => {
  const first = mk('szo:100', 'Ewa Nowak', 'auditor', 'Ewa.Nowak@feer.org.pl');
  const again = services.users.upsertFromIdentity({ externalId: 'szo:777', name: 'Ewa Nowak', email: 'ewa.nowak@feer.org.pl', role: null });
  assert.equal(again.id, first.id);
  assert.equal(again.external_id, 'szo:777');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM users WHERE lower(email) = 'ewa.nowak@feer.org.pl'`).get().n, 1);
  // dwa konta z tym samym adresem: bez zgadywania, powstaje nowe, a lista użytkowników je oznacza
  db.prepare(`INSERT INTO users (external_id, name, email, role) VALUES ('szo:1', 'A', 'dup@feer.org.pl', 'auditor'), ('szo:2', 'B', 'dup@feer.org.pl', 'auditor')`).run();
  const third = services.users.upsertFromIdentity({ externalId: 'szo:3', name: 'C', email: 'dup@feer.org.pl', role: null });
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM users WHERE email = 'dup@feer.org.pl'`).get().n, 3);
  assert.ok(third.id);
  assert.ok(services.users.duplicateEmails().has('dup@feer.org.pl'));
});

test('strona logowania opisuje aplikację; nagłówek ma jedną nazwę roli i etykietę przełącznika tylko dla czytników ekranu', async () => {
  const login = await (await fetch(`${base}/login`)).text();
  assert.match(login, /<h1>Tajemniczy Klient<\/h1>/);
  assert.match(login, /Sprawdzamy, jak łatwo osoby z niepełnosprawnościami/);
  assert.match(login, /Dostępność kształcenia/);
  assert.match(login, /<h2 id="login-h">Wybierz sposób logowania<\/h2>/);
  const admin = mk('dev:adm', 'Admin', 'administrator');
  const page = await (await (await as(admin, 'administrator'))('GET', '/')).text();
  const header = /<header class="site-header">([\s\S]*?)<\/header>/.exec(page)[1];
  assert.match(header, /<label for="role-switch" class="sr-only">Aktywna rola<\/label>/);
  assert.ok(!/Admin \(/.test(header), 'rola nie jest dublowana w nawiasie przy nazwisku');
  assert.match(header, /aria-current="page"/);
});

test('strona audytu: etapy z aria-current, panel informacji z postępem, zwijane kategorie i pasek zapisu', async () => {
  const { tk, audit } = setup();
  const html = await (await (await as(tk, 'auditor'))('GET', `/audits/${audit.id}`)).text();
  assert.match(html, /<ol class="stepper" aria-label="Etapy audytu">/);
  assert.match(html, /<li class="step step-current" aria-current="step">[\s\S]*Przydzielony do TK/);
  assert.match(html, /<aside class="audit-side"/);
  assert.match(html, /<progress id="audit-progress" max="\d+" value="0">/);
  assert.match(html, /<details class="cat" open>/);
  assert.match(html, /class="actions save-bar"/);
  assert.equal((html.match(/<details/g) || []).length, (html.match(/<\/details>/g) || []).length);
});

test('Odrzuć audyt: tylko przydzielony TK z uzasadnieniem; audyt wraca do „Wprowadzony”, trafia do historii i powiadamia koordynatora', async () => {
  const { tk, audit, admin } = setup();
  const other = mk('dev:inny2', 'Inny TK', null);
  const html = await (await (await as(tk, 'auditor'))('GET', `/audits/${audit.id}`)).text();
  assert.match(html, new RegExp(`action="/audits/${audit.id}/decline"`));
  assert.match(html, /Nie mogę wykonać tego audytu/);

  // inni nie mogą; bez powodu nie przejdzie
  await (await as(other, 'auditor'))('POST', `/audits/${audit.id}/decline`, { reason: 'nie moje' });
  assert.equal((await (await as(admin, 'administrator'))('POST', `/audits/${audit.id}/decline`, { reason: 'x' })).status, 403);
  await (await as(tk, 'auditor'))('POST', `/audits/${audit.id}/decline`, { reason: ' ' });
  assert.equal(services.audits.get(audit.id).status, 'assigned');

  let notified = null;
  const original = services.notifier.auditDeclined;
  services.notifier.auditDeclined = (a, name, reason) => { notified = { id: a.id, name, reason }; };
  const res = await (await as(tk, 'auditor'))('POST', `/audits/${audit.id}/decline`, { reason: 'Mam urlop w terminie audytu' });
  assert.equal(res.status, 303);
  const after = services.audits.get(audit.id);
  assert.equal(after.status, 'entered');
  assert.equal(after.auditor_id, null);
  const events = services.history.list('audit', audit.id);
  assert.equal(events.at(-1).action, 'declined');
  assert.equal(events.at(-1).note, 'Mam urlop w terminie audytu');
  services.notifier.auditDeclined = original;
  assert.deepEqual(notified, { id: audit.id, name: 'Tester', reason: 'Mam urlop w terminie audytu' }, 'koordynator dostaje powiadomienie z powodem');
  // wrócił do przydziału: administrator może przydzielić ponownie
  const adminView = await (await (await as(admin, 'administrator'))('GET', `/audits/${audit.id}`)).text();
  assert.match(adminView, /Przydziel Tajemniczego Klienta/);
  // po odrzuceniu TK już go nie widzi
  assert.equal((await (await as(tk, 'auditor'))('GET', `/audits/${audit.id}`)).status, 404);
});
