const {
  STUDY_LEVELS, STUDY_MODES, DISABILITIES, ROLES, ANSWER_TYPE_LABELS,
} = require('../domain/constants');
const { STATUS, STATUS_LABELS } = require('../domain/workflow');
const { ANSWER_OPTIONS } = require('../domain/scoring');
const { DomainError } = require('../services/audits');
const exporters = require('../services/exporters');
const {
  officeReviewSchema, officeDetailsSchema, officeQuestionSchema, reviewSchema, returnSchema, parseForm,
} = require('../validation/schemas');
const { paramId, httpError, collectAnswers } = require('./helpers');

const labels = { levels: STUDY_LEVELS, modes: STUDY_MODES, disabilities: DISABILITIES, statusLabels: STATUS_LABELS };

function createOfficeController({ office, objects, catalog }) {
  const universities = () => objects.list().filter((o) => o.type === 'uczelnia');
  const newFormData = (extra = {}) => {
    const values = extra.values || {};
    return {
      title: 'Nowa ocena dostępności kształcenia', errors: {}, values: {}, universities: universities(),
      scenarios: catalog.scenarios.list({ onlyActive: true, usage: 'education' }),
      selectedScenarios: [].concat(values.scenarioIds ?? []), ...labels, ...extra,
    };
  };

  const viewData = (req, review, extra = {}) => {
    const { items, score, lines, gaps } = office.summarize(review);
    const groups = [];
    for (const item of office.items(review.id)) {
      let cat = groups.find((g) => g.name === item.category);
      if (!cat) groups.push((cat = { name: item.category, items: [] }));
      cat.items.push(item);
    }
    void items; void gaps;
    return {
      title: `Dostępność kształcenia: ${review.object_name}`,
      review, groups, score, lines, scenarios: office.scenarios(review.id), answerOptions: ANSWER_OPTIONS, ...labels,
      canEdit: office.canEdit(req.user, review),
      canReview: review.status === STATUS.SUBMITTED && [ROLES.COORDINATOR, ROLES.ADMIN].includes(req.user.role),
      canDelete: office.canDelete(req.user, review),
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

    newForm: (req, res) => res.render('office/new', newFormData()),

    create(req, res) {
      const { ok, data, errors } = parseForm(officeReviewSchema, req.body);
      if (!ok) return res.status(422).render('office/new', newFormData({ errors, values: req.body }));
      try {
        const review = office.create(data, req.user.id);
        res.flash('success', 'Rozpoczęto ocenę dostępności kształcenia. Odpowiedzi możesz zapisywać etapami.');
        return res.redirect(303, `/office/${review.id}`);
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        return res.status(422).render('office/new', newFormData({ errors: { _form: err.message }, values: req.body }));
      }
    },

    show: (req, res) => res.render('office/show', viewData(req, req.review)),

    ensureEditable(req, res, next) {
      if (!office.canEdit(req.user, req.review)) {
        return next(httpError(403, 'Tej oceny nie można edytować: jest złożona albo należy do kogoś innego.'));
      }
      next();
    },

    save(req, res) {
      const review = req.review;
      const back = `/office/${review.id}`;
      const { ok, data, errors } = parseForm(officeDetailsSchema, {
        contactNotes: req.body.contactNotes, generalNotes: req.body.generalNotes, answers: collectAnswers(req.body),
      });
      if (!ok) { res.flash('error', `Formularz zawiera błędy: ${Object.values(errors)[0]}`); return res.redirect(303, back); }
      try {
        office.save(review, data);
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        res.flash('error', err.message);
        return res.redirect(303, back);
      }
      if (req.body.intent === 'submit') {
        try {
          office.submit(office.get(review.id), req.user);
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
      res.flash('success', 'Zapisano odpowiedzi.');
      return res.redirect(303, back);
    },

    approve(req, res) {
      const { data } = parseForm(reviewSchema, req.body);
      try { office.approve(req.review, req.user, data?.comment ?? null); res.flash('success', 'Ocena została zatwierdzona.'); } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        res.flash('error', err.message);
      }
      res.redirect(303, `/office/${req.review.id}`);
    },

    returnForCorrection(req, res) {
      const { ok, data, errors } = parseForm(returnSchema, req.body);
      if (!ok) { res.flash('error', errors.comment); return res.redirect(303, `/office/${req.review.id}`); }
      try { office.returnForCorrection(req.review, req.user, data.comment); res.flash('success', 'Ocena została zwrócona do poprawy.'); } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        res.flash('error', err.message);
      }
      res.redirect(303, `/office/${req.review.id}`);
    },

    remove(req, res) {
      if (!office.canDelete(req.user, req.review)) throw httpError(403, 'Tej oceny nie można usunąć.');
      office.remove(req.review);
      res.flash('success', 'Usunięto ocenę.');
      res.redirect(303, '/office');
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
