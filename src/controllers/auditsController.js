const { AREA_LABELS, ROLES, SCENARIO_AREAS } = require('../domain/constants');
const { STATUS, STATUS_LABELS, isEditable } = require('../domain/workflow');
const { ANSWER_OPTIONS } = require('../domain/scoring');
const { DomainError } = require('../services/audits');
const {
  auditCreateSchema, answersSchema, reviewSchema, returnSchema, parseForm,
} = require('../validation/schemas');
const { paramId, httpError, collectAnswers } = require('./helpers');

function createAuditsController({ audits, objects, users, catalog, attachments, reports }) {
  const viewData = (req, audit, extra = {}) => {
    const items = audits.items(audit.id);
    const files = attachments.listForAudit(audit.id);
    const preview = reports.forAudit(audit);
    const groups = [];
    for (const item of items) {
      let area = groups.find((g) => g.area === item.area);
      if (!area) groups.push((area = { area: item.area, label: AREA_LABELS[item.area], categories: [] }));
      let cat = area.categories.find((c) => c.name === item.category);
      if (!cat) area.categories.push((cat = { name: item.category, items: [] }));
      cat.items.push({ ...item, files: files.get(item.id) || [] });
    }
    return {
      title: `Audyt: ${audit.object_name}`,
      audit, groups, summary: preview.summary, statusLabels: STATUS_LABELS, answerOptions: ANSWER_OPTIONS,
      canEdit: audits.canEdit(req.user, audit),
      canReview: audit.status === STATUS.SUBMITTED && [ROLES.COORDINATOR, ROLES.ADMIN].includes(req.user.role),
      canExport: req.user.role !== ROLES.AUDITOR || audit.auditor_id === req.user.id,
      isAdmin: req.user.role === ROLES.ADMIN,
      problems: {}, errors: {}, ...extra,
    };
  };

  return {
    /** Ładuje audyt i sprawdza dostęp; dla cudzych audytów zwraca 404, by nie ujawniać ich istnienia. */
    load(req, res, next) {
      const audit = audits.get(paramId(req));
      if (!audit || !audits.canView(req.user, audit)) return next(httpError(404, 'Nie znaleziono audytu.'));
      req.audit = audit;
      next();
    },

    /** Uruchamiane przed zapisem plików na dysk. */
    ensureEditable(req, res, next) {
      if (!audits.canEdit(req.user, req.audit)) {
        return next(httpError(403, isEditable(req.audit.status) ? 'Ten audyt jest przypisany do kogoś innego.' : 'Audyt został złożony i nie można go edytować.'));
      }
      next();
    },

    index(req, res) {
      const status = Object.hasOwn(STATUS_LABELS, req.query.status) ? req.query.status : undefined;
      res.render('audits/index', { title: req.user.role === ROLES.AUDITOR ? 'Moje audyty' : 'Audyty', audits: audits.list(req.user, { status }), statusLabels: STATUS_LABELS, filter: status || '' });
    },

    newForm(req, res) {
      res.render('audits/new', {
        title: 'Przydziel audyt', errors: {}, values: { objectId: req.query.objectId },
        objects: objects.list(), auditors: users.listByRole(ROLES.AUDITOR), scenarios: catalog.scenarios.list({ onlyActive: true }), areaLabels: SCENARIO_AREAS,
      });
    },

    create(req, res) {
      const form = () => ({ objects: objects.list(), auditors: users.listByRole(ROLES.AUDITOR), scenarios: catalog.scenarios.list({ onlyActive: true }), areaLabels: SCENARIO_AREAS });
      const { ok, data, errors } = parseForm(auditCreateSchema, req.body);
      if (!ok) return res.status(422).render('audits/new', { title: 'Przydziel audyt', errors, values: req.body, ...form() });
      try {
        const audit = audits.create(data, req.user.id);
        res.flash('success', `Przydzielono audyt obiektu „${audit.object_name}” audytorowi ${audit.auditor_name}.`);
        return res.redirect(303, `/audits/${audit.id}`);
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        return res.status(422).render('audits/new', { title: 'Przydziel audyt', errors: { _form: err.message }, values: req.body, ...form() });
      }
    },

    show: (req, res) => res.render('audits/show', viewData(req, req.audit)),

    /** Zapis formularza (przycisk „Zapisz”) lub zapis + złożenie (przycisk „Złóż audyt”). */
    async save(req, res) {
      const audit = req.audit;
      const back = `/audits/${audit.id}`;
      const { ok, data, errors } = parseForm(answersSchema, { generalNotes: req.body.generalNotes, answers: collectAnswers(req.body) });
      if (!ok) {
        await attachments.discard(req.files);
        res.flash('error', `Formularz zawiera błędy: ${Object.values(errors)[0]}`);
        return res.redirect(303, back);
      }
      try {
        audits.saveAnswers(audit, data);
      } catch (err) {
        await attachments.discard(req.files);
        if (!(err instanceof DomainError)) throw err;
        res.flash('error', err.message);
        return res.redirect(303, back);
      }
      const { rejected } = await attachments.register(req.files, { auditId: audit.id, userId: req.user.id });

      if (req.body.intent === 'submit') {
        try {
          audits.submit(audits.get(audit.id), req.user);
          res.flash('success', 'Audyt został złożony i oczekuje na weryfikację koordynatora.');
          return res.redirect(303, back);
        } catch (err) {
          if (!(err instanceof DomainError)) throw err;
          const problems = Object.fromEntries((err.details || []).map((p) => [p.itemId, p.message]));
          return res.status(422).render('audits/show', viewData(req, audits.get(audit.id), {
            problems, errors: { _form: `${err.message} Uzupełnij zaznaczone kryteria (${Object.keys(problems).length}).` },
          }));
        }
      }
      res.flash(rejected.length ? 'error' : 'success',
        rejected.length ? `Zapisano odpowiedzi, ale odrzucono pliki o niepoprawnym formacie: ${rejected.join(', ')}.` : 'Zapisano odpowiedzi.');
      return res.redirect(303, back);
    },

    approve(req, res) {
      const { data } = parseForm(reviewSchema, req.body);
      try {
        audits.approve(req.audit, req.user, data?.comment ?? null);
        res.flash('success', 'Audyt został zatwierdzony.');
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        res.flash('error', err.message);
      }
      res.redirect(303, `/audits/${req.audit.id}`);
    },

    returnForCorrection(req, res) {
      const { ok, data, errors } = parseForm(returnSchema, req.body);
      if (!ok) { res.flash('error', errors.comment); return res.redirect(303, `/audits/${req.audit.id}`); }
      try {
        audits.returnForCorrection(req.audit, req.user, data.comment);
        res.flash('success', 'Audyt został zwrócony audytorowi do poprawy.');
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        res.flash('error', err.message);
      }
      res.redirect(303, `/audits/${req.audit.id}`);
    },

    remove(req, res) {
      try {
        audits.remove(req.audit);
        res.flash('success', 'Usunięto audyt.');
        return res.redirect(303, '/audits');
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        res.flash('error', err.message);
        return res.redirect(303, `/audits/${req.audit.id}`);
      }
    },

    download(req, res) {
      const att = attachments.getForAudit(paramId(req, 'attId'), req.audit.id);
      if (!att) throw httpError(404, 'Nie znaleziono załącznika.');
      res.setHeader('Content-Type', att.mime);
      res.download(attachments.filePath(att), att.original_name);
    },

    async deleteAttachment(req, res) {
      const att = attachments.getForAudit(paramId(req, 'attId'), req.audit.id);
      if (!att) throw httpError(404, 'Nie znaleziono załącznika.');
      await attachments.remove(att);
      res.flash('success', `Usunięto załącznik ${att.original_name}.`);
      res.redirect(303, `/audits/${req.audit.id}`);
    },
  };
}

module.exports = { createAuditsController };
