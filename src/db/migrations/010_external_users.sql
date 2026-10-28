-- Użytkownicy zewnętrzni (spoza Panelu Współpracownika): logowanie e-mail + hasło + kod SMS.
ALTER TABLE users ADD COLUMN kind TEXT NOT NULL DEFAULT 'szo' CHECK (kind IN ('szo', 'external'));
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_set_at TEXT;
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
CREATE UNIQUE INDEX idx_users_external_email ON users (lower(email)) WHERE kind = 'external' AND email IS NOT NULL;

-- Jednorazowe linki do ustawienia hasła (w bazie tylko skrót SHA-256 tokenu).
CREATE TABLE auth_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT    NOT NULL CHECK (purpose IN ('set_password')),
  token_hash TEXT    NOT NULL UNIQUE,
  expires_at TEXT    NOT NULL,
  used_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id);

-- Wyzwania weryfikacji SMS po poprawnym haśle (w bazie tylko HMAC kodu, nigdy sam kod).
CREATE TABLE login_challenges (
  id           TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash    TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  sends        INTEGER NOT NULL DEFAULT 1,
  last_sent_at TEXT    NOT NULL DEFAULT (datetime('now')),
  used_at      TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_challenges_user ON login_challenges(user_id, created_at);
