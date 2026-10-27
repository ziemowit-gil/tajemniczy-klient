-- Moduł „Dostępność kształcenia”: audytor jako kandydat na kierunek ocenia biuro ds. osób z niepełnosprawnościami.
-- Niezależny od audytów obiektów: własny katalog pytań, własne oceny i własny raport.

CREATE TABLE office_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  category    TEXT    NOT NULL,
  text        TEXT    NOT NULL,
  hint        TEXT,
  weight      INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 5),
  answer_type TEXT    NOT NULL CHECK (answer_type IN ('scale', 'ternary')),
  position    INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE office_reviews (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id      INTEGER NOT NULL REFERENCES objects(id) ON DELETE RESTRICT,   -- uczelnia
  auditor_id     INTEGER NOT NULL REFERENCES users(id)   ON DELETE RESTRICT,
  reviewer_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  programme      TEXT    NOT NULL,                                              -- kierunek
  study_level    TEXT    NOT NULL CHECK (study_level IN ('I', 'II', 'jednolite', 'podyplomowe')),
  study_mode     TEXT    NOT NULL CHECK (study_mode IN ('stacjonarne', 'niestacjonarne')),
  disability     TEXT    NOT NULL CHECK (disability IN ('ruchowa', 'wzroku', 'sluchu', 'psychiczna', 'inna')),
  contact_notes  TEXT,                                                          -- jak i z kim się kontaktowano
  general_notes  TEXT,
  review_comment TEXT,
  status         TEXT    NOT NULL DEFAULT 'in_progress'
                 CHECK (status IN ('in_progress', 'submitted', 'approved')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at   TEXT,
  approved_at    TEXT
);
CREATE INDEX idx_office_reviews_object ON office_reviews(object_id);
CREATE INDEX idx_office_reviews_auditor ON office_reviews(auditor_id);

-- Migawka pytań z chwili rozpoczęcia oceny (jak audit_items).
CREATE TABLE office_review_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id   INTEGER NOT NULL REFERENCES office_reviews(id) ON DELETE CASCADE,
  question_id INTEGER REFERENCES office_questions(id) ON DELETE SET NULL,
  code        TEXT    NOT NULL,
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
CREATE INDEX idx_office_items_review ON office_review_items(review_id);
