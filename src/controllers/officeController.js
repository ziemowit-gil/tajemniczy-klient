const {
  STUDY_LEVELS, STUDY_MODES, DISABILITIES, ROLES, ANSWER_TYPE_LABELS,
} = require('../domain/constants');
const { STATUS, STATUS_LABELS } = require('../domain/workflow');
const { ANSWER_OPTIONS } = require('../domain/scoring');
const { DomainError } = require('../services/audits');
const exporters = require('../services/exporters');
const {
  officeReviewSchema, scenarioAssignSchema, officeDetailsSchema, officeQuestionSchema, reviewSchema, returnSchema, parseForm,
} = require('../validation/schemas');
const { paramId, httpError, collectAnswers, collectDoneSteps } = require('./helpers');

const labels = { levels: STUDY_LEVELS, modes: STUDY_MODES, disabilities: DISABILITIES, statusLabels: STATUS_LABELS };

function createOfficeController({ office, objects, catalog, users, attachments, history, notifier }) {
  const universities = () => objects.list().filter((o) => o.type === 'uczelnia');
  const educationScenarios = () => catalog.scenarios.list({ onlyActive: true, usage: 'education' });
  const newFormData = (req, extra = {}) => {
    const values = extra.values || {};
    const isAdmin = req.user.role === ROLES.ADMIN;
    return {
      title: 'Nowa ocena dostępności kształcenia', errors: {}, values: {}, universities: universities(),
      isAdmin, auditors: isAdmin ? users.listByRole(ROLES.AUDITOR) : [],
      scenarios: isAdmin ? educationScenarios() : [], selectedScenarios: [].concat(values.scenarioIds ?? []),
      ...labels, ...extra,
    };
  };

  const viewData = (req, review, extra = {}) => {
    const { items, score, lines, gaps } = office.summarize(review);
    const groups = [];
    const files = attachments.list('review', review.id);
    for (const item of office.items(review.id)) {
      let cat = groups.find((g) => g.name === item.category);
      if (!cat) groups.push((cat = { name: item.category, items: [] }));
      cat.items.push({ ...item, files: files.get(item.id) || [] });
    }
    void items; void gaps;
    return {
      title: `Dostępność kształcenia: ${review.object_name}`,
      review, groups, score, lines, scenarios: office.scenarios(review.id), answerOptions: ANSWER_OPTIONS, ...labels,
      canEdit: office.canEdit(req.user, review),
      canReview: review.status === STATUS.SUBMITTED && [ROLES.COORDINATOR, ROLES.ADMIN].includes(req.user.role),
      canDelete: office.canDelete(req.user, review),
      canAssignScenarios: req.user.role === ROLES.ADMIN && review.status !== STATUS.APPROVED,
      allScenarios: req.user.role === ROLES.ADMIN ? educationScenarios() : [],
      history: history.list('review', review.id), historyLabels: history.labels,
      problems: {}, errors: {}, ...extra,
    };
  };

  const questionForm = (extra = {}) => ({ title: 'Pytanie ankiety', question: null, errors: {}, values: {}, typeLabels: ANSWER_TYPE_LABELS, ...extra });
  const checkboxValues = (body) => ({ ...body, active: body.active === 'on' });

  return {
    load(req, res, next) {
      const review = office.get(paramId(req));
      if (!review || !office.canView(req.user, review)) return next(httpError(404, 'Nie znaleziono oceny.'));
      req.review = review;
      next();
    },

    index(req, res) {
      res.render('office/index', { title: 'Dostępność kształcenia', reviews: office.list(req.user), ...labels });
    },

    newForm: (req, res) => res.render('office/new', newFormData(req)),

    /** Audytor zakłada ocenę dla siebie (bez scenariuszy); administrator – dla wskazanego audytora, ze scenariuszami. */
    create(req, res) {
      const { ok, data, errors } = parseForm(officeReviewSchema, req.body);
      const isAdmin = req.user.role === ROLES.ADMIN;
      if (ok && isAdmin && !data.auditorId) errors.auditorId = 'Audytor: wybierz wartość';
      if (!ok || errors.auditorId) return res.status(422).render('office/new', newFormData(req, { errors, values: req.body }));
      try {
        const review = office.create(
          { ...data, scenarioIds: isAdmin ? data.scenarioIds : [] },
          isAdmin ? data.auditorId : req.user.id,
        );
        history.log('review', review.id, req.user, 'created', isAdmin ? `Przydzielono audytorowi: ${review.auditor_name}.${review.scenario_title ? ` Scenariusze: ${review.scenario_title}.` : ''}` : null);
        if (isAdmin) notifier.reviewAssigned(review);
        res.flash('success', isAdmin ? 'Przydzielono ocenę dostępności kształcenia audytorowi.' : 'Rozpoczęto ocenę dostępności kształcenia. Odpowiedzi możesz zapisywać etapami.');
        return res.redirect(303, `/office/${review.id}`);
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        return res.status(422).render('office/new', newFormData(req, { errors: { _form: err.message }, values: req.body }));
      }
    },

    /** Administrator ustawia scenariusze oceny. */
    assignScenarios(req, res) {
      const { data } = parseForm(scenarioAssignSchema, req.body);
      try {
        const updated = office.setScenarios(req.review, data?.scenarioIds ?? []);
        history.log('review', updated.id, req.user, 'scenarios_changed', updated.scenario_title || 'brak scenariuszy');
        notifier.reviewScenariosChanged(updated);
        res.flash('success', 'Zapisano scenariusze oceny.');
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        res.flash('error', err.message);
      }
      res.redirect(303, `/office/${req.review.id}`);
    },

    show: (req, res) => res.render('office/show', viewData(req, req.review)),

    ensureEditable(req, res, next) {
      if (!office.canEdit(req.user, req.review)) {
        return next(httpError(403, 'Tej oceny nie można edytować: jest złożona albo należy do kogoś innego.'));
      }
      next();
    },

    async save(req, res) {
      const review = req.review;
      const back = `/office/${review.id}`;
      const { ok, data, errors } = parseForm(officeDetailsSchema, {
        contactNotes: req.body.contactNotes, generalNotes: req.body.generalNotes, answers: collectAnswers(req.body),
      });
      if (!ok) {
        await attachments.discard(req.files);
        res.flash('error', `Formularz zawiera błędy: ${Object.values(errors)[0]}`);
        return res.redirect(303, back);
      }
      try {
        office.save(review, data);
        office.saveSteps(review.id, collectDoneSteps(req.body));
      } catch (err) {
        await attachments.discard(req.files);
        if (!(err instanceof DomainError)) throw err;
        res.flash('error', err.message);
        return res.redirect(303, back);
      }
      const { rejected, accepted } = await attachments.register(req.files, { ownerId: review.id, userId: req.user.id, kind: 'review' });
      if (accepted.length) history.log('review', review.id, req.user, 'attachment_added', accepted.join(', '));
      if (req.body.intent === 'submit') {
        try {
          const submitted = office.submit(office.get(review.id), req.user);
          history.log('review', review.id, req.user, 'submitted');
          notifier.reviewSubmitted(submitted);
          res.flash('success', 'Ocena została złożona i oczekuje na weryfikację koordynatora.');
          return res.redirect(303, back);
        } catch (err) {
          if (!(err instanceof DomainError)) throw err;
          const problems = Object.fromEntries((err.details || []).map((p) => [p.itemId, p.message]));
          return res.status(422).render('office/show', viewData(req, office.get(review.id), {
            problems, errors: { _form: `${err.message} Uzupełnij zaznaczone pytania (${Object.keys(problems).length}).` },
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
        const approved = office.approve(req.review, req.user, data?.comment ?? null);
        history.log('review', approved.id, req.user, 'approved', data?.comment ?? null);
        notifier.reviewApproved(approved, data?.comment ?? null);
        res.flash('success', 'Ocena została zatwierdzona.');
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        res.flash('error', err.message);
      }
      res.redirect(303, `/office/${req.review.id}`);
    },

    returnForCorrection(req, res) {
      const { ok, data, errors } = parseForm(returnSchema, req.body);
      if (!ok) { res.flash('error', errors.comment); return res.redirect(303, `/office/${req.review.id}`); }
      try {
        const returned = office.returnForCorrection(req.review, req.user, data.comment);
        history.log('review', returned.id, req.user, 'returned', data.comment);
        notifier.reviewReturned(returned, data.comment);
        res.flash('success', 'Ocena została zwrócona do poprawy.');
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        res.flash('error', err.message);
      }
      res.redirect(303, `/office/${req.review.id}`);
    },

    async remove(req, res) {
      if (!office.canDelete(req.user, req.review)) throw httpError(403, 'Tej oceny nie można usunąć.');
      await attachments.purge('review', req.review.id);
      office.remove(req.review);
      res.flash('success', 'Usunięto ocenę.');
      res.redirect(303, '/office');
    },

    download(req, res) {
      const att = attachments.get('review', paramId(req, 'attId'), req.review.id);
      if (!att) throw httpError(404, 'Nie znaleziono załącznika.');
      res.setHeader('Content-Type', att.mime);
      res.download(attachments.filePath(att), att.original_name);
    },

    async deleteAttachment(req, res) {
      const att = attachments.get('review', paramId(req, 'attId'), req.review.id);
      if (!att) throw httpError(404, 'Nie znaleziono załącznika.');
      await attachments.remove('review', att);
      history.log('review', req.review.id, req.user, 'attachment_removed', att.original_name);
      res.flash('success', `Usunięto załącznik ${att.original_name}.`);
      res.redirect(303, `/office/${req.review.id}`);
    },

    /* ---------- raport ---------- */
    report(req, res) {
      res.render('office/report', { title: 'Raport: dostępność kształcenia', report: office.report(req.user), ...labels });
    },
    reportCsv(req, res) {
      res.attachment('raport-biura-ozn.csv');
      res.type('text/csv; charset=utf-8').send(exporters.officeReportCsv(office.report(req.user)));
    },

    /* ---------- pytania ankiety (administrator) ---------- */
    questionsIndex: (req, res) => res.render('office/questions', { title: 'Pytania ankiety: dostępność kształcenia', questions: office.questions.list(), typeLabels: ANSWER_TYPE_LABELS }),
    questionNew: (req, res) => res.render('office/question-form', questionForm({ title: 'Nowe pytanie', values: { weight: 3, answerType: 'scale', active: true } })),
    questionCreate(req, res) {
      const { ok, data, errors } = parseForm(officeQuestionSchema, req.body);
      if (ok && office.questions.codeTaken(data.code)) errors.code = 'Kod jest już używany';
      if (!ok || errors.code) return res.status(422).render('office/question-form', questionForm({ title: 'Nowe pytanie', errors, values: checkboxValues(req.body) }));
      office.questions.create(data);
      res.flash('success', `Dodano pytanie ${data.code}.`);
      res.redirect(303, '/office/questions');
    },
    questionEdit(req, res) {
      const q = office.questions.get(paramId(req));
      if (!q) throw httpError(404, 'Nie znaleziono pytania.');
      res.render('office/question-form', questionForm({
        title: 'Edycja pytania', question: q,
        values: { code: q.code, category: q.category, text: q.text, hint: q.hint, weight: q.weight, answerType: q.answer_type, position: q.position, active: Boolean(q.active) },
      }));
    },
    questionUpdate(req, res) {
      const id = paramId(req);
      const q = office.questions.get(id);
      if (!q) throw httpError(404, 'Nie znaleziono pytania.');
      const { ok, data, errors } = parseForm(officeQuestionSchema, req.body);
      if (ok && office.questions.codeTaken(data.code, id)) errors.code = 'Kod jest już używany';
      if (!ok || errors.code) return res.status(422).render('office/question-form', questionForm({ title: 'Edycja pytania', question: q, errors, values: checkboxValues(req.body) }));
      office.questions.update(id, data);
      res.flash('success', `Zapisano pytanie ${data.code}. Zmiana nie wpływa na już rozpoczęte oceny.`);
      res.redirect(303, '/office/questions');
    },
    questionDelete(req, res) {
      const id = paramId(req);
      const q = office.questions.get(id);
      if (!q) throw httpError(404, 'Nie znaleziono pytania.');
      office.questions.remove(id);
      res.flash('success', `Usunięto pytanie ${q.code}. Oceny zachowują własne kopie pytań.`);
      res.redirect(303, '/office/questions');
    },
  };
}

module.exports = { createOfficeController };
