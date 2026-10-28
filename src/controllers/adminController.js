/** Zarządzanie słownikami administratora: obiekty, kryteria, scenariusze, użytkownicy. */
const {
  OBJECT_TYPES, AREA_LABELS, SCENARIO_AREAS, SCENARIO_USAGE, DISABILITIES, ANSWER_TYPE_LABELS, ROLES, ROLE_LABELS, ROLE_SET_LABELS,
} = require('../domain/constants');
const {
  objectSchema, criterionSchema, scenarioSchema, userUpdateSchema, importSchema, parseForm,
} = require('../validation/schemas');
const { STATUS_LABELS } = require('../domain/workflow');
const { DirectoryError } = require('../services/szoDirectory');
const { paramId, httpError } = require('./helpers');
const { ExternalAuthError } = require('../services/externalAuth');

function createAdminController({ objects, catalog, users, szoDirectory, notifier, externalAuth, mailer, importDomains = [], declarations, declarationRequired = true }) {
  const objectFormData = (extra = {}) => ({
    title: 'Obiekt', objectTypes: OBJECT_TYPES, errors: {}, values: {}, object: null,
    coordinators: users.listByRole(ROLES.COORDINATOR, ROLES.ADMIN), parents: objects.parentOptions(), ...extra,
  });

  const scenarioLabels = { areaLabels: SCENARIO_AREAS, usageLabels: SCENARIO_USAGE, personaLabels: DISABILITIES };
  const scenarioForm = (extra = {}) => ({ scenario: null, errors: {}, values: {}, ...scenarioLabels, ...extra });

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
    scenariosIndex(req, res) {
      const usage = Object.hasOwn(SCENARIO_USAGE, req.query.usage) ? req.query.usage : '';
      const active = ['0', '1'].includes(req.query.active) ? req.query.active : '';
      const list = catalog.scenarios.list()
        .filter((s) => !usage || s.usage === usage)
        .filter((s) => active === '' || String(s.active) === active);
      res.render('scenarios/index', { title: 'Scenariusze', scenarios: list, filter: { usage, active }, packs: catalog.scenarios.packs(), ...scenarioLabels });
    },
    /** Import przykładowej paczki scenariuszy (np. dla uczelni); istniejące tytuły są pomijane, nic nie jest nadpisywane. */
    scenariosImportPack(req, res) {
      const key = String(req.body.pack || '');
      if (!catalog.scenarios.packs().some((p) => p.key === key)) throw httpError(404, 'Nie znaleziono paczki scenariuszy.');
      const { added, skipped } = catalog.scenarios.importPack(key);
      res.flash(added.length ? 'success' : 'info', added.length
        ? `Zaimportowano scenariuszy: ${added.length}.${skipped.length ? ` Pominięto istniejące: ${skipped.length}.` : ''} Możesz je edytować, wyłączyć lub usunąć.`
        : 'Wszystkie scenariusze z tej paczki już istnieją — nic nie zaimportowano.');
      res.redirect(303, '/scenarios');
    },
    scenarioShow(req, res) {
      const s = catalog.scenarios.get(paramId(req));
      if (!s) throw httpError(404, 'Nie znaleziono scenariusza.');
      res.render('scenarios/show', { title: `Scenariusz: ${s.title}`, scenario: s, steps: catalog.scenarios.steps(s.id), usageOf: catalog.scenarios.usageOf(s.id), statusLabels: STATUS_LABELS, ...scenarioLabels });
    },
    scenarioNew: (req, res) => res.render('scenarios/form', scenarioForm({ title: 'Nowy scenariusz', values: { areas: 'BOTH', usage: 'audit', active: true } })),
    scenarioCreate(req, res) {
      const { ok, data, errors } = parseForm(scenarioSchema, req.body);
      if (!ok) return res.status(422).render('scenarios/form', scenarioForm({ title: 'Nowy scenariusz', errors, values: checkboxValues(req.body) }));
      const created = catalog.scenarios.create(data);
      res.flash('success', `Dodano scenariusz „${data.title}”.`);
      res.redirect(303, `/scenarios/${created.id}`);
    },
    scenarioEdit(req, res) {
      const s = catalog.scenarios.get(paramId(req));
      if (!s) throw httpError(404, 'Nie znaleziono scenariusza.');
      res.render('scenarios/form', scenarioForm({
        title: 'Edycja scenariusza', scenario: s,
        values: {
          title: s.title, description: s.description, goal: s.goal, persona: s.persona, expectedResult: s.expected_result,
          estimatedMinutes: s.estimated_minutes, steps: catalog.scenarios.steps(s.id).map((x) => x.text).join('\n'),
          areas: s.areas, usage: s.usage, active: Boolean(s.active),
        },
      }));
    },
    scenarioUpdate(req, res) {
      const id = paramId(req);
      const s = catalog.scenarios.get(id);
      if (!s) throw httpError(404, 'Nie znaleziono scenariusza.');
      const { ok, data, errors } = parseForm(scenarioSchema, req.body);
      if (!ok) return res.status(422).render('scenarios/form', scenarioForm({ title: 'Edycja scenariusza', scenario: s, errors, values: checkboxValues(req.body) }));
      const updated = catalog.scenarios.update(id, data);
      res.flash('success', updated.version > s.version
        ? `Zapisano scenariusz „${data.title}” jako wersję ${updated.version}. Audyty i oceny już przydzielone zachowują dotychczasową treść.`
        : `Zapisano scenariusz „${data.title}”.`);
      res.redirect(303, `/scenarios/${id}`);
    },
    scenarioDuplicate(req, res) {
      const id = paramId(req);
      if (!catalog.scenarios.get(id)) throw httpError(404, 'Nie znaleziono scenariusza.');
      const copy = catalog.scenarios.duplicate(id);
      res.flash('success', 'Utworzono kopię scenariusza jako nieaktywny szkic. Zmień jej treść i włącz, gdy będzie gotowa.');
      res.redirect(303, `/scenarios/${copy.id}/edit`);
    },
    scenarioDelete(req, res) {
      const id = paramId(req);
      const s = catalog.scenarios.get(id);
      if (!s) throw httpError(404, 'Nie znaleziono scenariusza.');
      if (catalog.scenarios.inUse(id)) res.flash('error', `Scenariusz „${s.title}” jest użyty w audytach lub ocenach – możesz go tylko wyłączyć.`);
      else { catalog.scenarios.remove(id); res.flash('success', `Usunięto scenariusz „${s.title}”.`); }
      res.redirect(303, '/scenarios');
    },

    /* ---------- Użytkownicy ---------- */
    usersIndex: (req, res) => res.render('users/index', { title: 'Użytkownicy', users: users.list(), roleLabels: ROLE_LABELS, roleSetLabels: ROLE_SET_LABELS, importEnabled: szoDirectory.enabled, declared: declarations.acceptedMap(), declarationRequired, duplicates: users.duplicateEmails(), externalEnabled: externalAuth.enabled, mailEnabled: mailer.mode !== 'off' }),

    /** Import osób z SZO: lista kont z uprawnieniem „Tajemniczy Klient”, których jeszcze nie ma w aplikacji. */
    async usersImportForm(req, res) {
      const view = { title: 'Importuj użytkowników z SZO', importDomains, roleLabels: ROLE_LABELS, roleSetLabels: ROLE_SET_LABELS, enabled: szoDirectory.enabled, people: [], error: null, defaultRole: ROLES.AUDITOR };
      if (!szoDirectory.enabled) return res.render('users/import', view);
      try {
        const existing = users.existingExternalIds();
        view.people = (await szoDirectory.listUsers()).map((p) => ({ ...p, imported: existing.has(`szo:${p.id}`) }));
      } catch (err) {
        if (!(err instanceof DirectoryError)) throw err;
        view.error = err.message;
        res.status(err.status === 400 ? 200 : 502);
      }
      return res.render('users/import', view);
    },

    /**
     * Import po adresie e-mail: administrator wpisuje adresy osób (np. imie.nazwisko@feer.org.pl), aplikacja szuka ich wśród
     * kont SZO z uprawnieniem do aplikacji i zakłada konta z wybraną rolą. Adresy muszą należeć do dozwolonych domen
     * (IMPORT_EMAIL_DOMAINS, domyślnie feer.org.pl). Dane osoby zawsze pochodzą z SZO, nie z formularza.
     */
    async usersImportByEmail(req, res) {
      const MAX = 50;
      const addresses = [...new Set(String(req.body.emails || '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
      if (!addresses.length) { res.flash('error', 'Podaj adres e-mail osoby, którą chcesz zaimportować.'); return res.redirect(303, '/users/import'); }
      if (addresses.length > MAX) { res.flash('error', `Za dużo adresów naraz (maksymalnie ${MAX}).`); return res.redirect(303, '/users/import'); }

      const rejected = []; const valid = [];
      for (const a of addresses) {
        const m = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(a);
        if (!m || (importDomains.length && !importDomains.includes(m[1]))) rejected.push(a); else valid.push(a);
      }
      if (!valid.length) {
        res.flash('error', `Nieprawidłowy adres lub domena spoza dozwolonych${importDomains.length ? ` (${importDomains.map((d) => `@${d}`).join(', ')})` : ''}: ${rejected.slice(0, 5).join(', ')}.`);
        return res.redirect(303, '/users/import');
      }
      let people;
      try { people = await szoDirectory.listUsers(); } catch (err) {
        if (!(err instanceof DirectoryError)) throw err;
        res.flash('error', err.message);
        return res.redirect(303, '/users/import');
      }
      const role = Object.values(ROLES).includes(req.body.role) ? req.body.role : ROLES.AUDITOR;
      const existing = users.existingExternalIds();
      const byEmail = new Map(people.map((p) => [p.email, p]));
      const imported = []; const already = []; const notFound = [];
      for (const address of valid) {
        const person = byEmail.get(address);
        if (!person) { notFound.push(address); continue; }
        if (existing.has(`szo:${person.id}`)) { already.push(address); continue; }
        notifier.roleAssigned(users.upsertFromIdentity({ externalId: `szo:${person.id}`, name: person.name, email: person.email, role }));
        imported.push(address);
      }
      const list = (a) => a.slice(0, 5).join(', ') + (a.length > 5 ? ` i ${a.length - 5} więcej` : '');
      const parts = [];
      if (imported.length) parts.push(`Zaimportowano (${imported.length}): ${list(imported)}.${notifier.enabled ? ' Każda z tych osób dostanie e-mail z informacją o koncie.' : ''}`);
      if (already.length) parts.push(`Już w aplikacji (${already.length}): ${list(already)}.`);
      if (notFound.length) parts.push(`Nie znaleziono w SZO (${notFound.length}): ${list(notFound)}. Sprawdź adres i nadaj tym osobom w SZO uprawnienie „Tajemniczy Klient” (konto musi być aktywne).`);
      if (rejected.length) parts.push(`Odrzucono niepoprawne lub spoza dozwolonej domeny (${rejected.length}): ${list(rejected)}.`);
      res.flash(imported.length ? 'success' : 'error', parts.join(' '));
      return res.redirect(303, imported.length ? '/users' : '/users/import');
    },

    /**
     * Zapis importu. Dane osób (imię, e-mail) pochodzą z ponownego zapytania do SZO, nie z formularza,
     * więc nie da się podstawić cudzego adresu; z formularza bierzemy tylko wybór osób i ich role.
     */
    async usersImport(req, res) {
      const { data } = parseForm(importSchema, req.body);
      const picked = new Set(data?.pick ?? []);
      if (!picked.size) { res.flash('error', 'Zaznacz przynajmniej jedną osobę.'); return res.redirect(303, '/users/import'); }
      let people;
      try { people = await szoDirectory.listUsers(); } catch (err) {
        if (!(err instanceof DirectoryError)) throw err;
        res.flash('error', err.message);
        return res.redirect(303, '/users/import');
      }
      const existing = users.existingExternalIds();
      let created = 0; let skipped = 0;
      for (const person of people) {
        if (!picked.has(person.id)) continue;
        if (existing.has(`szo:${person.id}`)) { skipped += 1; continue; }
        const role = Object.values(ROLES).includes(req.body[`role_${person.id}`]) ? req.body[`role_${person.id}`] : ROLES.AUDITOR;
        const imported = users.upsertFromIdentity({ externalId: `szo:${person.id}`, name: person.name, email: person.email, role });
        notifier.roleAssigned(imported);
        created += 1;
      }
      const missing = [...picked].filter((id) => !people.some((p) => p.id === id)).length;
      res.flash(created ? 'success' : 'error', created
        ? `Zaimportowano osób: ${created}.${notifier.enabled ? ' Każda z nich dostanie e-mail z informacją o koncie.' : ''}${skipped ? ` Pominięto już istniejące: ${skipped}.` : ''}${missing ? ` Pominięto osoby, których SZO nie zwróciło: ${missing}.` : ''}`
        : 'Nie zaimportowano nikogo (osoby są już w aplikacji albo SZO ich nie zwróciło).');
      return res.redirect(303, '/users');
    },
    /** Konto użytkownika zewnętrznego (spoza SZO): wymaga działającej wysyłki SMS i e-maila, bo hasło i kody idą tymi kanałami. */
    externalCreate(req, res) {
      if (!externalAuth.enabled) { res.flash('error', 'Wysyłka SMS jest wyłączona (SMS_MODE) albo SZO nie ma klucza API. Użytkownicy zewnętrzni nie mogliby się zalogować.'); return res.redirect(303, '/users'); }
      if (mailer.mode === 'off') { res.flash('error', 'Wysyłka e-mail jest wyłączona (MAIL_MODE). Nowa osoba nie dostałaby linku do ustawienia hasła.'); return res.redirect(303, '/users'); }
      try {
        const { user, token } = externalAuth.createUser({ name: req.body.name, email: req.body.email, phone: req.body.phone });
        notifier.externalAccount(user, token);
        res.flash('success', `Utworzono konto zewnętrzne: ${user.name}. Wysłaliśmy e-mail z linkiem do ustawienia hasła (ważny 72 godziny).`);
      } catch (err) {
        if (!(err instanceof ExternalAuthError)) throw err;
        res.flash('error', err.message);
      }
      return res.redirect(303, '/users');
    },

    externalResendLink(req, res) {
      const target = users.findById(paramId(req));
      if (!target || target.kind !== 'external') throw httpError(404, 'Nie znaleziono użytkownika zewnętrznego.');
      notifier.externalAccount(target, externalAuth.issueSetPasswordToken(target.id), { reminder: true });
      res.flash('success', `Wysłaliśmy ${target.name} nowy link do ustawienia hasła. Poprzednie linki przestały działać.`);
      return res.redirect(303, '/users');
    },

    externalPhone(req, res) {
      const target = users.findById(paramId(req));
      if (!target || target.kind !== 'external') throw httpError(404, 'Nie znaleziono użytkownika zewnętrznego.');
      try { externalAuth.setPhone(target.id, req.body.phone); res.flash('success', `Zapisano numer telefonu: ${target.name}.`); }
      catch (err) { if (!(err instanceof ExternalAuthError)) throw err; res.flash('error', err.message); }
      return res.redirect(303, '/users');
    },

    userUpdate(req, res) {
      const id = paramId(req);
      const target = users.findById(id);
      if (!target) throw httpError(404, 'Nie znaleziono użytkownika.');
      const { ok, data, errors } = parseForm(userUpdateSchema, req.body);
      if (!ok) { res.flash('error', Object.values(errors)[0]); return res.redirect(303, '/users'); }
      // Role dodatkowe: z pól wyboru, a przy starszym zapisie `role` z jednej wartości. Audytor jest zawsze.
      const extras = data.role !== undefined
        ? (data.role === ROLES.AUDITOR ? [] : [data.role])
        : [data.coordinator && ROLES.COORDINATOR, data.administrator && ROLES.ADMIN].filter(Boolean);
      const losesAdmin = target.roles.includes(ROLES.ADMIN) && target.active && (!extras.includes(ROLES.ADMIN) || !data.active);
      if (losesAdmin && users.countActiveAdmins() <= 1) {
        res.flash('error', 'Nie można odebrać uprawnień ostatniemu aktywnemu administratorowi.');
        return res.redirect(303, '/users');
      }
      if (target.kind === 'external' && extras.length) { res.flash('error', 'Użytkownik zewnętrzny może mieć tylko rolę Audytor / Tajemniczy Klient.'); return res.redirect(303, '/users'); }
      const updated = users.setRoles(id, { extras, active: data.active, activeRole: data.role });
      const gainedRole = updated.roles.some((r) => !target.roles.includes(r));
      if (updated.active && (gainedRole || target.role !== updated.role || !target.active)) notifier.roleAssigned(updated);
      res.flash('success', `Zapisano użytkownika ${target.name}. Rola przekazywana w tokenie SZO jest dodawana do przyznanych przy kolejnym logowaniu.`);
      res.redirect(303, '/users');
    },
  };
}

module.exports = { createAdminController };
