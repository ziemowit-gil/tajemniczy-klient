CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id   TEXT    NOT NULL UNIQUE,            -- identyfikator użytkownika w SZO
  name          TEXT    NOT NULL,
  email         TEXT,
  role          TEXT    NOT NULL CHECK (role IN ('administrator', 'auditor', 'coordinator')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE objects (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id      INTEGER REFERENCES objects(id) ON DELETE RESTRICT,
  name           TEXT    NOT NULL,
  type           TEXT    NOT NULL CHECK (type IN ('uczelnia', 'wydzial', 'kampus', 'budynek')),
  address        TEXT,
  coordinator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_objects_parent ON objects(parent_id);
CREATE INDEX idx_objects_coordinator ON objects(coordinator_id);

CREATE TABLE criteria (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  area        TEXT    NOT NULL CHECK (area IN ('OZN', 'KSZTALCENIE')),
  category    TEXT    NOT NULL,
  text        TEXT    NOT NULL,
  hint        TEXT,
  weight      INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 5),
  answer_type TEXT    NOT NULL CHECK (answer_type IN ('scale', 'ternary')),
  position    INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE scenarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT,
  areas       TEXT NOT NULL CHECK (areas IN ('OZN', 'KSZTALCENIE', 'BOTH')),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE audits (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id      INTEGER NOT NULL REFERENCES objects(id)   ON DELETE RESTRICT,
  auditor_id     INTEGER NOT NULL REFERENCES users(id)     ON DELETE RESTRICT,
  scenario_id    INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE RESTRICT,
  assigned_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewer_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status         TEXT    NOT NULL DEFAULT 'assigned'
                 CHECK (status IN ('assigned', 'in_progress', 'submitted', 'approved')),
  due_date       TEXT,
  general_notes  TEXT,
  review_comment TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  started_at     TEXT,
  submitted_at   TEXT,
  approved_at    TEXT
);
CREATE INDEX idx_audits_object ON audits(object_id);
CREATE INDEX idx_audits_auditor ON audits(auditor_id);
CREATE INDEX idx_audits_status ON audits(status);

-- Migawka kryteriów w chwili przydzielenia audytu: późniejsza edycja kryteriów
-- nie zmienia wyników już prowadzonych i zatwierdzonych audytów.
CREATE TABLE audit_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id    INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  criterion_id INTEGER REFERENCES criteria(id) ON DELETE SET NULL,
  code        TEXT    NOT NULL,
  area        TEXT    NOT NULL CHECK (area IN ('OZN', 'KSZTALCENIE')),
  category    TEXT    NOT NULL,
  text        TEXT    NOT NULL,
  hint        TEXT,
  weight      INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 5),
  answer_type TEXT    NOT NULL CHECK (answer_type IN ('scale', 'ternary')),
  position    INTEGER NOT NULL DEFAULT 0,
  answer      TEXT,
  comment     TEXT,
  answered_at TEXT
);
CREATE INDEX idx_audit_items_audit ON audit_items(audit_id);

CREATE TABLE attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_item_id INTEGER NOT NULL REFERENCES audit_items(id) ON DELETE CASCADE,
  original_name TEXT    NOT NULL,
  stored_name   TEXT    NOT NULL UNIQUE,
  mime          TEXT    NOT NULL,
  size          INTEGER NOT NULL,
  description   TEXT,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attachments_item ON attachments(audit_item_id);
