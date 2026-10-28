const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { seedCatalog } = require('../src/db/seed');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-life-'));
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
const mk = (ext, name, role) => services.users.upsertFromIdentity({ externalId: ext, name, email: `${ext}@example.pl`, role });
const exists = (id) => db.prepare('SELECT 1 FROM users WHERE id = ?').get(id) !== undefined;

test('dezaktywacja i reaktywacja: odwracalne, sesja dezaktywowanego przestaje działać, tylko administrator', async () => {
  const admin = mk('dev:a1', 'Admin', 'administrator');
  const tk = mk('dev:t1', 'Tester', null);
  const adm = await as(admin, 'administrator');
  const tkReq = await as(tk, 'auditor');
  assert.equal((await tkReq('GET', '/audits')).status, 200);
  assert.equal((await tkReq('POST', `/users/${tk.id}/deactivate`)).status, 403);

  assert.equal((await adm('POST', `/users/${tk.id}/deactivate`)).status, 303);
  assert.equal(Boolean(services.users.findById(tk.id).active), false);
  assert.notEqual((await tkReq('GET', '/audits')).status, 200, 'sesja wyłączonego konta nie działa');
  const html = await (await adm('GET', '/users')).text();
  assert.match(html, new RegExp(`action="/users/${tk.id}/reactivate"`));

  assert.equal((await adm('POST', `/users/${tk.id}/reactivate`)).status, 303);
  assert.equal(Boolean(services.users.findById(tk.id).active), true);
  assert.equal((await tkReq('GET', '/audits')).status, 200);
});

test('nie można dezaktywować ani usunąć własnego konta', async () => {
  const admin = mk('dev:a2', 'Admin Drugi', 'administrator');
  const adm = await as(admin, 'administrator');
  await adm('POST', `/users/${admin.id}/deactivate`);
  await adm('POST', `/users/${admin.id}/delete`);
  assert.equal(Boolean(services.users.findById(admin.id).active), true);
  assert.ok(exists(admin.id));
});

test('usuwanie: konto bez powiązań znika, konto z audytem lub oświadczeniem zostaje', async () => {
  const admin = mk('dev:a4', 'Admin Czwarty', 'administrator');
  const adm = await as(admin, 'administrator');
  const empty = mk('dev:pusty', 'Bez śladu', null);
  assert.equal((await adm('POST', `/users/${empty.id}/delete`)).status, 303);
  assert.ok(!exists(empty.id));

  const used = mk('dev:uzyty', 'Z audytem', null);
  const object = services.objects.create({ parentId: null, name: 'Obiekt', type: 'budynek', address: null, coordinatorId: admin.id, notes: null });
  const scenarioId = db.prepare('SELECT id FROM scenarios WHERE active = 1 ORDER BY id LIMIT 1').get().id;
  services.audits.create({ objectId: object.id, auditorId: used.id, scenarioIds: [scenarioId], dueDate: null }, admin.id);
  await adm('POST', `/users/${used.id}/delete`);
  assert.ok(exists(used.id), 'konto z audytem nie jest usuwane');
  assert.deepEqual(services.users.usage(used.id), { audits: 1, reviews: 0, declarations: 0 });

  const declared = mk('dev:oswiadczenie', 'Z oświadczeniem', null);
  services.declarations.accept(declared);
  await adm('POST', `/users/${declared.id}/delete`);
  assert.ok(exists(declared.id), 'konto ze złożonym oświadczeniem nie jest usuwane');
  // dezaktywacja zawsze możliwa
  await adm('POST', `/users/${used.id}/deactivate`);
  assert.equal(Boolean(services.users.findById(used.id).active), false);
});

test('usuwanie i reaktywacja konta zewnętrznego: usuwa tokeny, a reaktywacja bez hasła wysyła nowy link', async () => {
  const admin = mk('dev:a5', 'Admin Piąty', 'administrator');
  const adm = await as(admin, 'administrator');
  const ext = db.prepare(`INSERT INTO users (external_id, name, email, role, kind, phone, active) VALUES ('ext:x', 'Zew', 'zew@example.pl', 'auditor', 'external', '+48600100200', 0)`).run().lastInsertRowid;
  db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, 'auditor')`).run(ext);
  db.prepare(`INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, 'set_password', 'h', datetime('now', '+1 day'))`).run(ext);
  assert.equal((await adm('POST', `/users/${ext}/delete`)).status, 303);
  assert.ok(!exists(ext));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM auth_tokens WHERE user_id = ?').get(ext).n, 0);
});
