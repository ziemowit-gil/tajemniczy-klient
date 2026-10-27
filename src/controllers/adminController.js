/** Zarządzanie słownikami administratora: obiekty, kryteria, scenariusze, użytkownicy. */
const {
  OBJECT_TYPES, AREA_LABELS, SCENARIO_AREAS, ANSWER_TYPE_LABELS, ROLES, ROLE_LABELS,
} = require('../domain/constants');
const {
  objectSchema, criterionSchema, scenarioSchema, userUpdateSchema, parseForm,
} = require('../validation/schemas');
const { paramId, httpError } = require('./helpers');

function createAdminController({ objects, catalog, users }) {
  const objectFormData = (extra = {}) => ({
    title: 'Obiekt', objectTypes: OBJECT_TYPES, errors: {}, values: {}, object: null,
    coordinators: users.listByRole(ROLES.COORDINATOR, ROLES.ADMIN), parents: objects.parentOptions(), ...extra,
  });

  const checkboxValues = (body) => ({ ...body, active: body.active === 'on' });

  return {
    /* ---------- Obiekty ---------- */
    objectsIndex(req, res) {
      const isCoordinator = req.user.role === ROLES.COORDINATOR;
      res.render('objects/index', {
        title: 'Obiekty i uczelnie',
        objects: objects.list(isCoordinator ? { coordinatorId: req.user.id } : {}),
        objectTypes: OBJECT_TYPES,
      });
    },
    objectNew: (req, res) => res.render('objects/form', objectFormData({ title: 'Nowy obiekt', values: { type: 'uczelnia' } })),
    objectCreate(req, res) {
      const { ok, data, errors } = parseForm(objectSchema, req.body);
      if (!ok) return res.status(422).render('objects/form', objectFormData({ title: 'Nowy obiekt', errors, values: req.body }));
      const created = objects.create(data);
      res.flash('success', `Dodano obiekt „${created.name}”.`);
      res.redirect(303, '/objects');
    },
    objectEdit(req, res) {
      const object = objects.get(paramId(req));
      if (!object) throw httpError(404, 'Nie znaleziono obiektu.');
      res.render('objects/form', objectFormData({
        title: 'Edycja obiektu', object, parents: objects.parentOptions(object.id),
        values: { name: object.name, type: object.type, parentId: object.parent_id, address: object.address, coordinatorId: object.coordinator_id, notes: object.notes },
      }));
    },
    objectUpdate(req, res) {
      const id = paramId(req);
      const object = objects.get(id);
      if (!object) throw httpError(404, 'Nie znaleziono obiektu.');
      const { ok, data, errors } = parseForm(objectSchema, req.body);
      if (!ok) return res.status(422).render('objects/form', objectFormData({ title: 'Edycja obiektu', object, parents: objects.parentOptions(id), errors, values: req.body }));
      objects.update(id, data);
      res.flash('success', `Zapisano obiekt „${data.name}”.`);
      res.redirect(303, '/objects');
    },
    objectDelete(req, res) {
      const id = paramId(req);
      const object = objects.get(id);
      if (!object) throw httpError(404, 'Nie znaleziono obiektu.');
      const blocker = objects.deletionBlocker(id);
      if (blocker) res.flash('error', `Nie można usunąć obiektu „${object.name}”. ${blocker}`);
      else { objects.remove(id); res.flash('success', `Usunięto obiekt „${object.name}”.`); }
      res.redirect(303, '/objects');
    },

    /* ---------- Kryteria ---------- */
    criteriaIndex: (req, res) => res.render('criteria/index', { title: 'Kryteria audytu', criteria: catalog.criteria.list(), areaLabels: AREA_LABELS, typeLabels: ANSWER_TYPE_LABELS }),
    criterionNew: (req, res) => res.render('criteria/form', { title: 'Nowe kryterium', criterion: null, errors: {}, values: { weight: 3, answerType: 'scale', active: true }, areaLabels: AREA_LABELS, typeLabels: ANSWER_TYPE_LABELS }),
    criterionCreate(req, res) {
      const { ok, data, errors } = parseForm(criterionSchema, req.body);
      if (ok && catalog.criteria.codeTaken(data.code)) { errors.code = 'Kod jest już używany'; }
      if (!ok || errors.code) return res.status(422).render('criteria/form', { title: 'Nowe kryterium', criterion: null, errors, values: checkboxValues(req.body), areaLabels: AREA_LABELS, typeLabels: ANSWER_TYPE_LABELS });
      catalog.criteria.create(data);
      res.flash('success', `Dodano kryterium ${data.code}.`);
      res.redirect(303, '/criteria');
    },
    criterionEdit(req, res) {
      const c = catalog.criteria.get(paramId(req));
      if (!c) throw httpError(404, 'Nie znaleziono kryterium.');
      res.render('criteria/form', {
        title: 'Edycja kryterium', criterion: c, errors: {}, areaLabels: AREA_LABELS, typeLabels: ANSWER_TYPE_LABELS,
        values: { code: c.code, area: c.area, category: c.category, text: c.text, hint: c.hint, weight: c.weight, answerType: c.answer_type, position: c.position, active: Boolean(c.active) },
      });
    },
    criterionUpdate(req, res) {
      const id = paramId(req);
      const c = catalog.criteria.get(id);
      if (!c) throw httpError(404, 'Nie znaleziono kryterium.');
      const { ok, data, errors } = parseForm(criterionSchema, req.body);
      if (ok && catalog.criteria.codeTaken(data.code, id)) errors.code = 'Kod jest już używany';
      if (!ok || errors.code) return res.status(422).render('criteria/form', { title: 'Edycja kryterium', criterion: c, errors, values: checkboxValues(req.body), areaLabels: AREA_LABELS, typeLabels: ANSWER_TYPE_LABELS });
      catalog.criteria.update(id, data);
      res.flash('success', `Zapisano kryterium ${data.code}. Zmiana nie wpływa na audyty już przydzielone.`);
      res.redirect(303, '/criteria');
    },
    criterionDelete(req, res) {
      const id = paramId(req);
      const c = catalog.criteria.get(id);
      if (!c) throw httpError(404, 'Nie znaleziono kryterium.');
      catalog.criteria.remove(id);
      res.flash('success', `Usunięto kryterium ${c.code}. Audyty zachowują własne kopie kryteriów.`);
      res.redirect(303, '/criteria');
    },

    /* ---------- Scenariusze ---------- */
    scenariosIndex: (req, res) => res.render('scenarios/index', { title: 'Scenariusze', scenarios: catalog.scenarios.list(), areaLabels: SCENARIO_AREAS }),
    scenarioNew: (req, res) => res.render('scenarios/form', { title: 'Nowy scenariusz', scenario: null, errors: {}, values: { areas: 'BOTH', active: true }, areaLabels: SCENARIO_AREAS }),
    scenarioCreate(req, res) {
      const { ok, data, errors } = parseForm(scenarioSchema, req.body);
      if (!ok) return res.status(422).render('scenarios/form', { title: 'Nowy scenariusz', scenario: null, errors, values: checkboxValues(req.body), areaLabels: SCENARIO_AREAS });
      catalog.scenarios.create(data);
      res.flash('success', `Dodano scenariusz „${data.title}”.`);
      res.redirect(303, '/scenarios');
    },
    scenarioEdit(req, res) {
      const s = catalog.scenarios.get(paramId(req));
      if (!s) throw httpError(404, 'Nie znaleziono scenariusza.');
      res.render('scenarios/form', { title: 'Edycja scenariusza', scenario: s, errors: {}, areaLabels: SCENARIO_AREAS, values: { title: s.title, description: s.description, areas: s.areas, active: Boolean(s.active) } });
    },
    scenarioUpdate(req, res) {
      const id = paramId(req);
      const s = catalog.scenarios.get(id);
      if (!s) throw httpError(404, 'Nie znaleziono scenariusza.');
      const { ok, data, errors } = parseForm(scenarioSchema, req.body);
      if (!ok) return res.status(422).render('scenarios/form', { title: 'Edycja scenariusza', scenario: s, errors, values: checkboxValues(req.body), areaLabels: SCENARIO_AREAS });
      catalog.scenarios.update(id, data);
      res.flash('success', `Zapisano scenariusz „${data.title}”.`);
      res.redirect(303, '/scenarios');
    },
    scenarioDelete(req, res) {
      const id = paramId(req);
      const s = catalog.scenarios.get(id);
      if (!s) throw httpError(404, 'Nie znaleziono scenariusza.');
      if (catalog.scenarios.inUse(id)) res.flash('error', `Scenariusz „${s.title}” jest użyty w audytach – możesz go tylko wyłączyć.`);
      else { catalog.scenarios.remove(id); res.flash('success', `Usunięto scenariusz „${s.title}”.`); }
      res.redirect(303, '/scenarios');
    },

    /* ---------- Użytkownicy ---------- */
    usersIndex: (req, res) => res.render('users/index', { title: 'Użytkownicy', users: users.list(), roleLabels: ROLE_LABELS }),
    userUpdate(req, res) {
      const id = paramId(req);
      const target = users.findById(id);
      if (!target) throw httpError(404, 'Nie znaleziono użytkownika.');
      const { ok, data, errors } = parseForm(userUpdateSchema, req.body);
      if (!ok) { res.flash('error', Object.values(errors)[0]); return res.redirect(303, '/users'); }
      const losesAdmin = target.role === ROLES.ADMIN && target.active && (data.role !== ROLES.ADMIN || !data.active);
      if (losesAdmin && users.countActiveAdmins() <= 1) {
        res.flash('error', 'Nie można odebrać uprawnień ostatniemu aktywnemu administratorowi.');
        return res.redirect(303, '/users');
      }
      users.update(id, data);
      res.flash('success', `Zapisano użytkownika ${target.name}. Rola przekazywana w tokenie SZO nadpisuje to ustawienie przy kolejnym logowaniu.`);
      res.redirect(303, '/users');
    },
  };
}

module.exports = { createAdminController };
