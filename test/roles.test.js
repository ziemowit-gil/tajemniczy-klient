const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignJWT } = require('jose');
const { DatabaseSync } = require('node:sqlite');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { migrate } = require('../src/db');
const { seedCatalog } = require('../src/db/seed');

const SECRET = 'szo-test-secret-szo-test-secret-1234';
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-roles-'));
const config = loadConfig({
  NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir, SESSION_SECRET: 'session-secret-session-secret-session-secret',
  SZO_AUTH_MODE: 'jwt', SZO_JWT_SECRET: SECRET, SZO_ROLE_MAP: JSON.stringify({ a: 'administrator', u: 'auditor', k: 'coordinator' }),
});
const { app, db, services } = createApp(config);
seedCatalog(db);
let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

const key = new TextEncoder().encode(SECRET);
/** Przeglądarka z własnym słoikiem ciasteczek (osobne sesje tej samej osoby = osobne obiekty). */
class Browser {
  constructor() { this.jar = new Map(); }
  async req(method, url, data) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, { method, headers: cookie ? { cookie } : {}, body: data ? new URLSearchParams(data) : undefined, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) { const [p] = line.split(';'); const i = p.indexOf('='); this.jar.set(p.slice(0, i), p.slice(i + 1)); }
    return res;
  }
  get(u) { return this.req('GET', u); }
  post(u, d) { return this.req('POST', u, d ?? {}); }
  async login(sub, role) {
    const t = await new SignJWT({ name: sub, email: `${sub}@feer.org.pl`, ...(role ? { role } : {}) }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('5m').sign(key);
    assert.equal((await this.get(`/auth/callback?token=${t}`)).status, 303);
    return this;
  }
}
const user = (ext) => services.users.findById(db.prepare('SELECT id FROM users WHERE external_id = ?').get(ext).id);
const header = (html) => /<header class="site-header">([\s\S]*?)<\/header>/.exec(html)[1];
const flashOf = (b) => decodeURIComponent((b.jar.get('tk_flash') || '').replace(/\+/g, ' '));

test('migracja 008: istniejący użytkownicy dostają Audytora oraz swoją dotychczasową rolę', () => {
  const dir = path.join(__dirname, '../src/db/migrations');
  const old = new DatabaseSync(':memory:');
  old.exec('PRAGMA foreign_keys = ON');
  old.exec(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql') && x < '008').sort()) {
    old.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    old.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(f);
  }
  old.exec(`INSERT INTO users (external_id, name, role) VALUES ('adm', 'Admin', 'administrator'), ('koo', 'Koord', 'coordinator'), ('aud', 'Audytor', 'auditor')`);
  migrate(old);
  const roles = Object.fromEntries(old.prepare(`SELECT u.external_id, GROUP_CONCAT(r.role) AS roles FROM users u JOIN user_roles r ON r.user_id = u.id GROUP BY u.id`).all().map((r) => [r.external_id, r.roles.split(',').sort()]));
  assert.deepEqual(roles, { adm: ['administrator', 'auditor'], koo: ['auditor', 'coordinator'], aud: ['auditor'] });
  assert.equal(old.prepare(`SELECT role FROM users WHERE external_id = 'adm'`).get().role, 'administrator', 'ostatnio używana rola bez zmian');
});

