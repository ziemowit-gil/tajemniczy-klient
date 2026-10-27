const { transaction } = require('../db');

/** Kryteria audytu i scenariusze „Tajemniczego Klienta”. */
function createCatalogService(db) {
  const criteria = {
    list: ({ onlyActive = false } = {}) => db.prepare(
      `SELECT * FROM criteria ${onlyActive ? 'WHERE active = 1' : ''} ORDER BY area, position, id`,
    ).all(),
    get: (id) => db.prepare('SELECT * FROM criteria WHERE id = ?').get(id),
    codeTaken: (code, exceptId = 0) => db.prepare('SELECT 1 FROM criteria WHERE code = ? AND id <> ?').get(code, exceptId) !== undefined,
    create(d) {
      const info = db.prepare(`INSERT INTO criteria (code, area, category, text, hint, weight, answer_type, position, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.code, d.area, d.category, d.text, d.hint, d.weight, d.answerType, d.position, d.active ? 1 : 0);
      return criteria.get(info.lastInsertRowid);
    },
    update(id, d) {
      db.prepare(`UPDATE criteria SET code = ?, area = ?, category = ?, text = ?, hint = ?, weight = ?, answer_type = ?,
        position = ?, active = ? WHERE id = ?`).run(d.code, d.area, d.category, d.text, d.hint, d.weight, d.answerType, d.position, d.active ? 1 : 0, id);
      return criteria.get(id);
    },
    /** Kryteria użyte w audytach są tylko wyłączane (migawki w audit_items i tak zachowują treść). */
    remove(id) {
      db.prepare('DELETE FROM criteria WHERE id = ?').run(id);
    },
  };

  const scenarios = {
    /** usage: 'audit' | 'education' – scenariusze tego modułu oraz wspólne ('both'); active: true | false. */
    list: ({ onlyActive = false, usage, active } = {}) => {
      const where = [];
      const params = [];
      if (onlyActive || active === true) where.push('s.active = 1');
      if (active === false) where.push('s.active = 0');
      if (usage) { where.push(`s.usage IN (?, 'both')`); params.push(usage); }
      return db.prepare(`SELECT s.*,
          (SELECT COUNT(*) FROM scenario_steps st WHERE st.scenario_id = s.id) AS step_count,
          (SELECT COUNT(*) FROM audit_scenarios x WHERE x.scenario_id = s.id)
            + (SELECT COUNT(*) FROM office_review_scenarios x WHERE x.scenario_id = s.id) AS use_count
        FROM scenarios s ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.title COLLATE NOCASE`).all(...params);
    },
    get: (id) => db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id),
    steps: (id) => db.prepare('SELECT id, position, text FROM scenario_steps WHERE scenario_id = ? ORDER BY position, id').all(id),

    /** Audyty i oceny, które korzystają ze scenariusza (do podglądu). */
    usageOf(id) {
      const audits = db.prepare(`SELECT a.id, a.status, o.name AS object_name, u.name AS auditor_name, x.version
        FROM audit_scenarios x JOIN audits a ON a.id = x.audit_id JOIN objects o ON o.id = a.object_id JOIN users u ON u.id = a.auditor_id
        WHERE x.scenario_id = ? ORDER BY a.id DESC`).all(id);
      const reviews = db.prepare(`SELECT r.id, r.status, r.programme, o.name AS object_name, u.name AS auditor_name, x.version
        FROM office_review_scenarios x JOIN office_reviews r ON r.id = x.review_id JOIN objects o ON o.id = r.object_id JOIN users u ON u.id = r.auditor_id
        WHERE x.scenario_id = ? ORDER BY r.id DESC`).all(id);
      return { audits, reviews };
    },

    create(d) {
      return transaction(db, () => {
        const info = db.prepare(`INSERT INTO scenarios (title, description, goal, persona, expected_result, estimated_minutes, areas, usage, active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.title, d.description, d.goal, d.persona, d.expectedResult, d.estimatedMinutes, d.areas, d.usage, d.active ? 1 : 0);
        scenarios.writeSteps(info.lastInsertRowid, d.steps);
        return scenarios.get(info.lastInsertRowid);
      });
    },

    writeSteps(id, steps) {
      db.prepare('DELETE FROM scenario_steps WHERE scenario_id = ?').run(id);
      const insert = db.prepare('INSERT INTO scenario_steps (scenario_id, position, text) VALUES (?, ?, ?)');
      steps.forEach((text, i) => insert.run(id, i + 1, text));
    },

    /** Zmiana treści (tytuł, opisy, kroki, persona, czas) podnosi numer wersji; sama zmiana aktywności i użycia – nie. */
    update(id, d) {
      return transaction(db, () => {
        const before = scenarios.get(id);
        const oldSteps = scenarios.steps(id).map((s) => s.text);
        const contentChanged = before.title !== d.title || (before.description ?? null) !== d.description || (before.goal ?? null) !== d.goal
          || (before.persona ?? null) !== d.persona || (before.expected_result ?? null) !== d.expectedResult
          || (before.estimated_minutes ?? null) !== d.estimatedMinutes || before.areas !== d.areas
          || JSON.stringify(oldSteps) !== JSON.stringify(d.steps);
        db.prepare(`UPDATE scenarios SET title = ?, description = ?, goal = ?, persona = ?, expected_result = ?, estimated_minutes = ?,
          areas = ?, usage = ?, active = ?, version = version + ? WHERE id = ?`)
          .run(d.title, d.description, d.goal, d.persona, d.expectedResult, d.estimatedMinutes, d.areas, d.usage, d.active ? 1 : 0, contentChanged ? 1 : 0, id);
        if (JSON.stringify(oldSteps) !== JSON.stringify(d.steps)) scenarios.writeSteps(id, d.steps);
        return scenarios.get(id);
      });
    },

    /** Kopia scenariusza (z krokami) jako nowy, wyłączony szkic w wersji 1. */
    duplicate(id) {
      const src = scenarios.get(id);
      return scenarios.create({
        title: `Kopia: ${src.title}`.slice(0, 150), description: src.description, goal: src.goal, persona: src.persona,
        expectedResult: src.expected_result, estimatedMinutes: src.estimated_minutes, areas: src.areas, usage: src.usage,
        steps: scenarios.steps(id).map((s) => s.text), active: false,
      });
    },

    inUse: (id) => db.prepare('SELECT 1 FROM audit_scenarios WHERE scenario_id = ?').get(id) !== undefined
      || db.prepare('SELECT 1 FROM office_review_scenarios WHERE scenario_id = ?').get(id) !== undefined,
    remove(id) {
      db.prepare('DELETE FROM scenarios WHERE id = ?').run(id);
    },
  };

  return { criteria, scenarios };
}

module.exports = { createCatalogService };
