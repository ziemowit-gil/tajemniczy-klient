const { DECLARATION_TITLE, DECLARATION_PARAGRAPHS } = require('../domain/declaration');

/** Oświadczenie o poufności składane elektronicznie po zalogowaniu (jednorazowo dla danej wersji treści). */
function createDeclarationController({ declarations }) {
  const view = (req, extra = {}) => ({
    title: DECLARATION_TITLE, heading: DECLARATION_TITLE, paragraphs: DECLARATION_PARAGRAPHS, person: req.user, hideNav: true, errors: {}, ...extra,
  });

  return {
    show(req, res) {
      if (declarations.isAccepted(req.user.id)) return res.redirect(303, '/');
      return res.render('declaration', view(req));
    },

    accept(req, res) {
      if (req.body.accept !== 'on') {
        return res.status(422).render('declaration', view(req, { errors: { accept: 'Zaznacz pole, aby złożyć oświadczenie.' } }));
      }
      declarations.accept(req.user);
      res.flash('success', 'Oświadczenie zostało złożone. Dziękujemy.');
      return res.redirect(303, '/');
    },
  };
}

module.exports = { createDeclarationController };
