-- Rejestracja kont zewnętrznych 7-cyfrowym kodem wygenerowanym przez administratora (w bazie tylko HMAC kodu).
CREATE TABLE registration_codes (
  id         TEXT    PRIMARY KEY,
  email      TEXT    NOT NULL,
  name       TEXT,
  code_hash  TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  used_at    TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_registration_codes_email ON registration_codes(lower(email), created_at);
