/**
 * Logowanie przez SZO: OAuth 2.0 Authorization Code + PKCE (S256), ten sam przepływ, z którego korzystają
 * aplikacje zewnętrzne SZO (EZD Client, Wdrożenie MSUES).
 *
 *   1. /auth/szo/start    → przekierowanie do SZO (logowanie Microsoft 365 + zgoda), z `state` i `code_challenge`
 *   2. SZO                → powrót na /auth/szo/callback?code=…&state=…
 *   3. /auth/szo/callback → wymiana kodu na token (POST desktop_token.php), odczyt użytkownika i uprawnień,
 *                           sprawdzenie wymaganego scope'u, UNIEWAŻNIENIE tokenu SZO (potrzebujemy tylko tożsamości)
 *                           i wystawienie własnej sesji.
 *
 * `state` i `code_verifier` żyją w krótkotrwałym, podpisanym cookie (HttpOnly, SameSite=Lax), jednorazowo.
 */
const crypto = require('node:crypto');
const { SignJWT, jwtVerify } = require('jose');
const { AuthError } = require('./szoAuth');

const STATE_COOKIE = 'tk_szo_state';
const STATE_TTL_SECONDS = 600;
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function createSzoPkceClient(config, { fetchImpl = globalThis.fetch } = {}) {
  const cfg = config.szo;
  const key = new TextEncoder().encode(config.sessionSecret);
  const base = (cfg.baseUrl || '').replace(/\/$/, '');
  const redirectUri = `${(config.appUrl || '').replace(/\/$/, '')}/auth/szo/callback`;
  const timeout = () => AbortSignal.timeout(cfg.timeoutMs);

  async function call(path, { token, body } = {}) {
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: timeout(),
      });
    } catch {
      throw new AuthError('Usługa SZO jest niedostępna.', { status: 503 });
    }
    let json = null;
    try { json = await res.json(); } catch { /* brak JSON */ }
    return { res, json };
  }

  return {
    redirectUri,

    /** Przygotowuje przekierowanie do SZO i ustawia cookie z `state` oraz `code_verifier`. */
    async start(res) {
      const state = b64url(crypto.randomBytes(24));
      const verifier = b64url(crypto.randomBytes(48));                       // 64 znaki [A-Za-z0-9_-]
      const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
      const jwt = await new SignJWT({ state, verifier }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${STATE_TTL_SECONDS}s`).sign(key);
      res.cookie(STATE_COOKIE, jwt, { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: STATE_TTL_SECONDS * 1000, path: '/auth/szo' });
      const query = new URLSearchParams({
        redirect_uri: redirectUri, state, code_challenge: challenge, scope: cfg.scope, device: 'Tajemniczy Klient',
      });
      return `${base}/auth/desktop_login.php?${query}`;
    },

    /**
     * Obsługuje powrót z SZO. Zwraca tożsamość { externalId, name, email, role } albo rzuca AuthError.
     * Cookie ze `state` jest zawsze czyszczone (jednorazowe).
     */
    async finish(req, res) {
      const stored = req.cookies?.[STATE_COOKIE];
      res.clearCookie(STATE_COOKIE, { path: '/auth/szo' });
      let saved;
      try { ({ payload: saved } = await jwtVerify(stored, key, { algorithms: ['HS256'] })); } catch { throw new AuthError('Wygasła próba logowania. Spróbuj ponownie.'); }

      const { state, code, error } = req.query;
      if (typeof state !== 'string' || state.length !== saved.state.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(saved.state))) {
        throw new AuthError('Nieprawidłowy parametr state.');
      }
      if (error) throw new AuthError(error === 'access_denied' ? 'Odmówiono dostępu w SZO.' : 'SZO zwróciło błąd logowania.', { status: 403 });
      if (typeof code !== 'string' || !/^[0-9a-f]{64}$/.test(code)) throw new AuthError('Nieprawidłowy kod z SZO.');

      const { res: tokenRes, json } = await call('/api/v1/desktop_token.php', {
        body: { grant_type: 'authorization_code', code, code_verifier: saved.verifier },
      });
      if (!tokenRes.ok || !json?.access_token) {
        throw new AuthError(tokenRes.status === 403 ? 'Twoje konto nie ma dostępu do aplikacji (poproś o nadanie uprawnienia w SZO).' : 'SZO odrzuciło logowanie.', { status: tokenRes.status === 403 ? 403 : 401 });
      }
      const token = json.access_token;
      // Potrzebujemy wyłącznie tożsamości: token SZO unieważniamy od razu (błąd unieważnienia nie przerywa logowania).
      const revoke = () => call('/api/v1/desktop_token.php?action=logout', { token }).catch(() => {});

      const scopes = Array.isArray(json.scopes) ? json.scopes : [];
      if (!scopes.includes(cfg.scope)) { await revoke(); throw new AuthError('Konto nie ma uprawnienia do aplikacji.', { status: 403 }); }
      const u = json.user || {};
      if (u.id === undefined || u.id === null || String(u.id).trim() === '') { await revoke(); throw new AuthError('SZO nie zwróciło identyfikatora użytkownika.'); }
      await revoke();

      const email = u.email ? String(u.email).trim().toLowerCase() : null;
      return {
        externalId: `szo:${u.id}`,
        name: String(u.name || email || `SZO ${u.id}`).slice(0, 200),
        email,
        // Role w aplikacji nadaje administrator; wyjątek: adresy z ADMIN_EMAILS zawsze są administratorami.
        role: email && cfg.adminEmails.includes(email) ? 'administrator' : null,
      };
    },
  };
}

module.exports = { createSzoPkceClient, STATE_COOKIE };
