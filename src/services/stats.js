/**
 * Statystyki porównawcze: ranking obiektów najwyższego poziomu (np. uczelni) i trendy kwartalne.
 * Wyniki audytów obiektów i modułu „Dostępność kształcenia” są pokazywane obok siebie, ale nigdy nie są mieszane.
 * Uwzględniane są wyłącznie zatwierdzone audyty i oceny, w zakresie widocznym dla użytkownika.
 */
const { scoreItems } = require('../domain/scoring');
const { STATUS } = require('../domain/workflow');

const round1 = (n) => Math.round(n * 10) / 10;

/** '2026-10-27 12:00:00' → '2026-Q4' (według czasu UTC zapisanego w bazie). */
const quarterOf = (dateTime) => {
  const [year, month] = String(dateTime).split(/[-\s]/);
  return `${year}-Q${Math.ceil(Number(month) / 3)}`;
};

function createStatsService(db, { objects, reports, office, audits }) {
  const rootsFor = (user) => reports.overview(user).map((r) => r.object);

  const pctOrNull = (items) => scoreItems(items);

  const svc = {
    /** Ranking z miejscami „ex aequo” (1, 2, 2, 4); obiekty bez wyniku na końcu. */
    ranking(user) {
      const education = new Map(office.report(user).universities.map((u) => [u.objectId, u]));
      const rows = reports.overview(user).map(({ object, score, approvedAudits }) => ({
        objectId: object.id,
        name: object.name,
        type: object.type,
        audits: { count: approvedAudits, total: score.total.percent, ozn: score.areas.OZN.percent, edu: score.areas.KSZTALCENIE.percent },
        education: { count: education.get(object.id)?.count ?? 0, percent: education.get(object.id)?.score.percent ?? null },
      }));
      rows.sort((a, b) => (b.audits.total ?? -1) - (a.audits.total ?? -1) || a.name.localeCompare(b.name, 'pl'));
      rows.forEach((row, i) => {
        if (row.audits.total === null) { row.rank = null; return; }
        const prev = rows[i - 1];
        row.rank = prev && prev.audits.total === row.audits.total ? prev.rank : i + 1;
      });
      return rows;
    },

    /** Trend kwartalny dla każdego obiektu najwyższego poziomu: wynik w okresie i zmiana względem poprzedniego okresu. */
    trend(user) {
      return rootsFor(user).map((root) => {
        const ids = objects.descendantIds(root.id);
        const marks = ids.map(() => '?').join(',');
        const auditRows = db.prepare(`SELECT id, approved_at FROM audits WHERE status = ? AND approved_at IS NOT NULL AND object_id IN (${marks}) ORDER BY approved_at`)
          .all(STATUS.APPROVED, ...ids);
        const reviewRows = db.prepare(`SELECT id, approved_at FROM office_reviews WHERE status = ? AND approved_at IS NOT NULL AND object_id = ? ORDER BY approved_at`)
          .all(STATUS.APPROVED, root.id);

        const byPeriod = new Map();
        const slot = (period) => {
          if (!byPeriod.has(period)) byPeriod.set(period, { period, auditItems: [], audits: 0, reviewItems: [], reviews: 0 });
          return byPeriod.get(period);
        };
        for (const a of auditRows) { const s = slot(quarterOf(a.approved_at)); s.audits += 1; s.auditItems.push(...audits.scoringItems(a.id)); }
        for (const r of reviewRows) { const s = slot(quarterOf(r.approved_at)); s.reviews += 1; s.reviewItems.push(...office.scoringItems(r.id)); }

        let previous = null;
        const periods = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period)).map((s) => {
          const a = s.audits ? pctOrNull(s.auditItems) : null;
          const e = s.reviews ? pctOrNull(s.reviewItems.map((i) => ({ ...i, area: 'OZN' }))) : null;
          const row = {
            period: s.period,
            audits: { count: s.audits, total: a?.total.percent ?? null, ozn: a?.areas.OZN.percent ?? null, edu: a?.areas.KSZTALCENIE.percent ?? null },
            education: { count: s.reviews, percent: e?.total.percent ?? null },
            change: { audits: null, education: null },
          };
          if (previous) {
            if (row.audits.total !== null && previous.audits.total !== null) row.change.audits = round1(row.audits.total - previous.audits.total);
            if (row.education.percent !== null && previous.education.percent !== null) row.change.education = round1(row.education.percent - previous.education.percent);
          }
          // zmiana liczona względem ostatniego okresu, w którym wynik istniał
          previous = {
            audits: { total: row.audits.total ?? previous?.audits.total ?? null },
            education: { percent: row.education.percent ?? previous?.education.percent ?? null },
          };
          return row;
        });
        return { objectId: root.id, name: root.name, periods };
      });
    },
  };
  return svc;
}

module.exports = { createStatsService, quarterOf };
