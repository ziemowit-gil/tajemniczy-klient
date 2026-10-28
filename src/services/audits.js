const { transaction } = require('../db');
const { ROLES } = require('../domain/constants');
const { STATUS, canTransition, isEditable, isAssignable } = require('../domain/workflow');
const { isValidAnswer, validateForSubmit } = require('../domain/scoring');

class DomainError extends Error {
  constructor(message, status = 422, details = null) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
    this.details = details;
  }
}

/** audit_items → format oczekiwany przez domain/scoring. */
const toScoringItem = (row) => ({
  id: row.id, area: row.area, category: row.category, code: row.code, text: row.text, hint: row.hint,
  weight: row.weight, answerType: row.answer_type, answer: row.answer, comment: row.comment,
});

/** Brak pola odpowiedzi w formularzu zostawia dotychczasową odpowiedź; puste pole ją czyści. */
function resolveAnswer(entry, item) {
  if (entry.answer === undefined) return item.answer;
  return entry.answer === '' ? null : entry.answer;
}

function createAuditsService(db, { objects, users, snapshots }) {
  const select = `
    SELECT a.*, o.name AS object_name, o.type AS object_type, o.address AS object_address,
           au.name AS auditor_name, eb.name AS entered_by_name,
           (SELECT GROUP_CONCAT(title, '; ') FROM (SELECT COALESCE(x.title, s.title) AS title FROM audit_scenarios x
              JOIN scenarios s ON s.id = x.scenario_id WHERE x.audit_id = a.id ORDER BY 1 COLLATE NOCASE)) AS scenario_title,
           rv.name AS reviewer_name,
           (SELECT COUNT(*) FROM audit_items i WHERE i.audit_id = a.id) AS item_count,
           (SELECT COUNT(*) FROM audit_items i WHERE i.audit_id = a.id AND i.answer IS NOT NULL) AS answered_count
    FROM audits a
    JOIN objects o ON o.id = a.object_id
    LEFT JOIN users au ON au.id = a.auditor_id
    LEFT JOIN users eb ON eb.id = a.entered_by
    LEFT JOIN users rv ON rv.id = a.reviewer_id`;

  const svc = {
    get: (id) => db.prepare(`${select} WHERE a.id = ?`).get(id),

    /** Czy użytkownik może zobaczyć audyt: administrator – wszystkie, audytor – swoje, koordynator – ze swojego zakresu. */
    canView(user, audit) {
      if (!user || !audit) return false;
      if (user.role === ROLES.ADMIN) return true;
      if (user.role === ROLES.AUDITOR) return audit.auditor_id === user.id;
      if (user.role === ROLES.COORDINATOR) return objects.isCoordinatedBy(audit.object_id, user.id);
      return false;
    },

    canEdit: (user, audit) => user?.role === ROLES.AUDITOR && audit.auditor_id === user.id && isEditable(audit.status),

    list(user, { status } = {}) {
      const where = ['a.archived_at IS NULL'];
      const params = [];
      if (user.role === ROLES.AUDITOR) { where.push('a.auditor_id = ?'); params.push(user.id); }
      if (user.role === ROLES.COORDINATOR) {
        const scope = objects.list({ coordinatorId: user.id }).map((o) => o.id);
        if (!scope.length) return [];
        where.push(`a.object_id IN (${scope.map(() => '?').join(',')})`);
        params.push(...scope);
      }
      if (status) { where.push('a.status = ?'); params.push(status); }
      return db.prepare(`${select} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY CASE a.status WHEN 'submitted' THEN 0 WHEN 'entered' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'assigned' THEN 3 ELSE 4 END,
                 a.due_date IS NULL, a.due_date, a.id DESC`).all(...params);
    },

    /** Scenariusze przypisane do audytu: migawki z krokami i stanem ich wykonania. */
    scenarios: (auditId) => snapshots.list('audit', auditId),
    saveSteps: (auditId, doneIds) => snapshots.setDone('audit', auditId, doneIds),

    items: (auditId) => db.prepare('SELECT * FROM audit_items WHERE audit_id = ? ORDER BY area DESC, position, id').all(auditId),
    scoringItems: (auditId) => svc.items(auditId).map(toScoringItem),

    /** Aktywny użytkownik z rolą Audytora albo wyjątek (każdy użytkownik ma tę rolę, ale konto może być nieaktywne). */
    requireAuditor(auditorId) {
      const auditor = users.findById(auditorId);
      if (!auditor || !auditor.active || !auditor.roles.includes(ROLES.AUDITOR)) {
        throw new DomainError('Wybrany użytkownik nie jest aktywnym audytorem.');
      }
      return auditor;
    },

    /**
     * Wprowadza audyt do systemu (koordynator lub administrator): tworzy migawkę aktywnych kryteriów z obszarów wszystkich
     * wybranych scenariuszy (bez powtórzeń). Bez wskazanego Tajemniczego Klienta audyt ma status „Wprowadzony do systemu”,
     * z audytorem od razu „Przydzielony do TK”.
     */
    create({ objectId, auditorId, scenarioIds, dueDate }, enteredBy) {
      const object = objects.get(objectId);
      if (!object) throw new DomainError('Wybrany obiekt nie istnieje.');
      if (auditorId) svc.requireAuditor(auditorId);
      const ids = [...new Set(scenarioIds)];
      if (!ids.length) throw new DomainError('Wybierz co najmniej jeden scenariusz.');
      const scenarios = db.prepare(
        `SELECT * FROM scenarios WHERE active = 1 AND usage IN ('audit', 'both') AND id IN (${ids.map(() => '?').join(',')})`,
      ).all(...ids);
      if (scenarios.length !== ids.length) throw new DomainError('Wybrany scenariusz nie istnieje, jest nieaktywny albo nie dotyczy audytów obiektów.');

      const areas = [...new Set(scenarios.flatMap((s) => (s.areas === 'BOTH' ? ['OZN', 'KSZTALCENIE'] : [s.areas])))];
      const criteria = db.prepare(
        `SELECT * FROM criteria WHERE active = 1 AND area IN (${areas.map(() => '?').join(',')}) ORDER BY area DESC, position, id`,
      ).all(...areas);
      if (!criteria.length) throw new DomainError('Brak aktywnych kryteriów dla zakresu wybranych scenariuszy.');
      const primary = ids[0]; // scenariusz główny = pierwszy wybrany

      return transaction(db, () => {
        const info = db.prepare(
          `INSERT INTO audits (object_id, auditor_id, scenario_id, entered_by, assigned_by, status, assigned_at, due_date)
           VALUES (?, ?, ?, ?, ?, ?, ${auditorId ? "datetime('now')" : 'NULL'}, ?)`,
        ).run(objectId, auditorId || null, primary, enteredBy, auditorId ? enteredBy : null, auditorId ? STATUS.ASSIGNED : STATUS.ENTERED, dueDate);
        snapshots.add('audit', info.lastInsertRowid, ids);
        const insert = db.prepare(`INSERT INTO audit_items
          (audit_id, criterion_id, code, area, category, text, hint, weight, answer_type, position)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const c of criteria) {
          insert.run(info.lastInsertRowid, c.id, c.code, c.area, c.category, c.text, c.hint, c.weight, c.answer_type, c.position);
        }
        return svc.get(info.lastInsertRowid);
      });
    },

    /** Przydział (lub zmiana) Tajemniczego Klienta: możliwy, dopóki audytor nie zaczął pracy. */
    assign(audit, auditorId, byUser) {
      if (!isAssignable(audit.status) || !canTransition(audit.status, STATUS.ASSIGNED, byUser.role)) {
        throw new DomainError('Tajemniczego Klienta można przydzielić tylko do audytu, nad którym nie rozpoczęto pracy.', 409);
      }
      svc.requireAuditor(auditorId);
      db.prepare(`UPDATE audits SET auditor_id = ?, assigned_by = ?, assigned_at = datetime('now'), status = ? WHERE id = ?`)
        .run(auditorId, byUser.id, STATUS.ASSIGNED, audit.id);
      return svc.get(audit.id);
    },

    /** Zapisuje (częściowo lub w całości) odpowiedzi audytora. Pierwszy zapis zmienia status na „W trakcie”. */
    saveAnswers(audit, { answers, generalNotes }) {
      if (!isEditable(audit.status)) throw new DomainError('Audyt został złożony i nie można go już edytować.', 409);
      const items = new Map(svc.items(audit.id).map((i) => [String(i.id), i]));
      const errors = {};

      for (const [itemId, entry] of Object.entries(answers)) {
        const item = items.get(itemId);
        if (!item) throw new DomainError('Odpowiedź dotyczy kryterium spoza tego audytu.', 400);
        const answer = resolveAnswer(entry, item);
        if (answer !== null && !isValidAnswer(item.answer_type, answer)) errors[itemId] = 'Niedozwolona wartość odpowiedzi.';
      }
      if (Object.keys(errors).length) throw new DomainError('Formularz zawiera niepoprawne odpowiedzi.', 422, errors);

      transaction(db, () => {
        const update = db.prepare(`UPDATE audit_items SET answer = ?, comment = ?,
          answered_at = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END WHERE id = ? AND audit_id = ?`);
        for (const [itemId, entry] of Object.entries(answers)) {
          const answer = resolveAnswer(entry, items.get(itemId));
          update.run(answer, entry.comment ? entry.comment : null, answer, Number(itemId), audit.id);
        }
        db.prepare('UPDATE audits SET general_notes = ? WHERE id = ?').run(generalNotes, audit.id);
        if (audit.status === STATUS.ASSIGNED) {
          db.prepare(`UPDATE audits SET status = ?, started_at = datetime('now') WHERE id = ?`).run(STATUS.IN_PROGRESS, audit.id);
        }
      });
      return svc.get(audit.id);
    },

    /**
     * Edycja danych audytu przez koordynatora lub administratora: termin i zestaw scenariuszy (do czasu złożenia raportu).
     * Zachowuje migawki i odhaczenia kroków scenariuszy, które zostają; nie zmienia migawki kryteriów.
     */
    update(audit, { scenarioIds, dueDate }) {
      if ([STATUS.SUBMITTED, STATUS.APPROVED].includes(audit.status)) throw new DomainError('Audytu po złożeniu raportu nie można edytować. Zwróć go do poprawy.', 409);
      const ids = [...new Set(scenarioIds || [])];
      if (!ids.length) throw new DomainError('Wybierz co najmniej jeden scenariusz.', 422);
      const found = db.prepare(`SELECT COUNT(*) AS n FROM scenarios WHERE usage IN ('audit', 'both') AND id IN (${ids.map(() => '?').join(',')})
        AND (active = 1 OR id IN (SELECT scenario_id FROM audit_scenarios WHERE audit_id = ?))`).get(...ids, audit.id).n;
      if (found !== ids.length) throw new DomainError('Wybrany scenariusz nie istnieje, jest nieaktywny albo nie dotyczy audytów obiektów.', 422);
      transaction(db, () => {
        snapshots.replace('audit', audit.id, ids);
        db.prepare('UPDATE audits SET scenario_id = ?, due_date = ? WHERE id = ?').run(ids[0], dueDate || null, audit.id);
      });
      return svc.get(audit.id);
    },

    /** Tajemniczy Klient przyjmuje przydzielony mu audyt do realizacji: „Przydzielony do TK” → „W trakcie”. */
    accept(audit, user) {
      if (audit.status !== STATUS.ASSIGNED || audit.auditor_id !== user.id || user.role !== ROLES.AUDITOR) {
        throw new DomainError('Tego audytu nie można teraz przyjąć.', 409);
      }
      db.prepare(`UPDATE audits SET status = ?, started_at = datetime('now') WHERE id = ? AND status = ?`).run(STATUS.IN_PROGRESS, audit.id, STATUS.ASSIGNED);
      return svc.get(audit.id);
    },

    /**
     * Tajemniczy Klient odrzuca przydzielony mu audyt (np. nie może go wykonać), także rozpoczęty („W trakcie”). Audyt wraca do statusu „Wprowadzony do systemu”
     * bez audytora, żeby koordynator lub administrator mógł przydzielić go komuś innemu. Uzasadnienie jest wymagane.
     */
    decline(audit, user, reason) {
      if (![STATUS.ASSIGNED, STATUS.IN_PROGRESS].includes(audit.status) || audit.auditor_id !== user.id || user.role !== ROLES.AUDITOR) {
        throw new DomainError('Tego audytu nie można teraz odrzucić.', 409);
      }
      const text = String(reason ?? '').trim();
      if (text.length < 3) throw new DomainError('Podaj powód odrzucenia audytu (co najmniej 3 znaki).', 422);
      if (text.length > 1000) throw new DomainError('Powód odrzucenia jest za długi (maksymalnie 1000 znaków).', 422);
      // Wprowadzone odpowiedzi i załączniki zostają przy audycie; koordynator decyduje, komu go przydzielić.
      db.prepare(`UPDATE audits SET status = ?, auditor_id = NULL, assigned_by = NULL, assigned_at = NULL, started_at = NULL WHERE id = ? AND status = ?`)
        .run(STATUS.ENTERED, audit.id, audit.status);
      return { audit: svc.get(audit.id), reason: text, wasInProgress: audit.status === STATUS.IN_PROGRESS, answered: audit.answered_count, total: audit.item_count };
    },

    submit(audit, user) {
      if (!canTransition(audit.status, STATUS.SUBMITTED, user.role) || audit.auditor_id !== user.id) {
        throw new DomainError('Tego audytu nie można teraz złożyć.', 409);
      }
      const problems = validateForSubmit(svc.scoringItems(audit.id));
      if (problems.length) throw new DomainError('Audyt nie jest kompletny.', 422, problems);
      db.prepare(`UPDATE audits SET status = ?, submitted_at = datetime('now'), review_comment = NULL WHERE id = ?`)
        .run(STATUS.SUBMITTED, audit.id);
      return svc.get(audit.id);
    },

    approve(audit, user, comment) {
      if (!canTransition(audit.status, STATUS.APPROVED, user.role)) throw new DomainError('Ten audyt nie oczekuje na zatwierdzenie.', 409);
      db.prepare(`UPDATE audits SET status = ?, approved_at = datetime('now'), reviewer_id = ?, review_comment = ? WHERE id = ?`)
        .run(STATUS.APPROVED, user.id, comment, audit.id);
      return svc.get(audit.id);
    },

    returnForCorrection(audit, user, comment) {
      if (!canTransition(audit.status, STATUS.IN_PROGRESS, user.role)) throw new DomainError('Ten audyt nie oczekuje na weryfikację.', 409);
      db.prepare(`UPDATE audits SET status = ?, submitted_at = NULL, reviewer_id = ?, review_comment = ? WHERE id = ?`)
        .run(STATUS.IN_PROGRESS, user.id, comment, audit.id);
      return svc.get(audit.id);
    },

    /** Audyt można usunąć tylko przed rozpoczęciem pracy. */
    remove(audit) {
      if (!isAssignable(audit.status)) throw new DomainError('Można usunąć tylko audyt, nad którym nie rozpoczęto pracy (statusy „Wprowadzony do systemu” i „Przydzielony do TK”).', 409);
      db.prepare('DELETE FROM audits WHERE id = ?').run(audit.id);
    },
  };
  return svc;
}

module.exports = { createAuditsService, DomainError, toScoringItem, resolveAnswer };
