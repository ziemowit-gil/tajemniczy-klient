/**
 * Migawki scenariuszy przypisanych do audytu albo oceny „Dostępność kształcenia”.
 * W chwili przypisania zapisujemy kopię treści, kroków i numeru wersji, więc późniejsza edycja scenariusza
 * w słowniku nie zmienia prowadzonych i zatwierdzonych audytów. Kroki mają stan wykonania (odhaczenie).
 */
const KINDS = {
  audit: { link: 'audit_scenarios', steps: 'audit_scenario_steps', owner: 'audit_id' },
  review: { link: 'office_review_scenarios', steps: 'office_review_scenario_steps', owner: 'review_id' },
};

function createScenarioSnapshots(db) {
  const kind = (k) => {
    const cfg = KINDS[k];
    if (!cfg) throw new Error(`Nieznany rodzaj migawki: ${k}`);
    return cfg;
  };

  const svc = {
    /** Dopisuje migawki wskazanych scenariuszy (id) do właściciela; istniejące przypisania zostają nietknięte. */
    add(k, ownerId, scenarioIds) {
      const { link, steps, owner } = kind(k);
      const exists = db.prepare(`SELECT 1 FROM ${link} WHERE ${owner} = ? AND scenario_id = ?`);
      const insertLink = db.prepare(`INSERT INTO ${link}
        (${owner}, scenario_id, title, description, goal, persona, expected_result, estimated_minutes, version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertStep = db.prepare(`INSERT INTO ${steps} (${owner}, scenario_id, position, text) VALUES (?, ?, ?, ?)`);
      const sourceSteps = db.prepare('SELECT position, text FROM scenario_steps WHERE scenario_id = ? ORDER BY position, id');
      for (const id of scenarioIds) {
        if (exists.get(ownerId, id)) continue;
        const s = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id);
        insertLink.run(ownerId, id, s.title, s.description, s.goal, s.persona, s.expected_result, s.estimated_minutes, s.version);
        for (const st of sourceSteps.all(id)) insertStep.run(ownerId, id, st.position, st.text);
      }
    },

    /** Ustawia komplet scenariuszy: usuwa odznaczone, dodaje nowe, zachowuje migawki i odhaczenia pozostałych. */
    replace(k, ownerId, scenarioIds) {
      const { link, owner } = kind(k);
      const keep = new Set(scenarioIds);
      for (const row of db.prepare(`SELECT scenario_id FROM ${link} WHERE ${owner} = ?`).all(ownerId)) {
        if (!keep.has(row.scenario_id)) db.prepare(`DELETE FROM ${link} WHERE ${owner} = ? AND scenario_id = ?`).run(ownerId, row.scenario_id);
      }
      svc.add(k, ownerId, scenarioIds);
    },

    /** Migawki z krokami; `currentVersion` pozwala pokazać, że scenariusz w słowniku jest już nowszy. */
    list(k, ownerId) {
      const { link, steps, owner } = kind(k);
      const rows = db.prepare(`SELECT l.scenario_id AS id, l.title, l.description, l.goal, l.persona, l.expected_result,
          l.estimated_minutes, l.version, s.version AS current_version
        FROM ${link} l LEFT JOIN scenarios s ON s.id = l.scenario_id
        WHERE l.${owner} = ? ORDER BY l.title COLLATE NOCASE`).all(ownerId);
      const stepRows = db.prepare(`SELECT id, scenario_id, position, text, done, done_at FROM ${steps}
        WHERE ${owner} = ? ORDER BY scenario_id, position, id`).all(ownerId);
      return rows.map((r) => {
        const own = stepRows.filter((st) => st.scenario_id === r.id);
        return {
          ...r,
          outdated: r.current_version !== null && r.current_version > r.version,
          steps: own,
          stepsDone: own.filter((st) => st.done).length,
        };
      });
    },

    /** Zapisuje stan odhaczenia kroków: kroki z `doneIds` jako wykonane, pozostałe jako niewykonane. */
    setDone(k, ownerId, doneIds) {
      const { steps, owner } = kind(k);
      const done = new Set(doneIds.map(Number));
      const rows = db.prepare(`SELECT id, done FROM ${steps} WHERE ${owner} = ?`).all(ownerId);
      const update = db.prepare(`UPDATE ${steps} SET done = ?, done_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END WHERE id = ?`);
      for (const r of rows) {
        const want = done.has(r.id) ? 1 : 0;
        if (want !== r.done) update.run(want, want, r.id);
      }
    },
  };
  return svc;
}

module.exports = { createScenarioSnapshots };
