const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { seedCatalog } = require('../src/db/seed');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-arch-'));
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
const mk = (ext, name, role) => services.users.upsertFromIdentity({ externalId: ext, name, email: null, role });
const scenarioId = () => db.prepare(`SELECT id FROM scenarios WHERE active = 1 AND usage IN ('audit','both') ORDER BY id LIMIT 1`).get().id;

function world() {
  const admin = mk('dev:ar-a', 'Admin', 'administrator');
  const coord = mk('dev:ar-k', 'Koordynator', 'coordinator');
  const tk = mk('dev:ar-t', 'Tester', null);
  const mine = services.objects.create({ parentId: null, name: 'Mój obiekt', type: 'budynek', address: null, coordinatorId: coord.id, notes: null });
  const foreign = services.objects.create({ parentId: null, name: 'Cudzy obiekt', type: 'budynek', address: null, coordinatorId: admin.id, notes: null });
  const mkAudit = (objectId, status) => {
    const a = services.audits.create({ objectId, auditorId: tk.id, scenarioIds: [scenarioId()], dueDate: null }, admin.id);
    db.prepare('UPDATE audits SET status = ? WHERE id = ?').run(status, a.id);
    return a;
  };
  return { admin, coord, tk, mine, foreign, mkAudit };
}

test('archiwizacja audytu: tylko zatwierdzone, znika z list, jest w archiwum, przywracanie, wpisy w dzienniku', async () => {
  const { admin, coord, tk, mine, mkAudit } = world();
  const approved = mkAudit(mine.id, 'approved');
  const running = mkAudit(mine.id, 'in_progress');
  const co = await as(coord, 'coordinator');

  await co('POST', `/archive/audit/${running.id}`);
  assert.equal(db.prepare('SELECT archived_at FROM audits WHERE id = ?').get(running.id).archived_at, null, 'nie zatwierdzony nie idzie do archiwum');

  assert.equal((await co('POST', `/archive/audit/${approved.id}`, { next: `/audits` })).status, 303);
  assert.ok(db.prepare('SELECT archived_at FROM audits WHERE id = ?').get(approved.id).archived_at);
  const list = await (await co('GET', '/audits')).text();
  assert.ok(!list.includes(`href="/audits/${approved.id}"`), 'zarchiwizowany nie jest na liście roboczej');
  assert.ok(list.includes(`href="/audits/${running.id}"`));
  assert.ok(!(await (await (await as(tk, 'auditor'))('GET', '/')).text()).includes(`/audits/${approved.id}"`));

  const archivePage = await (await co('GET', '/archive')).text();
  assert.match(archivePage, new RegExp(`/audits/${approved.id}"`));
  assert.match(archivePage, /Przywróć/);
  assert.ok(!archivePage.includes('Usuń trwale'), 'koordynator nie usuwa trwale');
  assert.match(await (await co('GET', `/audits/${approved.id}`)).text(), /jest w archiwum/);

  assert.equal((await co('POST', `/archive/audit/${approved.id}/restore`)).status, 303);
  assert.equal(db.prepare('SELECT archived_at FROM audits WHERE id = ?').get(approved.id).archived_at, null);
  assert.deepEqual(services.archive.recent(10).filter((e) => e.entity_id === approved.id).map((e) => e.action).reverse(), ['archived', 'restored']);
  const log = await (await (await as(admin, 'administrator'))('GET', '/log')).text();
  assert.match(log, /Archiwizacja/);
  assert.equal((await co('GET', '/log')).status, 403);
});

test('uprawnienia: koordynator nie rusza cudzych obiektów ani nie usuwa trwale; obiekty i scenariusze tylko administrator', async () => {
  const { coord, tk, foreign, mkAudit } = world();
  const other = mkAudit(foreign.id, 'approved');
  const co = await as(coord, 'coordinator');
  assert.equal((await co('POST', `/archive/audit/${other.id}`)).status, 404);
  assert.equal((await co('POST', `/archive/audit/${other.id}/purge`)).status, 403);
  assert.equal((await co('POST', `/archive/object/${foreign.id}`)).status, 403);
  assert.equal((await (await as(tk, 'auditor'))('POST', `/archive/audit/${other.id}`)).status, 403);
  assert.equal(db.prepare('SELECT archived_at FROM audits WHERE id = ?').get(other.id).archived_at, null);
});

