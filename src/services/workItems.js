/**
 * Wspólna lista pracy: audyty obiektów i oceny „Dostępność kształcenia” w jednym zestawieniu
 * („Moje audyty” dla audytora, „Audyty” dla koordynatora i administratora oraz pulpit).
 */
const RANK = { submitted: 0, entered: 1, in_progress: 2, assigned: 3 };

function createWorkItems({ audits, office }) {
  const fromAudit = (a) => ({
    kind: 'audit', kindLabel: 'Audyt obiektu', id: a.id, href: `/audits/${a.id}`,
    title: a.object_name, detail: a.scenario_title || '', auditor_name: a.auditor_name || null,
    status: a.status, answered_count: a.answered_count, item_count: a.item_count, due_date: a.due_date || null,
  });
  const fromReview = (r) => ({
    kind: 'review', kindLabel: 'Dostępność kształcenia', id: r.id, href: `/office/${r.id}`,
    title: r.object_name, detail: [r.programme, r.scenario_title].filter(Boolean).join(', '), auditor_name: r.auditor_name || null,
    status: r.status, answered_count: r.answered_count, item_count: r.item_count, due_date: null,
  });

  return {
    list(user, { status } = {}) {
      const rows = [
        ...audits.list(user, { status }).map(fromAudit),
        ...office.list(user).filter((r) => !status || r.status === status).map(fromReview),
      ];
      return rows.sort((a, b) => (RANK[a.status] ?? 4) - (RANK[b.status] ?? 4)
        || (a.due_date === null) - (b.due_date === null) || String(a.due_date).localeCompare(String(b.due_date)) || b.id - a.id);
    },
  };
}

module.exports = { createWorkItems };
