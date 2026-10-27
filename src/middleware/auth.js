const { AuthError } = require('../services/szoAuth');

const wantsJson = (req) => req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json';

/**
 * Ustala użytkownika żądania:
 *  1) nagłówek `Authorization: Bearer <token SZO>` – weryfikowany przez SZO przy każdym żądaniu,
 *  2) cookie sesji wystawione po zalogowaniu przez SZO.
 * Konto wyłączone w aplikacji (active = 0) jest traktowane jak brak logowania.
 */
function attachUser({ szo, users, sessions }) {
  return async (req, res, next) => {
    try {
      req.user = null;
      const header = req.get('authorization') || '';
      const bearer = /^Bearer\s+(\S+)$/i.exec(header);

      if (bearer) {
        const identity = await szo.verify(bearer[1]);
        const user = users.upsertFromIdentity(identity);
        req.user = user.active ? user : null;
        req.authVia = 'bearer';
      } else {
        const userId = await sessions.read(req);
        const user = userId ? users.findById(userId) : null;
        req.user = user?.active ? user : null;
        req.authVia = 'session';
      }
      res.locals.currentUser = req.user;
      next();
    } catch (err) {
      if (err instanceof AuthError) {
        req.user = null;
        res.locals.currentUser = null;
        req.authError = err;
        return next();
      }
      next(err);
    }
  };
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return res.status(req.authError?.status || 401).json({ error: req.authError?.message || 'Wymagane logowanie.' });
  return res.redirect(303, '/login');
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (roles.includes(req.user.role)) return next();
    const err = new Error('Brak uprawnień do tej strony.');
    err.status = 403;
    return next(err);
  };
}

/**
 * Ochrona przed CSRF dla żądań zmieniających dane autoryzowanych cookie:
 * Origin (lub Sec-Fetch-Site) musi wskazywać ten sam serwer. Żądania z nagłówkiem Bearer są wyłączone.
 */
function sameOriginOnly(cfg) {
  const unsafe = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  return (req, res, next) => {
    if (!unsafe.has(req.method) || req.authVia === 'bearer') return next();
    const origin = req.get('origin');
    const fetchSite = req.get('sec-fetch-site');
    let ok;
    if (fetchSite) {
      // Nagłówek ustawiany przez przeglądarkę, którego strona nie może podrobić; działa też za proxy
      // i przy `Origin: null` (tak przeglądarki oznaczają POST, gdy Referrer-Policy to no-referrer).
      ok = fetchSite === 'same-origin' || fetchSite === 'none';
    } else if (origin) {
      try {
        const o = new URL(origin);
        ok = o.host === req.get('host') || (cfg.appUrl && o.origin === new URL(cfg.appUrl).origin);
      } catch { ok = false; }
    } else {
      ok = true; // klienci bez nagłówków (curl, testy) nie niosą ciasteczek przeglądarki
    }
    if (ok) return next();
    const err = new Error('Żądanie z innego źródła zostało odrzucone.');
    err.status = 403;
    return next(err);
  };
}

module.exports = { attachUser, requireAuth, requireRole, sameOriginOnly };
