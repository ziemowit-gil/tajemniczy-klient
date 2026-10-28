const { ROLES } = require('../domain/constants');
const { DomainError } = require('../services/audits');
const { httpError } = require('./helpers');

const ADMIN_ONLY = new Set(['object', 'scenario']);
const safeNext = (v, fallback) => (typeof v === 'string' && /^\/(?!\/)[\w\-/?=&%.]*$/.test(v) ? v : fallback);

/** Archiwizacja, przywracanie i trwałe usuwanie: koordynator tylko audyty i oceny ze swoich obiektów, reszta tylko administrator. */
function createArchiveController({ archive, objects }) {
  const guard = (req, kind, id, { purge = false } = {}) => {
    if (!archive.KINDS[kind]) throw httpError(404, 'Nieznany rodzaj danych.');
    const role = req.user.role;
    if (purge && role !== ROLES.ADMIN) throw httpError(403, 'Trwale usuwać może tylko administrator.');
    if (ADMIN_ONLY.has(kind) && role !== ROLES.ADMIN) throw httpError(403, 'Brak uprawnień.');
    const row = archive.get(kind, id);
    if (!row) throw httpError(404, 'Nie znaleziono pozycji.');
    if (role === ROLES.COORDINATOR && !objects.isCoordinatedBy(row.object_id, req.user.id)) throw httpError(404, 'Nie znaleziono pozycji.');
    return row;
  };
  const run = (action, success, { purge = false, fallback = '/archive' } = {}) => async (req, res) => {
    const { kind } = req.params; const id = Number(req.params.id);
    guard(req, kind, id, { purge });
    try {
      await action(kind, id, req.user);
      res.flash('success', success);
      return res.redirect(303, safeNext(req.body?.next, fallback));
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      res.flash('error', err.message);
      return res.redirect(303, safeNext(req.body?.next, fallback));
    }
  };

  return {
    index(req, res) {
      const isAdmin = req.user.role === ROLES.ADMIN;
      const scope = (r) => isAdmin || objects.isCoordinatedBy(r.object_id, req.user.id);
      res.render('archive/index', {
        title: 'Archiwum', isAdmin,
        sections: [
          { kind: 'audit', title: 'Audyty obiektów', href: (r) => `/audits/${r.id}`, rows: archive.listArchived('audit', scope) },
          { kind: 'review', title: 'Oceny „Dostępność kształcenia”', href: (r) => `/office/${r.id}`, rows: archive.listArchived('review', scope) },
          ...(isAdmin ? [
            { kind: 'object', title: 'Obiekty i uczelnie', href: (r) => `/objects/${r.id}/edit`, rows: archive.listArchived('object') },
            { kind: 'scenario', title: 'Scenariusze', href: (r) => `/scenarios/${r.id}`, rows: archive.listArchived('scenario') },
          ] : []),
        ],
      });
    },
    archive: run((k, id, actor) => archive.archive(k, id, actor), 'Przeniesiono do archiwum.', { fallback: '/archive' }),
    restore: run((k, id, actor) => archive.restore(k, id, actor), 'Przywrócono z archiwum.'),
    purge: run((k, id, actor) => archive.purge(k, id, actor), 'Usunięto trwale.', { purge: true }),
    log: (req, res) => res.render('archive/log', { title: 'Dziennik operacji', entries: archive.recent(300), kinds: archive.KINDS }),
  };
}

module.exports = { createArchiveController };
