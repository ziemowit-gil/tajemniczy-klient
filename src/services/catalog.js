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
    /** usage: 'audit' | 'education' – zwraca scenariusze tego modułu oraz wspólne ('both'). */
    list: ({ onlyActive = false, usage } = {}) => {
      const where = [];
      const params = [];
      if (onlyActive) where.push('active = 1');
      if (usage) { where.push(`usage IN (?, 'both')`); params.push(usage); }
      return db.prepare(`SELECT * FROM scenarios ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY title COLLATE NOCASE`).all(...params);
    },
    get: (id) => db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id),
    create(d) {
      const info = db.prepare('INSERT INTO scenarios (title, description, areas, usage, active) VALUES (?, ?, ?, ?, ?)')
        .run(d.title, d.description, d.areas, d.usage, d.active ? 1 : 0);
      return scenarios.get(info.lastInsertRowid);
    },
    update(id, d) {
      db.prepare('UPDATE scenarios SET title = ?, description = ?, areas = ?, usage = ?, active = ? WHERE id = ?')
        .run(d.title, d.description, d.areas, d.usage, d.active ? 1 : 0, id);
      return scenarios.get(id);
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
