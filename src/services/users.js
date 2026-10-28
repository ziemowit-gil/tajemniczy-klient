const { ROLES } = require('../domain/constants');

/** Kolejność od najniższej do najwyższej roli (także kolejność wyświetlania). */
const ROLE_ORDER = [ROLES.AUDITOR, ROLES.COORDINATOR, ROLES.ADMIN];
const sortRoles = (roles) => ROLE_ORDER.filter((r) => roles.includes(r));
const highestRole = (roles) => [...ROLE_ORDER].reverse().find((r) => roles.includes(r)) || ROLES.AUDITOR;

/**
 * Użytkownicy i ich role. Każdy użytkownik ma obowiązkową rolę Audytora (Tajemniczego Klienta) oraz opcjonalnie rolę
 * Koordynatora i/lub Administratora. `users.role` to ostatnio używana rola (domyślna po zalogowaniu); w trakcie sesji
 * aktywną rolę wybiera się osobno (przełącznik ról), więc dwie sesje tej samej osoby mogą działać w różnych rolach.
 */
function createUsersService(db, { defaultRole }) {
  const byExternal = db.prepare('SELECT * FROM users WHERE external_id = ?');
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const rolesOf = db.prepare('SELECT role FROM user_roles WHERE user_id = ?');
  // Skrót hasła i dane blokady nie opuszczają bazy: widoki dostają tylko `hasPassword`.
  const hydrate = (row) => {
    if (!row) return row;
    const { password_hash: passwordHash, failed_logins: failed, ...rest } = row;
    return { ...rest, hasPassword: Boolean(passwordHash), roles: sortRoles(rolesOf.all(row.id).map((r) => r.role)) };
  };

  /** Ustawia komplet ról (Audytor zawsze), usuwając pozostałe. */
  function writeRoles(userId, extras) {
    const wanted = new Set([ROLES.AUDITOR, ...extras.filter((r) => ROLE_ORDER.includes(r))]);
    db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT INTO user_roles (user_id, role) VALUES (?, ?)');
    for (const r of wanted) insert.run(userId, r);
    return [...wanted];
  }

  /** Zapisuje ostatnio używaną rolę, pilnując, by była jedną z przyznanych (w przeciwnym razie najwyższa). */
  function storeActiveRole(userId, roles, preferred) {
    const role = roles.includes(preferred) ? preferred : highestRole(roles);
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  }

  const svc = {
    ROLE_ORDER,
    findById: (id) => hydrate(byId.get(id)),

    /** Aktywna rola w sesji: wybrana w sesji, w przeciwnym razie ostatnio używana, w ostateczności najwyższa przyznana. */
    effectiveRole: (user, preferred) => (user.roles.includes(preferred) ? preferred : (user.roles.includes(user.role) ? user.role : highestRole(user.roles))),

    hasRole: (id, role) => db.prepare('SELECT 1 FROM user_roles WHERE user_id = ? AND role = ?').get(id, role) !== undefined,

    /**
     * Tworzy lub aktualizuje użytkownika na podstawie tożsamości z SZO. Nowa osoba dostaje rolę Audytora oraz ewentualnie
     * rolę z SZO (albo domyślną). Rola z SZO (jeśli rozpoznana) jest dodawana do przyznanych i ustawiana jako domyślna;
     * bez niej role nadane lokalnie przez administratora pozostają bez zmian.
     */
    upsertFromIdentity(identity) {
      let existing = byExternal.get(identity.externalId);
      // To samo konto SZO mogło wcześniej powstać pod innym identyfikatorem (np. z dawnego logowania): jedyny pasujący
      // adres e-mail wśród kont z SZO przejmuje nowy identyfikator zamiast tworzyć zdublowane konto bez przypisanych audytów.
      if (!existing && identity.email && identity.externalId.startsWith('szo:')) {
        const same = db.prepare(`SELECT * FROM users WHERE lower(email) = ? AND kind = 'szo' AND external_id NOT LIKE 'dev:%'`).all(identity.email.trim().toLowerCase());
        if (same.length === 1) {
          db.prepare('UPDATE users SET external_id = ? WHERE id = ?').run(identity.externalId, same[0].id);
          existing = byExternal.get(identity.externalId);
        }
      }
      if (!existing) {
        const initial = identity.role || defaultRole;
        const info = db.prepare(
          `INSERT INTO users (external_id, name, email, role, last_login_at) VALUES (?, ?, ?, ?, datetime('now'))`,
        ).run(identity.externalId, identity.name, identity.email, initial);
        writeRoles(info.lastInsertRowid, [initial]);
        return svc.findById(info.lastInsertRowid);
      }
      db.prepare(`UPDATE users SET name = ?, email = ?, last_login_at = datetime('now') WHERE id = ?`).run(identity.name, identity.email, existing.id);
      if (identity.role) {
        const roles = hydrate(existing).roles;
        const next = writeRoles(existing.id, [...roles, identity.role]);
        storeActiveRole(existing.id, next, identity.role);
      }
      return svc.findById(existing.id);
    },

    list: () => db.prepare('SELECT * FROM users ORDER BY active DESC, name COLLATE NOCASE').all().map(hydrate),

    /** Aktywni użytkownicy, którzy mają przyznaną którąkolwiek z ról (nie tylko aktywną w danej chwili). */
    listByRole(...roles) {
      const marks = roles.map(() => '?').join(',');
      return db.prepare(`SELECT DISTINCT u.* FROM users u JOIN user_roles r ON r.user_id = u.id
        WHERE u.active = 1 AND r.role IN (${marks}) ORDER BY u.name COLLATE NOCASE`).all(...roles).map(hydrate);
    },

    /** Zgodność wsteczna: jedna rola obok obowiązkowej roli Audytora. */
    update(id, { role, active }) {
      if (!byId.get(id)) return null;
      return svc.setRoles(id, { extras: role === ROLES.AUDITOR ? [] : [role], active, activeRole: role });
    },

    /** Ustawia role dodatkowe (Audytor jest zawsze) i aktywność konta; `activeRole` opcjonalnie wskazuje rolę domyślną. */
    setRoles(id, { extras, active, activeRole }) {
      if (!byId.get(id)) return null;
      const roles = writeRoles(id, extras);
      db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
      storeActiveRole(id, roles, activeRole ?? byId.get(id).role);
      return svc.findById(id);
    },

    /** Przełącza ostatnio używaną rolę (zapamiętywaną na kolejne logowanie); zwraca false, gdy rola nie jest przyznana. */
    switchRole(id, role) {
      const user = svc.findById(id);
      if (!user || !user.roles.includes(role)) return false;
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
      return true;
    },

    setNotify: (id, enabled) => db.prepare('UPDATE users SET notify_email = ? WHERE id = ?').run(enabled ? 1 : 0, id),

    exists: (externalId) => byExternal.get(externalId) !== undefined,

    /** Adresy e-mail powtarzające się na kilku kontach (możliwe zdublowane konta) – małymi literami. */
    duplicateEmails: () => new Set(db.prepare(`SELECT lower(email) AS e FROM users WHERE email IS NOT NULL GROUP BY lower(email) HAVING COUNT(*) > 1`).all().map((r) => r.e)),
    existingExternalIds: () => new Set(db.prepare('SELECT external_id FROM users').all().map((r) => r.external_id)),

    /** Powiązania blokujące usunięcie konta: audyty i oceny wykonywane przez osobę oraz złożone oświadczenia (ślad prawny). */
    usage(id) {
      const n = (sql) => db.prepare(sql).get(id).n;
      return {
        audits: n('SELECT COUNT(*) AS n FROM audits WHERE auditor_id = ?'),
        reviews: n('SELECT COUNT(*) AS n FROM office_reviews WHERE auditor_id = ?'),
        declarations: n('SELECT COUNT(*) AS n FROM declarations WHERE user_id = ?'),
      };
    },

    /** Trwale usuwa konto bez powiązań (np. założone omyłkowo); w przeciwnym razie zwraca false i nic nie zmienia. */
    remove(id) {
      const u = svc.usage(id);
      if (u.audits || u.reviews || u.declarations) return false;
      return db.prepare('DELETE FROM users WHERE id = ?').run(id).changes === 1;
    },

    /** Reaktywuje konto i zdejmuje blokadę logowania po błędnych hasłach. */
    reactivate(id) {
      if (!byId.get(id)) return null;
      db.prepare('UPDATE users SET active = 1, failed_logins = 0, locked_until = NULL WHERE id = ?').run(id);
      return svc.findById(id);
    },

    countActiveAdmins: () => db.prepare(`SELECT COUNT(DISTINCT u.id) AS n FROM users u JOIN user_roles r ON r.user_id = u.id
      WHERE r.role = ? AND u.active = 1`).get(ROLES.ADMIN).n,
  };
  return svc;
}

module.exports = { createUsersService, ROLE_ORDER };
