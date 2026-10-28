-- Oświadczenia składane elektronicznie przy logowaniu (poufność danych). Przechowujemy dokładny tekst i jego skrót,
-- żeby po zmianie treści można było wymagać ponownego złożenia oświadczenia i udowodnić, co dokładnie zostało złożone.
CREATE TABLE declarations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  text_hash   TEXT    NOT NULL,
  text        TEXT    NOT NULL,
  user_name   TEXT    NOT NULL,
  user_email  TEXT,
  accepted_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, text_hash)
);
CREATE INDEX idx_declarations_user ON declarations(user_id);
