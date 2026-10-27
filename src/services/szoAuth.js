/**
 * Integracja z SZO (System Obsługi Organizacji).
 *
 * Tryby (SZO_AUTH_MODE):
 *   jwt – SZO wystawia token JWT; aplikacja weryfikuje podpis lokalnie (HS256 sekret lub RS/ES klucz publiczny).
 *   api – aplikacja pyta endpoint SZO (SZO_VERIFY_URL), czy token jest ważny, i dostaje dane użytkownika.
 *   dev – tylko lokalnie: bez SZO, formularz logowania testowego (zablokowane w produkcji przez config).
 *
 * Niezależnie od trybu wynik to znormalizowana tożsamość:
 *   { externalId, name, email, role }   (role = null, gdy SZO nie przekazuje rozpoznanej roli)
 */

const { jwtVerify, importSPKI } = require('jose');
const { ROLES, ROLE_PRIORITY } = require('../domain/constants');

class AuthError extends Error {
  constructor(message, { status = 401 } = {}) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

const getClaim = (claims, name) => (name ? claims[name] : undefined);

/** Zamienia surową wartość roli (string lub tablicę) z SZO na rolę aplikacji; najwyższy priorytet wygrywa. */
function resolveRole(rawRole, roleMap = {}) {
  const raw = Array.isArray(rawRole) ? rawRole : [rawRole];
  const known = new Set(Object.values(ROLES));
  const mapped = raw
    .filter((r) => typeof r === 'string' && r.trim() !== '')
    .map((r) => (Object.hasOwn(roleMap, r) ? roleMap[r] : r))
    .filter((r) => known.has(r));
  return ROLE_PRIORITY.find((r) => mapped.includes(r)) || null;
}

function identityFromClaims(claims, cfg) {
  const idValue = getClaim(claims, cfg.claims.id);
  if (idValue === undefined || idValue === null || String(idValue).trim() === '') {
    throw new AuthError('Token SZO nie zawiera identyfikatora użytkownika.');
  }
  const email = getClaim(claims, cfg.claims.email);
  const name = getClaim(claims, cfg.claims.name);
  return {
    externalId: String(idValue),
    name: String(name || email || idValue).slice(0, 200),
    email: email ? String(email).slice(0, 200) : null,
    role: resolveRole(getClaim(claims, cfg.claims.role), cfg.roleMap),
  };
}

function createSzoClient(cfg, { fetchImpl = globalThis.fetch } = {}) {
  let keyPromise;
  const getKey = () => {
    keyPromise ??= cfg.jwtPublicKey
      ? importSPKI(cfg.jwtPublicKey, cfg.jwtAlgorithms[0])
      : Promise.resolve(new TextEncoder().encode(cfg.jwtSecret));
    return keyPromise;
  };

  async function verifyJwt(token) {
    try {
      const { payload } = await jwtVerify(token, await getKey(), {
        algorithms: cfg.jwtAlgorithms,
        issuer: cfg.issuer,
        audience: cfg.audience,
      });
      return identityFromClaims(payload, cfg);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError('Token SZO jest nieprawidłowy lub wygasł.');
    }
  }

  async function verifyViaApi(token) {
    let res;
    try {
      res = await fetchImpl(cfg.verifyUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(cfg.apiKey ? { 'X-Api-Key': cfg.apiKey } : {}),
        },
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
    } catch {
      throw new AuthError('Usługa SZO jest niedostępna.', { status: 503 });
    }
    if (res.status === 401 || res.status === 403) throw new AuthError('SZO odrzuciło token.');
    if (!res.ok) throw new AuthError('Usługa SZO zwróciła błąd.', { status: 502 });

    let body;
    try { body = await res.json(); } catch { throw new AuthError('Niepoprawna odpowiedź SZO.', { status: 502 }); }
    if (body?.active === false || body?.valid === false) throw new AuthError('Token SZO jest nieaktywny.');
    return identityFromClaims(body?.user ?? body ?? {}, cfg);
  }

  return {
    mode: cfg.mode,
    async verify(token) {
      if (!token || typeof token !== 'string') throw new AuthError('Brak tokena.');
      if (cfg.mode === 'jwt') return verifyJwt(token);
      if (cfg.mode === 'api') return verifyViaApi(token);
      throw new AuthError('Weryfikacja tokenów SZO jest wyłączona (tryb dev).');
    },
  };
}

module.exports = { createSzoClient, identityFromClaims, resolveRole, AuthError };
