const { z } = require('zod');
const { AuthError } = require('../services/szoAuth');
const { ROLES } = require('../domain/constants');
const { parseForm } = require('../validation/schemas');

const devLoginSchema = z.object({
  name: z.string().trim().min(1, 'Podaj imię i nazwisko').max(100),
  email: z.string().trim().max(200).optional(),
  role: z.enum(Object.values(ROLES), { error: 'Wybierz rolę' }),
});

function createAuthController({ config, szo, szoPkce, users, sessions, notifier }) {
  const ssoEnabled = config.szo.mode === 'jwt' || config.szo.mode === 'api';

  return {
    showLogin(req, res) {
      if (req.user) return res.redirect(303, '/');
      res.render('login', {
        title: 'Logowanie',
        mode: config.szo.mode,
        loginUrl: config.szo.loginUrl,
        errors: {},
        values: {},
        demoUsers: config.szo.mode === 'dev' ? users.list().filter((u) => u.active && u.external_id.startsWith('dev:')) : [],
        authError: req.query.error === 'denied'
          ? 'Twoje konto nie ma dostępu do aplikacji. Poproś administratora SZO o nadanie uprawnienia „Tajemniczy Klient”.'
          : req.query.error ? 'Logowanie przez SZO nie powiodło się. Spróbuj ponownie.' : null,
      });
    },

    /** Powrót z SZO: token w query (GET) albo w formularzu (POST). Po weryfikacji wystawiamy własną sesję. */
    async szoCallback(req, res) {
      if (!ssoEnabled) return res.redirect(303, '/login');
      const token = req.body?.token || req.query.token;
      try {
        const identity = await szo.verify(token);
        const user = users.upsertFromIdentity(identity);
        if (!user.active) throw new AuthError('Konto jest wyłączone.', { status: 403 });
        await sessions.issue(res, user.id);
        return res.redirect(303, '/');
      } catch (err) {
        if (!(err instanceof AuthError)) throw err;
        return res.redirect(303, '/login?error=1');
      }
    },

    /** Tryb szo: przekierowanie do SZO (OAuth + PKCE). */
    async szoStart(req, res) {
      if (config.szo.mode !== 'szo') return res.redirect(303, '/login');
      return res.redirect(303, await szoPkce.start(res));
    },

    /** Tryb szo: powrót z SZO. Konto nowego użytkownika dostaje rolę domyślną; role nadaje administrator. */
    async szoReturn(req, res) {
      if (config.szo.mode !== 'szo') return res.redirect(303, '/login');
      try {
        const identity = await szoPkce.finish(req, res);
        const user = users.upsertFromIdentity(identity);
        if (!user.active) throw new AuthError('Konto jest wyłączone.', { status: 403 });
        await sessions.issue(res, user.id);
        return res.redirect(303, '/');
      } catch (err) {
        if (!(err instanceof AuthError)) throw err;
        return res.redirect(303, `/login?error=${err.status === 403 ? 'denied' : '1'}`);
      }
    },

    /** Tylko tryb dev: logowanie testowe bez SZO. */
    async devLogin(req, res) {
      if (config.szo.mode !== 'dev' || config.isProd) return res.status(404).render('error', { title: 'Nie znaleziono', status: 404, message: 'Nie znaleziono strony.' });
      const { ok, data, errors } = parseForm(devLoginSchema, req.body);
      if (!ok) return res.status(422).render('login', { title: 'Logowanie', mode: 'dev', loginUrl: null, errors, values: req.body, authError: null });
      const slug = data.email || data.name.toLowerCase().replace(/\s+/g, '.');
      const user = users.upsertFromIdentity({ externalId: `dev:${slug}`, name: data.name, email: data.email || null, role: data.role });
      await sessions.issue(res, user.id);
      return res.redirect(303, '/');
    },

    showAccount(req, res) {
      res.render('account', { title: 'Moje konto', mailEnabled: notifier.enabled, user: users.findById(req.user.id) });
    },

    updateAccount(req, res) {
      users.setNotify(req.user.id, req.body.notifyEmail === 'on');
      res.flash('success', 'Zapisano ustawienia konta.');
      res.redirect(303, '/account');
    },

    logout(req, res) {
      sessions.clear(res);
      res.redirect(303, '/login');
    },
  };
}

module.exports = { createAuthController };
