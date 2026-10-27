-- Rozbudowa scenariuszy: cel, persona, oczekiwany rezultat, czas, numerowane kroki i wersje.
-- Audyt/ocena zachowuje kopię scenariusza (z krokami i numerem wersji) z chwili przydziału.

ALTER TABLE scenarios ADD COLUMN goal TEXT;
ALTER TABLE scenarios ADD COLUMN persona TEXT CHECK (persona IN ('ruchowa', 'wzroku', 'sluchu', 'psychiczna', 'inna'));
ALTER TABLE scenarios ADD COLUMN expected_result TEXT;
ALTER TABLE scenarios ADD COLUMN estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes BETWEEN 1 AND 600);
ALTER TABLE scenarios ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE scenario_steps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  text        TEXT    NOT NULL
);
CREATE INDEX idx_scenario_steps_scenario ON scenario_steps(scenario_id, position);

-- Migawki scenariusza w tabelach przypisań (1:1 z przypisaniem).
ALTER TABLE audit_scenarios ADD COLUMN title TEXT;
ALTER TABLE audit_scenarios ADD COLUMN description TEXT;
ALTER TABLE audit_scenarios ADD COLUMN goal TEXT;
ALTER TABLE audit_scenarios ADD COLUMN persona TEXT;
ALTER TABLE audit_scenarios ADD COLUMN expected_result TEXT;
ALTER TABLE audit_scenarios ADD COLUMN estimated_minutes INTEGER;
ALTER TABLE audit_scenarios ADD COLUMN version INTEGER;

ALTER TABLE office_review_scenarios ADD COLUMN title TEXT;
ALTER TABLE office_review_scenarios ADD COLUMN description TEXT;
ALTER TABLE office_review_scenarios ADD COLUMN goal TEXT;
ALTER TABLE office_review_scenarios ADD COLUMN persona TEXT;
ALTER TABLE office_review_scenarios ADD COLUMN expected_result TEXT;
ALTER TABLE office_review_scenarios ADD COLUMN estimated_minutes INTEGER;
ALTER TABLE office_review_scenarios ADD COLUMN version INTEGER;

-- Dotychczasowe przypisania dostają migawkę z aktualnego scenariusza.
UPDATE audit_scenarios SET
  title = (SELECT title FROM scenarios s WHERE s.id = audit_scenarios.scenario_id),
  description = (SELECT description FROM scenarios s WHERE s.id = audit_scenarios.scenario_id),
  version = 1;
UPDATE office_review_scenarios SET
  title = (SELECT title FROM scenarios s WHERE s.id = office_review_scenarios.scenario_id),
  description = (SELECT description FROM scenarios s WHERE s.id = office_review_scenarios.scenario_id),
  version = 1;

CREATE TABLE audit_scenario_steps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id    INTEGER NOT NULL,
  scenario_id INTEGER NOT NULL,
  position    INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  done_at     TEXT,
  FOREIGN KEY (audit_id, scenario_id) REFERENCES audit_scenarios(audit_id, scenario_id) ON DELETE CASCADE
);
CREATE INDEX idx_audit_scenario_steps_audit ON audit_scenario_steps(audit_id);

CREATE TABLE office_review_scenario_steps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id   INTEGER NOT NULL,
  scenario_id INTEGER NOT NULL,
  position    INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  done_at     TEXT,
  FOREIGN KEY (review_id, scenario_id) REFERENCES office_review_scenarios(review_id, scenario_id) ON DELETE CASCADE
);
CREATE INDEX idx_office_review_scenario_steps_review ON office_review_scenario_steps(review_id);
