-- migrate: foreign_keys=off
-- Nowy początkowy status audytu „Wprowadzony do systemu” (przez koordynatora lub administratora, jeszcze bez
-- Tajemniczego Klienta). Audytor w audycie jest więc opcjonalny do chwili przydziału. SQLite nie zmienia ograniczeń
-- CHECK, więc tabelę przebudowujemy (procedura z dokumentacji SQLite; klucze obce wyłączone przez migrator).
CREATE TABLE audits_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id      INTEGER NOT NULL REFERENCES objects(id)   ON DELETE RESTRICT,
  auditor_id     INTEGER REFERENCES users(id)              ON DELETE RESTRICT,
  scenario_id    INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE RESTRICT,
  entered_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewer_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status         TEXT    NOT NULL DEFAULT 'entered'
                 CHECK (status IN ('entered', 'assigned', 'in_progress', 'submitted', 'approved')),
  due_date       TEXT,
  general_notes  TEXT,
  review_comment TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  assigned_at    TEXT,
  started_at     TEXT,
  submitted_at   TEXT,
  approved_at    TEXT
);

INSERT INTO audits_new (id, object_id, auditor_id, scenario_id, entered_by, assigned_by, reviewer_id, status, due_date,
                        general_notes, review_comment, created_at, assigned_at, started_at, submitted_at, approved_at)
  SELECT id, object_id, auditor_id, scenario_id, assigned_by, assigned_by, reviewer_id, status, due_date,
         general_notes, review_comment, created_at, created_at, started_at, submitted_at, approved_at
  FROM audits;

DROP TABLE audits;
ALTER TABLE audits_new RENAME TO audits;

CREATE INDEX idx_audits_object  ON audits(object_id);
CREATE INDEX idx_audits_auditor ON audits(auditor_id);
CREATE INDEX idx_audits_status  ON audits(status);
