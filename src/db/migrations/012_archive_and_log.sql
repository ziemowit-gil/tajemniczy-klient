-- Archiwizacja (ukrycie z list roboczych bez utraty danych) oraz dziennik operacji administracyjnych.
ALTER TABLE audits         ADD COLUMN archived_at TEXT;
ALTER TABLE office_reviews ADD COLUMN archived_at TEXT;
ALTER TABLE objects        ADD COLUMN archived_at TEXT;
ALTER TABLE scenarios      ADD COLUMN archived_at TEXT;

CREATE TABLE operation_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name  TEXT,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER,
  entity_name TEXT,
  action      TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_operation_log_created ON operation_log(created_at);
