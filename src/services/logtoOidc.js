/**
 * Logowanie jednokrotne przez Logto (logto.feer.org.pl): OpenID Connect, Authorization Code + PKCE (S256),
 * klient poufny (client_secret_basic).
 *
 *   1. /auth/logto/start    → przekierowanie do Logto z `state`, `nonce` i `code_challenge`
 *   2. Logto                → powrót na /auth/logto/callback?code=…&state=…
 *   3. /auth/logto/callback → wymiana kodu na tokeny, weryfikacja id_token (podpis z JWKS, issuer, audience, nonce),
 *                             tożsamość z claimów (e-mail z userinfo, gdy nie ma go w id_token) i własna sesja.
 *
 * `state`, `nonce` i `code_verifier` żyją w krótkotrwałym, podpisanym cookie (HttpOnly, SameSite=Lax), jednorazowo.
 * Tokenów Logto nie przechowujemy: potrzebna jest tylko tożsamość.
 */
const crypto = require('node:crypto');
const { SignJWT, jwtVerify, createRemoteJWKSet } = require('jose');
const { AuthError } = require('./szoAuth');

const STATE_COOKIE = 'tk_logto_state';
const STATE_TTL_SECONDS = 600;
const COOKIE_PATH = '/auth/logto';
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sameString = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function createLogtoClient(config, { fetchImpl = globalThis.fetch, jwks: jwksOverride } = {}) {
  const cfg = config.logto;
  const key = new TextEncoder().encode(config.sessionSecret);
  const redirectUri = `${(config.appUrl || '').replace(/\/$/, '')}/auth/logto/callback`;
  const timeout = () => AbortSignal.timeout(config.szo.timeoutMs);
  let discovery = null;
  let jwks = jwksOverride || null;

  async function getJson(url, init = {}) {
    let res;
    try {
      res = await fetchImpl(url, { ...init, headers: { Accept: 'application/json', ...(init.headers || {}) }, signal: timeout() });
    } catch {
      throw new AuthError('Usługa logowania (Logto) jest niedostępna.', { status: 503 });
    }
    let json = null;
    try { json = await res.json(); } catch { /* brak JSON */ }
    return { res, json };
  }

  async function meta() {
    if (discovery) return discovery;
    const { res, json } = await getJson(`${cfg.endpoint}/oidc/.well-known/openid-configuration`);
    if (!res.ok || !json?.authorization_endpoint || !json?.token_endpoint || !json?.issuer || !json?.jwks_uri) {
      throw new AuthError('Nie udało się odczytać konfiguracji Logto.', { status: 503 });
    }
    discovery = json;
    if (!jwks) jwks = createRemoteJWKSet(new URL(json.jwks_uri), { timeoutDuration: config.szo.timeoutMs });
    return discovery;
  }

  return {
    redirectUri,

    /** Przygotowuje przekierowanie do Logto i ustawia cookie ze `state`, `nonce` i `code_verifier`. */
    async start(res) {
      const m = await meta();
      const state = b64url(crypto.randomBytes(24));
      const nonce = b64url(crypto.randomBytes(24));
      const verifier = b64url(crypto.randomBytes(48));
      const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
      const jwt = await new SignJWT({ state, nonce, verifier }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${STATE_TTL_SECONDS}s`).sign(key);
      res.cookie(STATE_COOKIE, jwt, { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: STATE_TTL_SECONDS * 1000, path: COOKIE_PATH });
      const query = new URLSearchParams({
        client_id: cfg.appId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid profile email',
        state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
      });
      // Bez `prompt`: istniejąca sesja Logto (np. po logowaniu do SZO lub chmury) loguje bez ponownego podawania hasła.
      return `${m.authorization_endpoint}?${query}`;
    },

    /**
     * Obsługuje powrót z Logto. Zwraca tożsamość { externalId, name, email, emailVerified, role } albo rzuca AuthError.
     * Cookie ze `state` jest zawsze czyszczone (jednorazowe).
     */
    async finish(req, res) {
      const stored = req.cookies?.[STATE_COOKIE];
      res.clearCookie(STATE_COOKIE, { path: COOKIE_PATH });
      let saved;
      try { ({ payload: saved } = await jwtVerify(stored, key, { algorithms: ['HS256'] })); } catch { throw new AuthError('Wygasła próba logowania. Spróbuj ponownie.'); }

      const { state, code, error } = req.query;
      if (!sameString(state, saved.state)) throw new AuthError('Nieprawidłowy parametr state.');
      if (error) throw new AuthError(error === 'access_denied' ? 'Odmówiono dostępu w Logto.' : 'Logto zwróciło błąd logowania.', { status: 403 });
      if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(code)) throw new AuthError('Nieprawidłowy kod z Logto.');

      const m = await meta();
      const basic = Buffer.from(`${encodeURIComponent(cfg.appId)}:${encodeURIComponent(cfg.appSecret)}`).toString('base64');
      const { res: tokenRes, json } = await getJson(m.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: saved.verifier }).toString(),
      });
      if (!tokenRes.ok || typeof json?.id_token !== 'string') throw new AuthError('Logto odrzuciło logowanie.');

      let claims;
      try {
        ({ payload: claims } = await jwtVerify(json.id_token, jwks, { issuer: m.issuer, audience: cfg.appId }));
      } catch {
        throw new AuthError('Nieprawidłowy token tożsamości z Logto.');
      }
      if (!sameString(claims.nonce, saved.nonce)) throw new AuthError('Nieprawidłowy parametr nonce.');
      if (typeof claims.sub !== 'string' || !claims.sub.trim()) throw new AuthError('Logto nie zwróciło identyfikatora użytkownika.');

      // E-mail i imię bywają tylko w userinfo (zależnie od ustawień tokenu w Logto).
      if ((!claims.email || !claims.name) && m.userinfo_endpoint && typeof json.access_token === 'string') {
        const { res: infoRes, json: info } = await getJson(m.userinfo_endpoint, { headers: { Authorization: `Bearer ${json.access_token}` } });
        if (infoRes.ok && info?.sub === claims.sub) claims = { ...info, ...claims, email: claims.email || info.email, email_verified: claims.email ? claims.email_verified : info.email_verified, name: claims.name || info.name };
      }

      const email = typeof claims.email === 'string' && claims.email.trim() ? claims.email.trim().toLowerCase() : null;
      const name = [claims.name, [claims.given_name, claims.family_name].filter(Boolean).join(' '), claims.username, email]
        .find((v) => typeof v === 'string' && v.trim());
      return {
        externalId: `logto:${claims.sub}`,
        name: String(name || `Logto ${claims.sub}`).trim().slice(0, 200),
        email,
        // Logto ustawia email_verified dla adresu głównego; brak claimu traktujemy jak niepotwierdzony adres.
        emailVerified: Boolean(email) && claims.email_verified === true,
        role: email && claims.email_verified === true && config.szo.adminEmails.includes(email) ? 'administrator' : null,
      };
    },
  };
}

module.exports = { createLogtoClient, STATE_COOKIE };