test('trwałe usunięcie audytu przez administratora: razem z pozycjami i plikami; w dzienniku', async () => {
  const { admin, mine, mkAudit } = world();
  const audit = mkAudit(mine.id, 'in_progress');
  const itemId = services.audits.items(audit.id)[0].id;
  const stored = 'plik-testowy.png';
  fs.writeFileSync(path.join(uploadDir, stored), 'x');
  db.prepare(`INSERT INTO attachments (audit_item_id, original_name, stored_name, mime, size) VALUES (?, 'a.png', ?, 'image/png', 1)`).run(itemId, stored);
  const adm = await as(admin, 'administrator');
  const page = await (await adm('GET', `/audits/${audit.id}`)).text();
  assert.match(page, /Usuń trwale/);
  assert.equal((await adm('POST', `/archive/audit/${audit.id}/purge`, { next: '/audits' })).status, 303);
  assert.equal(db.prepare('SELECT 1 FROM audits WHERE id = ?').get(audit.id), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_items WHERE audit_id = ?').get(audit.id).n, 0);
  assert.equal(fs.existsSync(path.join(uploadDir, stored)), false, 'plik załącznika usunięty z dysku');
  assert.ok(services.archive.recent(5).some((e) => e.action === 'purged' && e.entity_id === audit.id));
});

test('obiekty i scenariusze: archiwizacja ukrywa z list i wyborów, usunięcie tylko gdy nic ich nie używa', async () => {
  const { admin, mine, mkAudit } = world();
  mkAudit(mine.id, 'assigned');
  const adm = await as(admin, 'administrator');
  const free = services.objects.create({ parentId: null, name: 'Wolny obiekt', type: 'budynek', address: null, coordinatorId: null, notes: null });

  await adm('POST', `/archive/object/${free.id}`);
  assert.ok(!services.objects.list().some((o) => o.id === free.id), 'zarchiwizowany obiekt znika z listy');
  assert.ok(!services.objects.parentOptions().some((o) => o.id === free.id));
  assert.match(await (await adm('GET', '/archive')).text(), /Wolny obiekt/);
  await adm('POST', `/archive/object/${free.id}/restore`);
  assert.ok(services.objects.list().some((o) => o.id === free.id));

  await adm('POST', `/archive/object/${mine.id}/purge`);
  assert.ok(services.objects.get(mine.id), 'obiekt z audytami nie jest usuwany');
  await adm('POST', `/archive/object/${free.id}/purge`);
  assert.equal(services.objects.get(free.id), undefined);

  const sid = scenarioId();
  await adm('POST', `/archive/scenario/${sid}/purge`);
  assert.ok(services.catalog.scenarios.get(sid), 'użyty scenariusz nie jest usuwany');
  await adm('POST', `/archive/scenario/${sid}`);
  assert.ok(!services.catalog.scenarios.list({ onlyActive: true, usage: 'audit' }).some((s) => s.id === sid), 'zarchiwizowany scenariusz znika z wyboru');
  await adm('POST', `/archive/scenario/${sid}/restore`);
  assert.ok(services.catalog.scenarios.list({ onlyActive: true, usage: 'audit' }).some((s) => s.id === sid));
});

test('adres powrotu po operacji jest ograniczony do własnych ścieżek', async () => {
  const { admin, mine, mkAudit } = world();
  const a = mkAudit(mine.id, 'approved');
  const res = await (await as(admin, 'administrator'))('POST', `/archive/audit/${a.id}`, { next: 'https://zlosliwa.example/' });
  assert.equal(res.headers.get('location'), '/archive');
});
