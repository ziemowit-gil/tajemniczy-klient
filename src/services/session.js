const { SignJWT, jwtVerify } = require('jose');

const COOKIE_NAME = 'tk_session';
const ISSUER = 'tajemniczy-klient';

/** Sesja = podpisany (HS256) cookie z id użytkownika; stan użytkownika jest za każdym razem czytany z bazy. */
function createSessionService(cfg) {
  const key = new TextEncoder().encode(cfg.sessionSecret);

  return {
    cookieName: COOKIE_NAME,

    async issue(res, userId) {
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(String(userId))
        .setIssuer(ISSUER)
        .setIssuedAt()
        .setExpirationTime(`${cfg.sessionTtlSeconds}s`)
        .sign(key);
      res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: cfg.isProd,
        maxAge: cfg.sessionTtlSeconds * 1000,
        path: '/',
      });
    },

    async read(req) {
      const token = req.cookies?.[COOKIE_NAME];
      if (!token) return null;
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], issuer: ISSUER });
        const id = Number(payload.sub);
        return Number.isInteger(id) ? id : null;
      } catch {
        return null;
      }
    },

    clear(res) {
      res.clearCookie(COOKIE_NAME, { path: '/' });
    },
  };
}

module.exports = { createSessionService };
