const { ROLES } = require('../domain/constants');
const { STATUS } = require('../domain/workflow');
const { buildSummary, scoreItems } = require('../domain/scoring');
const { toScoringItem } = require('./audits');

function createReportsService(db, { objects, audits }) {
  const itemsOf = (auditId) => db.prepare('SELECT * FROM audit_items WHERE audit_id = ?').all(auditId).map(toScoringItem);

  const svc = {
    canViewObject(user, objectId) {
      if (user.role === ROLES.ADMIN) return true;
      if (user.role === ROLES.COORDINATOR) return objects.isCoordinatedBy(objectId, user.id);
      return false;
    },

    /** Raport pojedynczego audytu (może być wstępny, jeśli audyt nie jest zatwierdzony). */
    forAudit(audit) {
      const items = audits.items(audit.id).map((row) => ({ ...toScoringItem(row), comment: row.comment }));
      const attachments = db.prepare(`SELECT att.audit_item_id, att.original_name FROM attachments att
        JOIN audit_items i ON i.id = att.audit_item_id WHERE i.audit_id = ? ORDER BY att.id`).all(audit.id);
      return {
        audit,
        items,
        attachments,
        summary: buildSummary(items, { objectName: audit.object_name }),
        preliminary: audit.status !== STATUS.APPROVED,
      };
    },

    /**
     * Raport zbiorczy obiektu (np. uczelni): wyniki ze wszystkich ZATWIERDZONYCH audytów obiektu i obiektów podrzędnych.
     * Kryteria z wielu audytów sumują się z zachowaniem wag.
     */
    forObject(objectId) {
      const object = objects.get(objectId);
      const ids = objects.descendantIds(objectId);
      const rows = db.prepare(`
        SELECT a.id, a.approved_at, a.scenario_id, a.object_id, o.name AS object_name, o.type AS object_type, s.title AS scenario_title,
               au.name AS auditor_name
        FROM audits a JOIN objects o ON o.id = a.object_id JOIN scenarios s ON s.id = a.scenario_id
        JOIN users au ON au.id = a.auditor_id
        WHERE a.status = ? AND a.object_id IN (${ids.map(() => '?').join(',')})
        ORDER BY a.approved_at DESC, a.id DESC`).all(STATUS.APPROVED, ...ids);

      const perAudit = rows.map((r) => {
        const items = itemsOf(r.id);
        return { ...r, score: scoreItems(items), items };
      });
      const allItems = perAudit.flatMap((a) => a.items);
      const pending = db.prepare(`SELECT COUNT(*) AS n FROM audits WHERE status <> ? AND object_id IN (${ids.map(() => '?').join(',')})`)
        .get(STATUS.APPROVED, ...ids).n;

      return {
        object,
        audits: perAudit,
        pendingAudits: pending,
        summary: buildSummary(allItems, { objectName: object.name }),
      };
    },

    /** Przegląd uczelni (obiekty najwyższego poziomu w zakresie użytkownika) z wynikami zbiorczymi. */
    overview(user) {
      const visible = objects.list(user.role === ROLES.COORDINATOR ? { coordinatorId: user.id } : {});
      const visibleIds = new Set(visible.map((o) => o.id));
      const roots = visible.filter((o) => !o.parent_id || !visibleIds.has(o.parent_id));
      return roots.map((o) => {
        const r = svc.forObject(o.id);
        return { object: o, score: r.summary.score, approvedAudits: r.audits.length, pendingAudits: r.pendingAudits };
      });
    },
  };
  return svc;
}

module.exports = { createReportsService };
