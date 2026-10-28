const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { migrate } = require('../src/db');
const { seedCatalog } = require('../src/db/seed');
const { OBJECT_TYPES } = require('../src/domain/constants');
const { importPack } = require('../src/db/scenarioPacks');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-types-'));
const config = loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir, SESSION_SECRET: 'session-secret-session-secret-session-secret', SZO_AUTH_MODE: 'dev' });
const { app, db, services } = createApp(config);
seedCatalog(db);
let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

test('migracja 013: obiekty i powiązane audyty zachowane, nowe rodzaje obiektów przyjmowane, klucze obce spójne', () => {
  const dir = path.join(__dirname, '../src/db/migrations');
  const old = new DatabaseSync(':memory:');
  old.exec('PRAGMA foreign_keys = ON');
  old.exec(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql') && x < '013').sort()) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/^-- migrate: foreign_keys=off/.test(sql)) old.exec('PRAGMA foreign_keys = OFF');
    old.exec(sql);
    old.exec('PRAGMA foreign_keys = ON');
    old.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(f);
  }
  old.exec(`INSERT INTO users (external_id, name, role) VALUES ('u1', 'Tester', 'auditor')`);
  old.exec(`INSERT INTO objects (name, type) VALUES ('Uczelnia A', 'uczelnia')`);
  old.exec(`INSERT INTO objects (parent_id, name, type, archived_at) VALUES (1, 'Budynek B', 'budynek', datetime('now'))`);
  old.exec(`INSERT INTO scenarios (title, description, areas, usage, active) VALUES ('S', 'd', 'OZN', 'audit', 1)`);
  old.exec(`INSERT INTO audits (object_id, auditor_id, scenario_id, status) VALUES (2, 1, 1, 'assigned')`);
  assert.throws(() => old.exec(`INSERT INTO objects (name, type) VALUES ('Sklep', 'sklep')`), /CHECK/);

  migrate(old);
  assert.deepEqual(old.prepare('SELECT id, parent_id, name, type, archived_at IS NOT NULL AS arch FROM objects ORDER BY id').all().map((o) => ({ ...o })),
    [{ id: 1, parent_id: null, name: 'Uczelnia A', type: 'uczelnia', arch: 0 }, { id: 2, parent_id: 1, name: 'Budynek B', type: 'budynek', arch: 1 }]);
  assert.equal(old.prepare('SELECT object_id FROM audits').get().object_id, 2, 'audyt nadal wskazuje obiekt');
  old.exec(`INSERT INTO objects (name, type) VALUES ('Sklep', 'sklep'), ('Bar', 'restauracja')`);
  assert.throws(() => old.exec(`INSERT INTO objects (name, type) VALUES ('X', 'nieznany')`), /CHECK/);
  assert.equal(old.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('administrator dodaje sklep, restaurację i inny obiekt; formularz oferuje nowe rodzaje', async () => {
  const admin = services.users.upsertFromIdentity({ externalId: 'dev:ot', name: 'Admin', email: null, role: 'administrator' });
  let cookie = ''; await services.sessions.issue({ cookie: (n, v) => { cookie = `${n}=${v}`; } }, admin.id, 'administrator');
  const form = await (await fetch(`${base}/objects/new`, { headers: { cookie } })).text();
  for (const label of ['Sklep lub centrum handlowe', 'Restauracja, kawiarnia lub bar', 'Hotel lub nocleg', 'Urząd lub instytucja', 'Inny obiekt']) assert.ok(form.includes(label), label);
  for (const [type, name] of [['sklep', 'Sklep Przykładowy'], ['restauracja', 'Bar Mleczny'], ['inne', 'Punkt informacji']]) {
    const res = await fetch(`${base}/objects`, { method: 'POST', headers: { cookie }, body: new URLSearchParams({ name, type }), redirect: 'manual' });
    assert.equal(res.status, 303, type);
    assert.equal(db.prepare('SELECT type FROM objects WHERE name = ?').get(name).type, type);
  }
  assert.equal((await fetch(`${base}/objects`, { method: 'POST', headers: { cookie }, body: new URLSearchParams({ name: 'Zły', type: 'kosmos' }), redirect: 'manual' })).status, 422);
  assert.ok(Object.keys(OBJECT_TYPES).length >= 13);
});

test('paczka scenariuszy „Sklepy, restauracje i inne”: import jest idempotentny, scenariusze trafiają do audytów obiektów', () => {
  const first = importPack(db, 'handel');
  assert.equal(first.added.length, 7);
  assert.equal(importPack(db, 'handel').added.length, 0);
  const usage = db.prepare(`SELECT usage, areas, COUNT(*) n FROM scenarios WHERE title LIKE 'Sklep%' OR title LIKE 'Restauracja%' OR title LIKE 'Miejsce usługowe%' OR title LIKE 'Strona lub aplikacja%' OR title LIKE 'Sklep lub punkt usług%' GROUP BY usage, areas`).all().map((r) => ({ ...r }));
  assert.deepEqual(usage, [{ usage: 'audit', areas: 'OZN', n: 7 }]);
  assert.ok(db.prepare(`SELECT COUNT(*) n FROM scenario_steps st JOIN scenarios s ON s.id = st.scenario_id WHERE s.title LIKE 'Sklep: zakupy osoby niewidomej%'`).get().n >= 4);
});
