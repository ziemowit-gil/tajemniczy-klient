/**
 * Archiwizacja, przywracanie i trwałe usuwanie danych (audyty, oceny kształcenia, obiekty, scenariusze) oraz dziennik
 * operacji. Archiwum ukrywa pozycje na listach roboczych, ale nic nie kasuje; usunięcie trwałe jest osobną, potwierdzaną operacją.
 */
const { DomainError } = require('./audits');

const KINDS = {
  audit: { table: 'audits', label: 'Audyt', names: `(SELECT o.name FROM objects o WHERE o.id = t.object_id)`, needsApproved: true },
  review: { table: 'office_reviews', label: 'Ocena „Dostępność kształcenia”', names: `(SELECT o.name FROM objects o WHERE o.id = t.object_id) || ', ' || t.programme`, needsApproved: true },
  object: { table: 'objects', label: 'Obiekt', names: 't.name' },
  scenario: { table: 'scenarios', label: 'Scenariusz', names: 't.title' },
};

function createArchiveService(db, { objects, catalog, attachments }) {
  const kind = (k) => {
    const c = KINDS[k];
    if (!c) throw new DomainError('Nieznany rodzaj danych.', 404);
    return c;
  };
  const row = (k, id) => db.prepare(`SELECT t.*, ${kind(k).names} AS display_name FROM ${kind(k).table} t WHERE t.id = ?`).get(id);

  const svc = {
    KINDS,
    get: row,

    log(actor, k, id, name, action, note = null) {
      db.prepare('INSERT INTO operation_log (actor_id, actor_name, entity_type, entity_id, entity_name, action, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(actor?.id ?? null, actor?.name ?? null, k, id ?? null, name ?? null, action, note ? String(note).slice(0, 1000) : null);
    },
    recent: (limit = 300) => db.prepare('SELECT * FROM operation_log ORDER BY id DESC LIMIT ?').all(limit),

    archive(k, id, actor) {
      const c = kind(k); const r = row(k, id);
      if (!r) throw new DomainError('Nie znaleziono pozycji.', 404);
      if (r.archived_at) throw new DomainError('Pozycja jest już w archiwum.', 409);
      if (c.needsApproved && r.status !== 'approved') throw new DomainError('Archiwizować można tylko zatwierdzone pozycje. Pozostałe można usunąć.', 409);
      db.prepare(`UPDATE ${c.table} SET archived_at = datetime('now') WHERE id = ?`).run(id);
      svc.log(actor, k, id, r.display_name, 'archived');
      return r;
    },

    restore(k, id, actor) {
      const c = kind(k); const r = row(k, id);
      if (!r) throw new DomainError('Nie znaleziono pozycji.', 404);
      if (!r.archived_at) throw new DomainError('Pozycja nie jest w archiwum.', 409);
      db.prepare(`UPDATE ${c.table} SET archived_at = NULL WHERE id = ?`).run(id);
      svc.log(actor, k, id, r.display_name, 'restored');
      return r;
    },

    /**
     * Trwałe usunięcie. Audyty i oceny: dowolny status (razem z pozycjami, scenariuszami, załącznikami i plikami na dysku).
     * Obiekty i scenariusze: tylko gdy nic ich nie używa.
     */
    async purge(k, id, actor) {
      const r = row(k, id);
      if (!r) throw new DomainError('Nie znaleziono pozycji.', 404);
      if (k === 'object') {
        const blocker = objects.deletionBlocker(id);
        if (blocker) throw new DomainError(`Nie można usunąć obiektu: ${blocker} Zarchiwizuj go zamiast usuwać.`, 409);
        objects.remove(id);
      } else if (k === 'scenario') {
        if (catalog.scenarios.inUse(id)) throw new DomainError('Scenariusz jest użyty w audytach lub ocenach. Zarchiwizuj go zamiast usuwać.', 409);
        catalog.scenarios.remove(id);
      } else {
        await attachments.purge(k, id);
        db.prepare(`DELETE FROM ${kind(k).table} WHERE id = ?`).run(id);
      }
      svc.log(actor, k, id, r.display_name, 'purged', r.status ? `status: ${r.status}` : null);
      return r;
    },

    /** Zarchiwizowane pozycje danego rodzaju; `visible(row)` zawęża zakres (np. koordynator widzi tylko swoje obiekty). */
    listArchived(k, visible = () => true) {
      const c = kind(k);
      const extra = k === 'audit' || k === 'review' ? ', t.object_id, t.status' : '';
      return db.prepare(`SELECT t.id, t.archived_at, ${c.names} AS display_name${extra} FROM ${c.table} t WHERE t.archived_at IS NOT NULL ORDER BY t.archived_at DESC`)
        .all().filter(visible);
    },
  };
  return svc;
}

module.exports = { createArchiveService, KINDS };
