const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPair, exportSPKI, SignJWT } = require('jose');

const { loadConfig } = require('../src/config');
const { createSzoClient, resolveRole, identityFromClaims, AuthError } = require('../src/services/szoAuth');
const { csvCell, answerLabel } = require('../src/services/exporters');

const baseEnv = {
  SESSION_SECRET: 'session-secret-session-secret-session-secret',
  SZO_ROLE_MAP: '{"tk_admin":"administrator","tk_aud":"auditor"}',
};
const cfg = (extra = {}) => loadConfig({ NODE_ENV: 'test', SZO_AUTH_MODE: 'jwt', SZO_JWT_SECRET: 'sekret-sekret-sekret-1234', ...baseEnv, ...extra }).szo;

test('resolveRole: mapowanie, tablice i priorytet ról', () => {
  const map = { tk_admin: 'administrator', tk_aud: 'auditor' };
  assert.equal(resolveRole('tk_admin', map), 'administrator');
  assert.equal(resolveRole('auditor', map), 'auditor');            // nazwa wewnętrzna też działa
  assert.equal(resolveRole(['tk_aud', 'tk_admin'], map), 'administrator');
  assert.equal(resolveRole(['coordinator', 'auditor'], map), 'coordinator');
  assert.equal(resolveRole('nieznana', map), null);
  assert.equal(resolveRole(undefined, map), null);
  assert.equal(resolveRole('constructor', {}), null);              // brak odczytu z prototypu
});

test('identityFromClaims: konfigurowalne nazwy claimów i wymagany identyfikator', () => {
  const c = cfg({ SZO_CLAIM_ID: 'user_id', SZO_CLAIM_NAME: 'full_name', SZO_CLAIM_ROLE: 'groups' });
  const id = identityFromClaims({ user_id: 42, full_name: 'Jan Kowalski', email: 'j@k.pl', groups: ['tk_aud'] }, c);
  assert.deepEqual(id, { externalId: '42', name: 'Jan Kowalski', email: 'j@k.pl', role: 'auditor' });
  assert.throws(() => identityFromClaims({ full_name: 'Bez ID' }, c), AuthError);
});

test('tryb jwt z kluczem publicznym RS256', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const pem = await exportSPKI(publicKey);
  const client = createSzoClient(cfg({ SZO_JWT_SECRET: '', SZO_JWT_PUBLIC_KEY: pem.replace(/\n/g, '\\n'), SZO_JWT_ALGORITHMS: 'RS256' }));
  const good = await new SignJWT({ name: 'RS' }).setProtectedHeader({ alg: 'RS256' }).setSubject('rs-1').setExpirationTime('5m').sign(privateKey);
  assert.equal((await client.verify(good)).externalId, 'rs-1');

  // token HS256 podpisany „kluczem publicznym” jako sekretem (atak na pomylenie algorytmów) musi być odrzucony
  const forged = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('hack').sign(new TextEncoder().encode(pem));
  await assert.rejects(client.verify(forged), AuthError);
  await assert.rejects(client.verify('to.nie.jwt'), AuthError);
  await assert.rejects(client.verify(''), AuthError);
});

test('tryb api: poprawna odpowiedź, 401, błąd sieci i nieaktywny token', async () => {
  const c = cfg({ SZO_AUTH_MODE: 'api', SZO_JWT_SECRET: '', SZO_VERIFY_URL: 'https://szo.example/api/verify', SZO_API_KEY: 'klucz' });
  let seen;
  const mock = (res) => createSzoClient(c, { fetchImpl: async (url, init) => { seen = { url, init }; if (res instanceof Error) throw res; return res; } });
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const ok = await mock(json(200, { active: true, user: { sub: 'api-1', name: 'API User', role: 'tk_admin' } })).verify('tok');
  assert.deepEqual(ok, { externalId: 'api-1', name: 'API User', email: null, role: 'administrator' });
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.equal(seen.init.headers['X-Api-Key'], 'klucz');

  await assert.rejects(mock(json(401, {})).verify('t'), (e) => e instanceof AuthError && e.status === 401);
  await assert.rejects(mock(json(500, {})).verify('t'), (e) => e.status === 502);
  await assert.rejects(mock(json(200, { active: false })).verify('t'), AuthError);
  await assert.rejects(mock(new Error('ECONNREFUSED')).verify('t'), (e) => e.status === 503);
});

test('konfiguracja: odrzuca niebezpieczne i niekompletne ustawienia', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', SZO_AUTH_MODE: 'dev', ...baseEnv }), /dev jest zabroniony/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', SZO_AUTH_MODE: 'jwt', SZO_JWT_SECRET: 'sekret-sekret-sekret' }), /SESSION_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', SZO_AUTH_MODE: 'jwt' }), /SZO_JWT_SECRET albo SZO_JWT_PUBLIC_KEY/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', SZO_AUTH_MODE: 'api' }), /SZO_VERIFY_URL/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', SZO_AUTH_MODE: 'dev', SZO_ROLE_MAP: '[1]' }), /SZO_ROLE_MAP/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', SZO_AUTH_MODE: 'dev', PORT: 'abc' }), /PORT/);
  assert.equal(loadConfig({ NODE_ENV: 'development', SZO_AUTH_MODE: 'dev' }).szo.mode, 'dev');
});

test('CSV: komórki zaczynające się od =,+,-,@ są zabezpieczone, cudzysłowy i średniki cytowane', () => {
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell('+48 123'), "'+48 123");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('zwykły tekst'), 'zwykły tekst');
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('linia1\nlinia2'), '"linia1\nlinia2"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(0), '0');
});

test('etykiety odpowiedzi w eksporcie', () => {
  assert.equal(answerLabel({ answerType: 'scale', answer: '3' }), '3 – w pełni');
  assert.equal(answerLabel({ answerType: 'ternary', answer: 'czesciowo' }), 'Częściowo');
  assert.equal(answerLabel({ answerType: 'scale', answer: 'nd' }), 'Nie dotyczy');
  assert.equal(answerLabel({ answerType: 'scale', answer: null }), 'Brak odpowiedzi');
});
