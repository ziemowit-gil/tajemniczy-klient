-- Wspólny słownik scenariuszy dla audytów obiektów i dla modułu „Dostępność kształcenia”.
-- Do audytu (oraz oceny kształcenia) można przypisać wiele scenariuszy.

ALTER TABLE scenarios ADD COLUMN usage TEXT NOT NULL DEFAULT 'audit'
  CHECK (usage IN ('audit', 'education', 'both'));

CREATE TABLE audit_scenarios (
  audit_id    INTEGER NOT NULL REFERENCES audits(id)    ON DELETE CASCADE,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE RESTRICT,
  PRIMARY KEY (audit_id, scenario_id)
);
CREATE INDEX idx_audit_scenarios_scenario ON audit_scenarios(scenario_id);

-- audits.scenario_id zostaje jako scenariusz główny (pierwszy wybrany); komplet w audit_scenarios.
INSERT INTO audit_scenarios (audit_id, scenario_id) SELECT id, scenario_id FROM audits;

CREATE TABLE office_review_scenarios (
  review_id   INTEGER NOT NULL REFERENCES office_reviews(id) ON DELETE CASCADE,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id)      ON DELETE RESTRICT,
  PRIMARY KEY (review_id, scenario_id)
);
CREATE INDEX idx_office_review_scenarios_scenario ON office_review_scenarios(scenario_id);
