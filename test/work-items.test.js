const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { seedCatalog } = require('../src/db/seed');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-work-'));
const config = loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir, SESSION_SECRET: 'session-secret-session-secret-session-secret', SZO_AUTH_MODE: 'dev' });
const { app, db, services } = createApp(config);
seedCatalog(db);
let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

async function as(user, role) {
  let cookie = '';
  await services.sessions.issue({ cookie: (n, v) => { cookie = `${n}=${v}`; } }, user.id, role);
  return (method, url) => fetch(base + url, { method, headers: { cookie }, redirect: 'manual' });
}
const mk = (ext, name, role) => services.users.upsertFromIdentity({ externalId: ext, name, email: null, role });

test('„Moje audyty” i pulpit zawierają audyty obiektów oraz oceny „Dostępność kształcenia”; filtr statusu działa na oba rodzaje', async () => {
  const admin = mk('dev:wa', 'Admin', 'administrator');
  const tk = mk('dev:wt', 'Tester', null);
  const other = mk('dev:wo', 'Inny', null);
  const uni = services.objects.create({ parentId: null, name: 'Uniwersytet Testowy', type: 'uczelnia', address: null, coordinatorId: admin.id, notes: null });
  const bld = services.objects.create({ parentId: null, name: 'Biblioteka Główna', type: 'budynek', address: null, coordinatorId: admin.id, notes: null });
  const scenarioId = db.prepare(`SELECT id FROM scenarios WHERE active = 1 AND usage IN ('audit','both') ORDER BY id LIMIT 1`).get().id;
  const audit = services.audits.create({ objectId: bld.id, auditorId: tk.id, scenarioIds: [scenarioId], dueDate: null }, admin.id);
  const review = services.office.create({ objectId: uni.id, programme: 'Psychologia', studyLevel: 'I', studyMode: 'stacjonarne', disability: 'wzroku', scenarioIds: [] }, tk.id);
  services.office.create({ objectId: uni.id, programme: 'Cudza ocena', studyLevel: 'I', studyMode: 'stacjonarne', disability: 'wzroku', scenarioIds: [] }, other.id);

  const mine = await (await (await as(tk, 'auditor'))('GET', '/audits')).text();
  assert.match(mine, /<h1>Moje audyty<\/h1>/);
  assert.match(mine, new RegExp(`href="/audits/${audit.id}">Biblioteka Główna`));
  assert.match(mine, new RegExp(`href="/office/${review.id}">Uniwersytet Testowy`));
  assert.match(mine, /Dostępność kształcenia/);
  assert.match(mine, /Psychologia/);
  assert.ok(!mine.includes('Cudza ocena'), 'cudze oceny nie trafiają do „Moje audyty”');

  const dash = await (await (await as(tk, 'auditor'))('GET', '/')).text();
  assert.match(dash, new RegExp(`href="/office/${review.id}"`));

  const filtered = await (await (await as(tk, 'auditor'))('GET', '/audits?status=assigned')).text();
  assert.match(filtered, new RegExp(`href="/audits/${audit.id}"`));
  assert.ok(!filtered.includes(`href="/office/${review.id}"`), 'ocena w trakcie nie pasuje do filtra „Przydzielony”');

  const all = await (await (await as(admin, 'administrator'))('GET', '/audits')).text();
  assert.match(all, /Cudza ocena/);
  assert.match(all, /<h1>Audyty<\/h1>/);
});
