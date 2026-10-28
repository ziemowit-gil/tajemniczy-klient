const { szoKeySchema, parseForm } = require('../validation/schemas');

/** Ustawienia integracji z SZO: wklejanie, sprawdzanie i usuwanie klucza API (wartość nigdy nie wraca do przeglądarki). */
function createSettingsController({ settings, szoDirectory, config }) {
  const view = (extra = {}) => ({
    title: 'Integracja z SZO', info: settings.szoApiKeyInfo(), szoMode: config.szo.mode === 'szo', baseUrl: config.szo.baseUrl,
    mailMode: config.mail.mode, errors: {}, results: null, ...extra,
  });
  const summarize = (r) => `Import użytkowników: ${r.users.message} Wysyłka e-mail: ${r.mail.message}`;

  return {
    show: (req, res) => res.render('settings/szo', view()),

    /** Zapis klucza (zaszyfrowanego) i od razu sprawdzenie, co ten klucz potrafi. */
    async save(req, res) {
      const { ok, errors } = parseForm(szoKeySchema, req.body);
      if (!ok) return res.status(422).render('settings/szo', view({ errors }));   // wpisanej wartości nie odsyłamy do formularza
      settings.setSecret(settings.SZO_API_KEY, req.body.apiKey.trim(), req.user.id);
      const results = await szoDirectory.check();
      res.flash(results.users.ok || results.mail.ok ? 'success' : 'error', `Zapisano klucz API. ${summarize(results)}`);
      return res.redirect(303, '/settings/szo');
    },

    async check(req, res) {
      res.render('settings/szo', view({ results: await szoDirectory.check() }));
    },

    clear(req, res) {
      const removed = settings.clear(settings.SZO_API_KEY);
      const info = settings.szoApiKeyInfo();
      res.flash('success', removed
        ? `Usunięto klucz zapisany w panelu.${info.source === 'env' ? ' Aplikacja używa teraz klucza z pliku .env.' : ' Nie ma już żadnego klucza API.'}`
        : 'W panelu nie było zapisanego klucza.');
      res.redirect(303, '/settings/szo');
    },
  };
}

module.exports = { createSettingsController };
