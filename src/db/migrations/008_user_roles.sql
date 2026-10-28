-- Wiele ról na użytkownika: Audytor / Tajemniczy Klient jest rolą obowiązkową dla każdego, a Koordynator i Administrator
-- są rolami dodatkowymi, między którymi użytkownik przełącza się w trakcie pracy. Kolumna users.role oznacza teraz
-- ostatnio używaną (domyślnie wybieraną po zalogowaniu) rolę i zawsze jest jedną z ról z tabeli user_roles.
CREATE TABLE user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT    NOT NULL CHECK (role IN ('administrator', 'auditor', 'coordinator')),
  PRIMARY KEY (user_id, role)
);
INSERT INTO user_roles (user_id, role) SELECT id, 'auditor' FROM users;
INSERT OR IGNORE INTO user_roles (user_id, role) SELECT id, role FROM users WHERE role <> 'auditor';
