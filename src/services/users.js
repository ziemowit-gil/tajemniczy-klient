const { ROLES } = require('../domain/constants');

function createUsersService(db, { defaultRole }) {
  const byExternal = db.prepare('SELECT * FROM users WHERE external_id = ?');
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');

  return {
    findById: (id) => byId.get(id),

    /**
     * Tworzy lub aktualizuje użytkownika na podstawie tożsamości z SZO.
     * Rola z SZO (jeśli rozpoznana) jest źródłem prawdy; bez niej zostaje rola nadana lokalnie przez administratora.
     */
    upsertFromIdentity(identity) {
      const existing = byExternal.get(identity.externalId);
      if (!existing) {
        const info = db.prepare(
          `INSERT INTO users (external_id, name, email, role, last_login_at) VALUES (?, ?, ?, ?, datetime('now'))`,
        ).run(identity.externalId, identity.name, identity.email, identity.role || defaultRole);
        return byId.get(info.lastInsertRowid);
      }
      db.prepare(
        `UPDATE users SET name = ?, email = ?, role = ?, last_login_at = datetime('now') WHERE id = ?`,
      ).run(identity.name, identity.email, identity.role || existing.role, existing.id);
      return byId.get(existing.id);
    },

    list: () => db.prepare('SELECT * FROM users ORDER BY active DESC, name COLLATE NOCASE').all(),
    listByRole: (...roles) => {
      const marks = roles.map(() => '?').join(',');
      return db.prepare(`SELECT * FROM users WHERE active = 1 AND role IN (${marks}) ORDER BY name COLLATE NOCASE`).all(...roles);
    },

    update(id, { role, active }) {
      const user = byId.get(id);
      if (!user) return null;
      db.prepare('UPDATE users SET role = ?, active = ? WHERE id = ?').run(role, active ? 1 : 0, id);
      return byId.get(id);
    },

    setNotify: (id, enabled) => db.prepare('UPDATE users SET notify_email = ? WHERE id = ?').run(enabled ? 1 : 0, id),

    countActiveAdmins: () => db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = ? AND active = 1`).get(ROLES.ADMIN).n,
  };
}

module.exports = { createUsersService };
