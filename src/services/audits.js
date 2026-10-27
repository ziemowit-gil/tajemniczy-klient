const { transaction } = require('../db');
const { ROLES } = require('../domain/constants');
const { STATUS, canTransition, isEditable } = require('../domain/workflow');
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

function createAuditsService(db, { objects, users }) {
  const select = `
    SELECT a.*, o.name AS object_name, o.type AS object_type, o.address AS object_address,
           au.name AS auditor_name,
           (SELECT GROUP_CONCAT(title, '; ') FROM (SELECT s.title FROM audit_scenarios x JOIN scenarios s ON s.id = x.scenario_id
              WHERE x.audit_id = a.id ORDER BY s.title COLLATE NOCASE)) AS scenario_title,
           rv.name AS reviewer_name,
           (SELECT COUNT(*) FROM audit_items i WHERE i.audit_id = a.id) AS item_count,
           (SELECT COUNT(*) FROM audit_items i WHERE i.audit_id = a.id AND i.answer IS NOT NULL) AS answered_count
    FROM audits a
    JOIN objects o ON o.id = a.object_id
    JOIN users au ON au.id = a.auditor_id
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
      const where = [];
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
        ORDER BY CASE a.status WHEN 'submitted' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'assigned' THEN 2 ELSE 3 END,
                 a.due_date IS NULL, a.due_date, a.id DESC`).all(...params);
    },

    /** Scenariusze przypisane do audytu (tytuł i instrukcja). */
    scenarios: (auditId) => db.prepare(`SELECT s.id, s.title, s.description, s.areas FROM audit_scenarios x
      JOIN scenarios s ON s.id = x.scenario_id WHERE x.audit_id = ? ORDER BY s.title COLLATE NOCASE`).all(auditId),

    items: (auditId) => db.prepare('SELECT * FROM audit_items WHERE audit_id = ? ORDER BY area DESC, position, id').all(auditId),
    scoringItems: (auditId) => svc.items(auditId).map(toScoringItem),

    /**
     * Przydziela audyt: tworzy migawkę aktywnych kryteriów z obszarów wszystkich wybranych scenariuszy
     * (kryteria się nie powtarzają, nawet gdy zakresy scenariuszy na siebie zachodzą).
     */
    create({ objectId, auditorId, scenarioIds, dueDate }, assignedBy) {
      const object = objects.get(objectId);
      if (!object) throw new DomainError('Wybrany obiekt nie istnieje.');
      const auditor = users.findById(auditorId);
      if (!auditor || !auditor.active || auditor.role !== ROLES.AUDITOR) {
        throw new DomainError('Wybrany użytkownik nie jest aktywnym audytorem.');
      }
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
          'INSERT INTO audits (object_id, auditor_id, scenario_id, assigned_by, due_date) VALUES (?, ?, ?, ?, ?)',
        ).run(objectId, auditorId, primary, assignedBy, dueDate);
        const link = db.prepare('INSERT INTO audit_scenarios (audit_id, scenario_id) VALUES (?, ?)');
        for (const id of ids) link.run(info.lastInsertRowid, id);
        const insert = db.prepare(`INSERT INTO audit_items
          (audit_id, criterion_id, code, area, category, text, hint, weight, answer_type, position)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const c of criteria) {
          insert.run(info.lastInsertRowid, c.id, c.code, c.area, c.category, c.text, c.hint, c.weight, c.answer_type, c.position);
        }
        return svc.get(info.lastInsertRowid);
      });
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
      if (audit.status !== STATUS.ASSIGNED) throw new DomainError('Można usunąć tylko audyt w statusie „Przypisany”.', 409);
      db.prepare('DELETE FROM audits WHERE id = ?').run(audit.id);
    },
  };
  return svc;
}

module.exports = { createAuditsService, DomainError, toScoringItem, resolveAnswer };