test('usługa: Audytor obowiązkowy, role dodatkowe, przełączanie i rola z SZO dodawana do przyznanych', () => {
  const u = services.users.upsertFromIdentity({ externalId: 'svc1', name: 'Nowy', email: null, role: null });
  assert.deepEqual(u.roles, ['auditor']);
  assert.equal(u.role, 'auditor');

  const k = services.users.upsertFromIdentity({ externalId: 'svc2', name: 'Koord', email: null, role: 'coordinator' });
  assert.deepEqual(k.roles, ['auditor', 'coordinator']);
  assert.equal(k.role, 'coordinator');

  // rola z SZO dodaje się do przyznanych (nie zastępuje) i staje się domyślną
  const k2 = services.users.upsertFromIdentity({ externalId: 'svc2', name: 'Koord', email: null, role: 'administrator' });
  assert.deepEqual(k2.roles, ['auditor', 'coordinator', 'administrator']);
  assert.equal(k2.role, 'administrator');

  // Audytora nie da się odebrać
  const only = services.users.setRoles(k.id, { extras: [], active: true });
  assert.deepEqual(only.roles, ['auditor']);
  assert.equal(only.role, 'auditor', 'rola domyślna musi być przyznana');
  assert.deepEqual(services.users.setRoles(k.id, { extras: ['administrator', 'nieznana'], active: true }).roles, ['auditor', 'administrator']);

  assert.equal(services.users.switchRole(k.id, 'auditor'), true);
  assert.equal(services.users.switchRole(k.id, 'coordinator'), false, 'rola nieprzyznana');
  assert.equal(services.users.findById(k.id).role, 'auditor');
  assert.equal(services.users.hasRole(k.id, 'administrator'), true);

  // listByRole liczy role przyznane, nie tylko aktywną: administrator jest też na liście audytorów
  assert.ok(services.users.listByRole('auditor').some((x) => x.id === k.id));
  assert.ok(services.users.listByRole('administrator').some((x) => x.id === k.id));
  // zgodność wsteczna: update z jedną rolą
  assert.deepEqual(services.users.update(k.id, { role: 'coordinator', active: true }).roles, ['auditor', 'coordinator']);
});

test('przełącznik ról: widoczny tylko przy kilku rolach, zmienia uprawnienia sesji i jest zapamiętywany', async () => {
  const adm = await new Browser().login('adm1', 'a');
  let html = header(await (await adm.get('/')).text());
  assert.match(html, /\(Administrator\)/);
  assert.match(html, /<form method="post" action="\/role" class="role-switch">/);
  assert.match(html, /<option value="auditor">Audytor \/ Tajemniczy Klient<\/option>/);
  assert.match(html, /<option value="administrator" selected>Administrator<\/option>/);
  assert.doesNotMatch(html, /value="coordinator"/, 'tylko role przyznane');
  assert.equal((await adm.get('/users')).status, 200);

  // przełączenie na Audytora: panel administratora zamknięty, widoczne tylko własne audyty
  const sw = await adm.post('/role', { role: 'auditor' });
  assert.equal(sw.status, 303);
  assert.equal(sw.headers.get('location'), '/');
  assert.match(flashOf(adm), /Przełączono na rolę: Audytor/);
  html = header(await (await adm.get('/')).text());
  assert.match(html, /\(Audytor \/ Tajemniczy Klient\)/);
  assert.match(html, /<option value="auditor" selected>/);
  assert.equal((await adm.get('/users')).status, 403);
  assert.equal((await adm.get('/criteria')).status, 403);
  assert.match(await (await adm.get('/audits')).text(), /Moje audyty/);

  // powrót
  await adm.post('/role', { role: 'administrator' });
  assert.equal((await adm.get('/users')).status, 200);

  // rola nieprzyznana lub nieprawidłowa nie zmienia niczego
  for (const bad of ['coordinator', 'superadmin', '']) {
    const r = await adm.post('/role', { role: bad });
    assert.equal(r.status, 303);
    assert.match(flashOf(adm), /Nie masz przyznanej takiej roli/);
    assert.equal((await adm.get('/users')).status, 200, `bez zmian po ${JSON.stringify(bad)}`);
  }

  // zwykły audytor nie ma przełącznika, a /role niczego mu nie daje
  const aud = await new Browser().login('aud1', 'u');
  assert.doesNotMatch(header(await (await aud.get('/')).text()), /role-switch/);
  await aud.post('/role', { role: 'administrator' });
  assert.equal((await aud.get('/users')).status, 403);
});

test('rola jest per sesja: dwie sesje tej samej osoby działają równolegle w różnych rolach, a ostatnia rola wraca po zalogowaniu', async () => {
  const a = await new Browser().login('adm2', 'a');
  const b = await new Browser().login('adm2', 'a');
  await a.post('/role', { role: 'auditor' });
  assert.equal((await a.get('/users')).status, 403, 'sesja A jako Audytor');
  assert.equal((await b.get('/users')).status, 200, 'sesja B nadal jako Administrator');

  // zapamiętana ostatnia rola (Audytor) jest domyślna przy nowym logowaniu; token SZO z rolą administratora ustawia ją z powrotem
  assert.equal(user('adm2').role, 'auditor');
  const c = await new Browser().login('adm2');           // token bez roli → ostatnio używana
  assert.equal((await c.get('/users')).status, 403);
  const d = await new Browser().login('adm2', 'a');      // token z rolą → rola z SZO jako domyślna
  assert.equal((await d.get('/users')).status, 200);

  // odebranie roli unieważnia ją w trwających sesjach
  services.users.setRoles(user('adm2').id, { extras: [], active: true });
  assert.equal((await b.get('/users')).status, 403, 'sesja B traci uprawnienia administratora');
});

