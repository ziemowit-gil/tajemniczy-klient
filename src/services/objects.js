function createObjectsService(db) {
  const getStmt = db.prepare(`
    SELECT o.*, p.name AS parent_name, u.name AS coordinator_name
    FROM objects o
    LEFT JOIN objects p ON p.id = o.parent_id
    LEFT JOIN users u ON u.id = o.coordinator_id
    WHERE o.id = ?`);

  const descendantsStmt = db.prepare(`
    WITH RECURSIVE tree(id) AS (
      SELECT id FROM objects WHERE id = ?
      UNION
      SELECT o.id FROM objects o JOIN tree t ON o.parent_id = t.id
    ) SELECT id FROM tree`);

  const ancestorsStmt = db.prepare(`
    WITH RECURSIVE up(id, parent_id) AS (
      SELECT id, parent_id FROM objects WHERE id = ?
      UNION
      SELECT o.id, o.parent_id FROM objects o JOIN up ON o.id = up.parent_id
    ) SELECT id FROM up`);

  const svc = {
    get: (id) => getStmt.get(id),

    /** id obiektu wraz ze wszystkimi obiektami podrzędnymi. */
    descendantIds: (id) => descendantsStmt.all(id).map((r) => r.id),
    /** id obiektu wraz ze wszystkimi nadrzędnymi. */
    ancestorIds: (id) => ancestorsStmt.all(id).map((r) => r.id),

    /** Id koordynatorów obiektu: z samego obiektu i z obiektów nadrzędnych (np. uczelni). */
    coordinatorIds(objectId) {
      const ids = svc.ancestorIds(objectId);
      if (!ids.length) return [];
      return db.prepare(`SELECT DISTINCT coordinator_id AS id FROM objects WHERE coordinator_id IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`)
        .all(...ids).map((r) => r.id);
    },

    /** Czy użytkownik koordynuje obiekt bezpośrednio albo przez obiekt nadrzędny (np. uczelnię). */
    isCoordinatedBy(objectId, userId) {
      const marks = svc.ancestorIds(objectId);
      if (!marks.length) return false;
      return db.prepare(`SELECT 1 FROM objects WHERE coordinator_id = ? AND id IN (${marks.map(() => '?').join(',')})`)
        .get(userId, ...marks) !== undefined;
    },

    /** Lista obiektów; koordynator widzi tylko obiekty ze swojego zakresu (jego i podległe). */
    list({ coordinatorId } = {}) {
      let where = '';
      const params = [];
      if (coordinatorId) {
        const roots = db.prepare('SELECT id FROM objects WHERE coordinator_id = ?').all(coordinatorId).map((r) => r.id);
        const ids = [...new Set(roots.flatMap((id) => svc.descendantIds(id)))];
        if (!ids.length) return [];
        where = `WHERE o.id IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
      }
      return db.prepare(`
        SELECT o.*, p.name AS parent_name, u.name AS coordinator_name,
          (SELECT COUNT(*) FROM audits a WHERE a.object_id = o.id) AS audit_count,
          (SELECT a.status FROM audits a WHERE a.object_id = o.id ORDER BY a.id DESC LIMIT 1) AS audit_status
        FROM objects o
        LEFT JOIN objects p ON p.id = o.parent_id
        LEFT JOIN users u ON u.id = o.coordinator_id
        ${where}
        ORDER BY COALESCE(p.name, o.name) COLLATE NOCASE, o.parent_id IS NOT NULL, o.name COLLATE NOCASE`).all(...params);
    },

    /** Obiekty, które mogą być rodzicem (bez samego obiektu i jego potomków, by nie tworzyć cykli). */
    parentOptions(excludeId) {
      const all = db.prepare('SELECT id, name, type FROM objects ORDER BY name COLLATE NOCASE').all();
      if (!excludeId) return all;
      const banned = new Set(svc.descendantIds(excludeId));
      return all.filter((o) => !banned.has(o.id));
    },

    create(d) {
      const info = db.prepare(
        'INSERT INTO objects (parent_id, name, type, address, coordinator_id, notes) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(d.parentId, d.name, d.type, d.address, d.coordinatorId, d.notes);
      return svc.get(info.lastInsertRowid);
    },

    update(id, d) {
      if (d.parentId && svc.descendantIds(id).includes(d.parentId)) {
        const err = new Error('Obiekt nie może być podrzędny wobec samego siebie ani swoich obiektów podrzędnych.');
        err.status = 422;
        throw err;
      }
      db.prepare(`UPDATE objects SET parent_id = ?, name = ?, type = ?, address = ?, coordinator_id = ?, notes = ?,
        updated_at = datetime('now') WHERE id = ?`).run(d.parentId, d.name, d.type, d.address, d.coordinatorId, d.notes, id);
      return svc.get(id);
    },

    /** Zwraca powód odmowy albo null, jeśli można usunąć. */
    deletionBlocker(id) {
      if (db.prepare('SELECT 1 FROM objects WHERE parent_id = ?').get(id)) return 'Obiekt ma obiekty podrzędne.';
      if (db.prepare('SELECT 1 FROM audits WHERE object_id = ?').get(id)) return 'Obiekt ma przypisane audyty.';
      return null;
    },

    remove(id) {
      db.prepare('DELETE FROM objects WHERE id = ?').run(id);
    },
  };
  return svc;
}

module.exports = { createObjectsService };
