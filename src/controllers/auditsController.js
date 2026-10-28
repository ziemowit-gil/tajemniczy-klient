const { AREA_LABELS, ROLES, DISABILITIES } = require('../domain/constants');
const { STATUS, STATUS_LABELS, isEditable, isAssignable } = require('../domain/workflow');
const { ANSWER_OPTIONS } = require('../domain/scoring');
const { DomainError } = require('../services/audits');
const {
  auditCreateSchema, answersSchema, reviewSchema, returnSchema, parseForm,
} = require('../validation/schemas');
const { paramId, httpError, collectAnswers, collectDoneSteps } = require('./helpers');

function createAuditsController({ audits, objects, users, catalog, attachments, reports, history, notifier }) {
  const viewData = (req, audit, extra = {}) => {
    const items = audits.items(audit.id);
    const files = attachments.list('audit', audit.id);
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
      audit, groups, scenarios: audits.scenarios(audit.id), disabilityLabels: DISABILITIES, summary: preview.summary, statusLabels: STATUS_LABELS, answerOptions: ANSWER_OPTIONS,
      canEdit: audits.canEdit(req.user, audit),
      canReview: audit.status === STATUS.SUBMITTED && [ROLES.COORDINATOR, ROLES.ADMIN].includes(req.user.role),
      canExport: req.user.role !== ROLES.AUDITOR || audit.auditor_id === req.user.id,
      isAdmin: req.user.role === ROLES.ADMIN,
      canManage: [ROLES.ADMIN, ROLES.COORDINATOR].includes(req.user.role),
      canAccept: req.user.role === ROLES.AUDITOR && audit.status === STATUS.ASSIGNED && audit.auditor_id === req.user.id,
      canAssign: [ROLES.ADMIN, ROLES.COORDINATOR].includes(req.user.role) && isAssignable(audit.status),
      auditors: [ROLES.ADMIN, ROLES.COORDINATOR].includes(req.user.role) && isAssignable(audit.status) ? users.listByRole(ROLES.AUDITOR) : [],
      history: history.list('audit', audit.id), historyLabels: history.labels,
      problems: {}, errors: {}, ...extra,
    };
  };

  const newFormData = (req, { errors = {}, values = {} } = {}) => ({
    title: 'Wprowadź audyt do systemu', errors, values,
    selectedScenarios: [].concat(values.scenarioIds ?? []),
    // Koordynator wprowadza audyty tylko dla obiektów, które koordynuje; administrator dla wszystkich.
    objects: req.user.role === ROLES.COORDINATOR ? objects.list({ coordinatorId: req.user.id }) : objects.list(),
    auditors: users.listByRole(ROLES.AUDITOR),
    scenarios: catalog.scenarios.list({ onlyActive: true, usage: 'audit' }),
  });

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
      res.render('audits/new', newFormData(req, { values: { objectId: req.query.objectId } }));
    },

    /** Wprowadza audyt (koordynator lub administrator); z wybranym audytorem od razu „Przydzielony do TK”. */
    create(req, res) {
      const { ok, data, errors } = parseForm(auditCreateSchema, req.body);
      if (!ok) return res.status(422).render('audits/new', newFormData(req, { errors, values: req.body }));
      if (req.user.role === ROLES.COORDINATOR && !objects.isCoordinatedBy(data.objectId, req.user.id)) {
        return res.status(422).render('audits/new', newFormData(req, { errors: { objectId: 'Możesz wprowadzać audyty tylko dla obiektów, które koordynujesz.' }, values: req.body }));
      }
      try {
        const audit = audits.create(data, req.user.id);
        history.log('audit', audit.id, req.user, 'entered', `Scenariusze: ${audit.scenario_title}.${audit.due_date ? ` Termin: ${audit.due_date}.` : ''}`);
        if (audit.auditor_id) {
          history.log('audit', audit.id, req.user, 'assigned', `Tajemniczy Klient: ${audit.auditor_name}.`);
          notifier.auditAssigned(audit);
        }
        res.flash('success', audit.auditor_id
          ? `Wprowadzono audyt obiektu „${audit.object_name}” i przydzielono go: ${audit.auditor_name}.`
          : `Wprowadzono audyt obiektu „${audit.object_name}” (status: Wprowadzony do systemu). Przydziel mu Tajemniczego Klienta.`);
        return res.redirect(303, `/audits/${audit.id}`);
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        return res.status(422).render('audits/new', newFormData(req, { errors: { _form: err.message }, values: req.body }));
      }
    },

    /** Przydział lub zmiana Tajemniczego Klienta (do czasu rozpoczęcia pracy). */
    assign(req, res) {
      const auditorId = Number(req.body.auditorId);
      if (!Number.isInteger(auditorId) || auditorId <= 0) { res.flash('error', 'Wybierz Tajemniczego Klienta.'); return res.redirect(303, `/audits/${req.audit.id}`); }
      try {
        const before = req.audit;
        const audit = audits.assign(before, auditorId, req.user);
        history.log('audit', audit.id, req.user, 'assigned', `Tajemniczy Klient: ${audit.auditor_name}${before.auditor_id && before.auditor_id !== auditorId ? ` (poprzednio: ${before.auditor_name})` : ''}.`);
        notifier.auditAssigned(audit);
        res.flash('success', `Przydzielono audyt: ${audit.auditor_name}.`);
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        res.flash('error', err.message);
      }
      res.redirect(303, `/audits/${req.audit.id}`);
    },

    show: (req, res) => res.render('audits/show', viewData(req, req.audit)),

    /** „Przyjmij audyt”: potwierdzenie przez Tajemniczego Klienta, że bierze przydzielony audyt do realizacji. */
    accept(req, res) {
      try {
        audits.accept(req.audit, req.user);
        history.log('audit', req.audit.id, req.user, 'accepted');
        res.flash('success', 'Audyt przyjęty do realizacji. Status: W trakcie.');
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        res.flash('error', err.message);
      }
      res.redirect(303, `/audits/${req.audit.id}`);
    },

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
        if (audit.status === STATUS.ASSIGNED) history.log('audit', audit.id, req.user, 'started');
        audits.saveSteps(audit.id, collectDoneSteps(req.body));
      } catch (err) {
        await attachments.discard(req.files);
        if (!(err instanceof DomainError)) throw err;
        res.flash('error', err.message);
        return res.redirect(303, back);
      }
      const { rejected, accepted } = await attachments.register(req.files, { ownerId: audit.id, userId: req.user.id, kind: 'audit' });
      if (accepted.length) history.log('audit', audit.id, req.user, 'attachment_added', accepted.join(', '));

      if (req.body.intent === 'submit') {
        try {
          const submitted = audits.submit(audits.get(audit.id), req.user);
          history.log('audit', audit.id, req.user, 'submitted');
          notifier.auditSubmitted(submitted);
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
        const approved = audits.approve(req.audit, req.user, data?.comment ?? null);
        history.log('audit', approved.id, req.user, 'approved', data?.comment ?? null);
        notifier.auditApproved(approved, data?.comment ?? null);
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
        const returned = audits.returnForCorrection(req.audit, req.user, data.comment);
        history.log('audit', returned.id, req.user, 'returned', data.comment);
        notifier.auditReturned(returned, data.comment);
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
      const att = attachments.get('audit', paramId(req, 'attId'), req.audit.id);
      if (!att) throw httpError(404, 'Nie znaleziono załącznika.');
      res.setHeader('Content-Type', att.mime);
      res.download(attachments.filePath(att), att.original_name);
    },

    async deleteAttachment(req, res) {
      const att = attachments.get('audit', paramId(req, 'attId'), req.audit.id);
      if (!att) throw httpError(404, 'Nie znaleziono załącznika.');
      await attachments.remove('audit', att);
      history.log('audit', req.audit.id, req.user, 'attachment_removed', att.original_name);
      res.flash('success', `Usunięto załącznik ${att.original_name}.`);
      res.redirect(303, `/audits/${req.audit.id}`);
    },
  };
}

module.exports = { createAuditsController };