test('panel Użytkownicy: role dodatkowe jako pola wyboru, Audytor stały, ochrona ostatniego administratora', async () => {
  const adm = await new Browser().login('adm3', 'a');
  const target = services.users.upsertFromIdentity({ externalId: 'cel', name: 'Cel', email: null, role: null });
  const page = await (await adm.get('/users')).text();
  assert.match(page, /Audytor \/ Tajemniczy Klient <span class="muted">\(zawsze\)<\/span>/);
  assert.match(page, new RegExp(`name="coordinator" form="user-${target.id}"`));
  assert.match(page, new RegExp(`name="administrator" form="user-${target.id}"`));

  // nadanie koordynatora i administratora
  await adm.post(`/users/${target.id}`, { coordinator: 'on', administrator: 'on', active: 'on' });
  assert.deepEqual(user('cel').roles, ['auditor', 'coordinator', 'administrator']);
  // odebranie koordynatora; Audytor zostaje
  await adm.post(`/users/${target.id}`, { administrator: 'on', active: 'on' });
  assert.deepEqual(user('cel').roles, ['auditor', 'administrator']);
  await adm.post(`/users/${target.id}`, { active: 'on' });
  assert.deepEqual(user('cel').roles, ['auditor']);

  // ostatni aktywny administrator: nie można odebrać roli ani wyłączyć konta
  db.prepare(`DELETE FROM user_roles WHERE role = 'administrator' AND user_id <> ?`).run(user('adm3').id);
  const me = user('adm3').id;
  await adm.post(`/users/${me}`, { active: 'on' });
  assert.match(flashOf(adm), /ostatniemu aktywnemu administratorowi/);
  assert.ok(user('adm3').roles.includes('administrator'));
  await adm.post(`/users/${me}`, { administrator: 'on' });   // bez „active”
  assert.match(flashOf(adm), /ostatniemu aktywnemu administratorowi/);
  assert.equal(user('adm3').active, 1);
});

test('każdy ma rolę Audytora: administrator i koordynator mogą dostać audyt i ocenę jako Tajemniczy Klient', async () => {
  const koord = services.users.upsertFromIdentity({ externalId: 'koo9', name: 'Koord', email: null, role: 'coordinator' });
  const uni = services.objects.create({ name: 'Uczelnia Ról', type: 'uczelnia', parentId: null, address: null, coordinatorId: null, notes: null });
  const scenario = db.prepare(`SELECT id FROM scenarios WHERE usage IN ('audit', 'both') AND active = 1 LIMIT 1`).get().id;
  const admin = user('adm3');
  const audit = services.audits.create({ objectId: uni.id, auditorId: koord.id, scenarioIds: [scenario], dueDate: null }, admin.id);
  assert.equal(audit.auditor_id, koord.id);

  // jako Audytor (po przełączeniu) koordynator widzi i może wypełniać swój audyt, jako Koordynator nie wypełnia
  const b = await new Browser().login('koo9', 'k');
  await b.post('/role', { role: 'auditor' });
  assert.match(await (await b.get('/audits')).text(), /Uczelnia Ról/);
  assert.equal((await b.get(`/audits/${audit.id}`)).status, 200);
  assert.equal(services.audits.canEdit({ ...koord, role: 'auditor' }, audit), true);
  assert.equal(services.audits.canEdit({ ...koord, role: 'coordinator' }, audit), false);

  const review = services.office.create({ objectId: uni.id, programme: 'Prawo', studyLevel: 'I', studyMode: 'stacjonarne', disability: 'ruchowa', scenarioIds: [] }, admin.id);
  assert.equal(review.auditor_id, admin.id);
});
