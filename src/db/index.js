const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function openDatabase(databasePath) {
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (databasePath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    // Migracja przebudowująca tabelę (SQLite nie zmienia ograniczeń CHECK) oznacza się linią `-- migrate: foreign_keys=off`.
    // Klucze obce muszą być wyłączone POZA transakcją (inaczej DROP TABLE skasowałby powiązane wiersze kaskadą);
    // spójność jest sprawdzana jeszcze przed zatwierdzeniem, więc błąd wycofuje całą migrację.
    const rebuilds = /^--\s*migrate:\s*foreign_keys=off/m.test(sql);
    if (rebuilds) db.exec('PRAGMA foreign_keys = OFF');
    try {
      // BEGIN IMMEDIATE blokuje zapis dla innych procesów; po zdobyciu blokady sprawdzamy ponownie, czy migracji
      // nie wykonał w międzyczasie równoległy proces (Passenger może uruchomić kilka procesów naraz).
      transaction(db, () => {
        if (db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(file)) return;
        db.exec(sql);
        if (rebuilds) {
          const broken = db.prepare('PRAGMA foreign_key_check').all();
          if (broken.length) throw new Error(`Migracja ${file} naruszyła klucze obce (${broken.length}); wycofano.`);
        }
        db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
      }, { immediate: true });
    } finally {
      if (rebuilds) db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

/** Wykonuje fn w transakcji; przy wyjątku wycofuje zmiany. */
function transaction(db, fn, { immediate = false } = {}) {
  db.exec(immediate ? 'BEGIN IMMEDIATE' : 'BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDatabase, migrate, transaction };
