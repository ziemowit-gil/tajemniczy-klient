-- Załączniki w ocenach kształcenia, historia zmian oraz kolejka powiadomień e-mail.

ALTER TABLE users ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1 CHECK (notify_email IN (0, 1));

CREATE TABLE office_attachments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  review_item_id INTEGER NOT NULL REFERENCES office_review_items(id) ON DELETE CASCADE,
  original_name  TEXT    NOT NULL,
  stored_name    TEXT    NOT NULL UNIQUE,
  mime           TEXT    NOT NULL,
  size           INTEGER NOT NULL,
  description    TEXT,
  uploaded_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_office_attachments_item ON office_attachments(review_item_id);

-- Dziennik zdarzeń audytów i ocen (kto, kiedy, co). Nazwa wykonawcy jest kopiowana, więc zostaje po usunięciu konta.
CREATE TABLE history_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT    NOT NULL CHECK (entity_type IN ('audit', 'review')),
  entity_id   INTEGER NOT NULL,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name  TEXT,
  action      TEXT    NOT NULL,
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_history_entity ON history_events(entity_type, entity_id, id);

-- Uzupełnienie historii dla danych sprzed migracji (na podstawie znaczników czasu).
INSERT INTO history_events (entity_type, entity_id, actor_id, actor_name, action, created_at)
  SELECT 'audit', a.id, a.assigned_by, (SELECT name FROM users u WHERE u.id = a.assigned_by), 'assigned', a.created_at FROM audits a;
INSERT INTO history_events (entity_type, entity_id, actor_id, actor_name, action, created_at)
  SELECT 'audit', a.id, a.auditor_id, (SELECT name FROM users u WHERE u.id = a.auditor_id), 'submitted', a.submitted_at FROM audits a WHERE a.submitted_at IS NOT NULL;
INSERT INTO history_events (entity_type, entity_id, actor_id, actor_name, action, note, created_at)
  SELECT 'audit', a.id, a.reviewer_id, (SELECT name FROM users u WHERE u.id = a.reviewer_id), 'approved', a.review_comment, a.approved_at FROM audits a WHERE a.approved_at IS NOT NULL;
INSERT INTO history_events (entity_type, entity_id, actor_id, actor_name, action, created_at)
  SELECT 'review', r.id, r.auditor_id, (SELECT name FROM users u WHERE u.id = r.auditor_id), 'created', r.created_at FROM office_reviews r;
INSERT INTO history_events (entity_type, entity_id, actor_id, actor_name, action, created_at)
  SELECT 'review', r.id, r.auditor_id, (SELECT name FROM users u WHERE u.id = r.auditor_id), 'submitted', r.submitted_at FROM office_reviews r WHERE r.submitted_at IS NOT NULL;
INSERT INTO history_events (entity_type, entity_id, actor_id, actor_name, action, note, created_at)
  SELECT 'review', r.id, r.reviewer_id, (SELECT name FROM users u WHERE u.id = r.reviewer_id), 'approved', r.review_comment, r.approved_at FROM office_reviews r WHERE r.approved_at IS NOT NULL;

-- Kolejka wiadomości e-mail (wyłącznie czysty tekst). dedupe_key zapobiega duplikatom przypomnień.
CREATE TABLE notifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_email        TEXT    NOT NULL,
  subject         TEXT    NOT NULL,
  body            TEXT    NOT NULL,
  event           TEXT    NOT NULL,
  dedupe_key      TEXT    UNIQUE,
  status          TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT    NOT NULL DEFAULT (datetime('now')),
  claimed_at      TEXT,
  last_error      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  sent_at         TEXT
);
CREATE INDEX idx_notifications_queue ON notifications(status, next_attempt_at);
