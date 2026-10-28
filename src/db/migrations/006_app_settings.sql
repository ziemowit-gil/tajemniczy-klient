-- Ustawienia aplikacji zmieniane w panelu administratora. Wartości tajne (np. klucz API SZO) są przechowywane
-- wyłącznie zaszyfrowane (AES-256-GCM); jawny tekst nigdy nie trafia do bazy ani do dziennika.
CREATE TABLE app_settings (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
