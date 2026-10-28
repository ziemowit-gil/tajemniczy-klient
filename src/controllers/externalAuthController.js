const { ExternalAuthError } = require('../services/externalAuth');

/** Logowanie użytkowników zewnętrznych: e-mail + hasło, potem kod SMS; ustawianie hasła z linku z e-maila. */
function createExternalAuthController({ externalAuth, sessions, config, enabled }) {
  const loginView = (extra = {}) => ({
    title: 'Logowanie', mode: config.szo.mode, loginUrl: config.szo.loginUrl, errors: {}, values: {}, demoUsers: [],
    authError: null, externalEnabled: true, externalError: null, method: 'external', ...extra,
  });
  const GENERIC = 'Nieprawidłowy e-mail lub hasło albo konto jest tymczasowo zablokowane.';

  return {
    async login(req, res) {
      if (!enabled()) return res.redirect(303, '/login');
      const email = String(req.body.email || '').slice(0, 200);
      const user = externalAuth.authenticate(email, req.body.password);
      if (!user) return res.status(401).render('login', loginView({ externalError: GENERIC, values: { email } }));
      try {
        const challenge = await externalAuth.startChallenge(user);
        await sessions.issuePending(res, { userId: user.id, challengeId: challenge.id });
        return res.redirect(303, '/login/verify');
      } catch (err) {
        if (!(err instanceof ExternalAuthError)) throw err;
        return res.status(err.code === 'rate' ? 429 : 503).render('login', loginView({ externalError: err.message, values: { email } }));
      }
    },

    async showVerify(req, res) {
      const pending = await sessions.readPending(req);
      const info = pending && externalAuth.challengeInfo(pending.challengeId, pending.userId);
      if (!info) { sessions.clearPending(res); res.flash('error', 'Sesja weryfikacji wygasła. Zaloguj się ponownie.'); return res.redirect(303, '/login'); }
      return res.render('verify', { title: 'Weryfikacja SMS', info, error: null });
    },

    async verify(req, res) {
      const pending = await sessions.readPending(req);
      if (!pending) { res.flash('error', 'Sesja weryfikacji wygasła. Zaloguj się ponownie.'); return res.redirect(303, '/login'); }
      try {
        const user = externalAuth.verify(pending.challengeId, pending.userId, req.body.code);
        sessions.clearPending(res);
        await sessions.issue(res, user.id, user.role);
        return res.redirect(303, '/');
      } catch (err) {
        if (!(err instanceof ExternalAuthError)) throw err;
        if (err.code === 'wrong') {
          const info = externalAuth.challengeInfo(pending.challengeId, pending.userId);
          return res.status(422).render('verify', { title: 'Weryfikacja SMS', info, error: err.message });
        }
        sessions.clearPending(res);
        res.flash('error', err.message);
        return res.redirect(303, '/login');
      }
    },

    async resend(req, res) {
      const pending = await sessions.readPending(req);
      if (!pending) { res.flash('error', 'Sesja weryfikacji wygasła. Zaloguj się ponownie.'); return res.redirect(303, '/login'); }
      try {
        await externalAuth.resend(pending.challengeId, pending.userId);
        res.flash('success', 'Wysłaliśmy nowy kod SMS. Poprzedni przestał działać.');
      } catch (err) {
        if (!(err instanceof ExternalAuthError)) throw err;
        if (['expired', 'rate'].includes(err.code)) { sessions.clearPending(res); res.flash('error', err.message); return res.redirect(303, '/login'); }
        res.flash('error', err.message);
      }
      return res.redirect(303, '/login/verify');
    },

    showSetPassword(req, res) {
      const found = externalAuth.userForToken(String(req.query.token || ''));
      if (!found) return res.status(400).render('set-password', { title: 'Ustaw hasło', valid: false, token: '', person: null, error: null });
      return res.render('set-password', { title: 'Ustaw hasło', valid: true, token: String(req.query.token), person: found.user, error: null });
    },

    setPassword(req, res) {
      const token = String(req.body.token || '');
      try {
        externalAuth.setPassword(token, String(req.body.password ?? ''), String(req.body.password2 ?? ''));
        res.flash('success', 'Hasło zostało ustawione. Zaloguj się e-mailem, hasłem i kodem SMS.');
        return res.redirect(303, '/login');
      } catch (err) {
        if (!(err instanceof ExternalAuthError)) throw err;
        const found = externalAuth.userForToken(token);
        return res.status(err.code === 'token' ? 400 : 422).render('set-password', { title: 'Ustaw hasło', valid: Boolean(found), token, person: found?.user ?? null, error: err.message });
      }
    },
  };
}

module.exports = { createExternalAuthController };
