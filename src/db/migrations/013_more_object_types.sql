-- migrate: foreign_keys=off
-- Więcej rodzajów obiektów do audytów: sklepy, restauracje, urzędy i inne miejsca (oprócz uczelni, wydziałów, kampusów i budynków).
-- SQLite nie zmienia ograniczeń CHECK, więc tabelę przebudowujemy (klucze obce wyłączone przez migrator).
CREATE TABLE objects_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id      INTEGER REFERENCES objects(id) ON DELETE RESTRICT,
  name           TEXT    NOT NULL,
  type           TEXT    NOT NULL CHECK (type IN ('uczelnia', 'wydzial', 'kampus', 'budynek', 'sklep', 'restauracja', 'hotel', 'urzad', 'biblioteka', 'kultura', 'zdrowie', 'transport', 'inne')),
  address        TEXT,
  coordinator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at    TEXT
);
INSERT INTO objects_new (id, parent_id, name, type, address, coordinator_id, notes, created_at, updated_at, archived_at)
  SELECT id, parent_id, name, type, address, coordinator_id, notes, created_at, updated_at, archived_at FROM objects;
DROP TABLE objects;
ALTER TABLE objects_new RENAME TO objects;
CREATE INDEX idx_objects_parent ON objects(parent_id);
CREATE INDEX idx_objects_coordinator ON objects(coordinator_id);
