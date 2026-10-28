const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignJWT } = require('jose');

const core = require('../src/public/js/steps-editor.js');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { parseForm, scenarioSchema } = require('../src/validation/schemas');

test('parseSteps / serializeSteps: puste wiersze, numeracja, spacje', () => {
  assert.deepEqual(core.parseSteps('1. Pierwszy\n\n  Drugi  \r\n3) Trzeci\n   '), ['Pierwszy', 'Drugi', 'Trzeci']);
  assert.deepEqual(core.parseSteps(''), []);
  assert.deepEqual(core.parseSteps(null), []);
  assert.equal(core.serializeSteps(['A', '  ', ' B ', '']), 'A\nB');
  // wynik edytora przechodzi walidację serwera i daje te same kroki
  const text = core.serializeSteps(['Krok A', 'Krok B']);
  const { ok, data } = parseForm(scenarioSchema, { title: 'T', areas: 'BOTH', usage: 'audit', steps: text });
  assert.ok(ok);
  assert.deepEqual(data.steps, ['Krok A', 'Krok B']);
});

test('moveStep: przesuwanie, krawędzie i brak mutacji', () => {
  const src = ['a', 'b', 'c'];
  assert.deepEqual(core.moveStep(src, 1, -1), { steps: ['b', 'a', 'c'], index: 0 });
  assert.deepEqual(core.moveStep(src, 1, 1), { steps: ['a', 'c', 'b'], index: 2 });
  assert.deepEqual(core.moveStep(src, 0, -1), { steps: ['a', 'b', 'c'], index: 0 }, 'pierwszy nie idzie wyżej');
  assert.deepEqual(core.moveStep(src, 2, 1), { steps: ['a', 'b', 'c'], index: 2 }, 'ostatni nie idzie niżej');
  assert.deepEqual(core.moveStep(src, 9, 1), { steps: ['a', 'b', 'c'], index: 9 });
  assert.deepEqual(src, ['a', 'b', 'c']);
});

test('removeStep: fokus na następnym lub ostatnim kroku', () => {
  assert.deepEqual(core.removeStep(['a', 'b', 'c'], 1), { steps: ['a', 'c'], index: 1 });
  assert.deepEqual(core.removeStep(['a', 'b', 'c'], 2), { steps: ['a', 'b'], index: 1 });
  assert.deepEqual(core.removeStep(['a'], 0), { steps: [], index: -1 });
  assert.deepEqual(core.removeStep(['a'], 5), { steps: ['a'], index: 0 });
});

test('insertAfter: wstawianie z limitem kroków', () => {
  assert.deepEqual(core.insertAfter(['a', 'b'], 0, ['x'], 30), { steps: ['a', 'x', 'b'], index: 1, added: 1 });
  assert.deepEqual(core.insertAfter(['a', 'b'], 1, ['x', 'y'], 30), { steps: ['a', 'b', 'x', 'y'], index: 3, added: 2 });
  assert.deepEqual(core.insertAfter(['a', 'b'], 1, ['x', 'y', 'z'], 3), { steps: ['a', 'b', 'x'], index: 2, added: 1 }, 'limit przycina');
  assert.deepEqual(core.insertAfter(['a', 'b', 'c'], 2, ['x'], 3), { steps: ['a', 'b', 'c'], index: 2, added: 0 }, 'pełna lista');
  const thirty = Array.from({ length: 30 }, (_, i) => `k${i}`);
  assert.equal(core.insertAfter(thirty, 29, ['x'], 30).added, 0);
});

test('splitPaste: wklejenie wielu wierszy rozdziela kroki, jednej linii nie rusza', () => {
  assert.deepEqual(core.splitPaste('1. Otwórz stronę\n2. Znajdź kontakt\n3. Napisz maila'), ['Otwórz stronę', 'Znajdź kontakt', 'Napisz maila']);
  assert.deepEqual(core.splitPaste('Jedna linia'), []);
  assert.deepEqual(core.splitPaste('Jedna linia\n'), [], 'końcowy znak nowej linii nie robi z tego wielu kroków');
  assert.deepEqual(core.splitPaste(''), []);
});

test('formularz scenariusza: markup edytora, skrypt i uczciwy fallback bez JavaScriptu', async () => {
  const SECRET = 'szo-test-secret-szo-test-secret-1234';
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-se-'));
  const { app, db } = createApp(loadConfig({
    NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir, SESSION_SECRET: 'session-secret-session-secret-session-secret',
    SZO_AUTH_MODE: 'jwt', SZO_JWT_SECRET: SECRET, SZO_ROLE_MAP: JSON.stringify({ a: 'administrator' }),
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const token = await new SignJWT({ name: 'adm', role: 'a' }).setProtectedHeader({ alg: 'HS256' }).setSubject('adm').setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
    const login = await fetch(`${base}/auth/callback?token=${token}`, { redirect: 'manual' });
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const id = db.prepare(`INSERT INTO scenarios (title, areas, usage) VALUES ('Edytowany', 'BOTH', 'audit')`).run().lastInsertRowid;
    db.prepare(`INSERT INTO scenario_steps (scenario_id, position, text) VALUES (?, 1, 'Pierwszy'), (?, 2, 'Drugi')`).run(id, id);

    const html = await (await fetch(`${base}/scenarios/${id}/edit`, { headers: { cookie } })).text();
    assert.match(html, /<textarea [^>]*name="steps"[^>]*data-steps-editor data-max-steps="30" data-max-length="300"[^>]*>Pierwszy\nDrugi<\/textarea>/, 'pole tekstowe jako źródło danych i fallback');
    assert.match(html, /<script src="\/js\/steps-editor\.js\?v=[0-9a-f]{10}" defer><\/script>/);
    assert.match(html, /Bez JavaScriptu: jeden krok w wierszu/);

    const js = await fetch(`${base}/js/steps-editor.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);

    // zapis tekstu z edytora (np. po przesunięciu kroków) działa przez to samo pole
    const res = await fetch(`${base}/scenarios/${id}`, {
      method: 'POST', headers: { cookie }, redirect: 'manual',
      body: new URLSearchParams({ title: 'Edytowany', areas: 'BOTH', usage: 'audit', active: 'on', steps: core.serializeSteps(core.moveStep(['Pierwszy', 'Drugi'], 1, -1).steps) }),
    });
    assert.equal(res.status, 303);
    assert.deepEqual(db.prepare('SELECT text FROM scenario_steps WHERE scenario_id = ? ORDER BY position').all(id).map((r) => r.text), ['Drugi', 'Pierwszy']);
  } finally { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); }
});
