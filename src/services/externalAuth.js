/**
 * Użytkownicy zewnętrzni (spoza Panelu Współpracownika): konto zakłada administrator, osoba ustawia hasło z jednorazowego
 * linku z e-maila, a przy każdym logowaniu podaje hasło ORAZ kod SMS.
 *
 * Zabezpieczenia: hasła w scrypt; tokeny linków i kody SMS przechowywane wyłącznie jako skróty (SHA-256 / HMAC);
 * blokada konta po serii błędnych haseł; kod SMS ważny 5 minut, 5 prób, ograniczona liczba ponowień i wyzwań na godzinę;
 * jednakowa odpowiedź dla nieznanego adresu i błędnego hasła (bez ujawniania istnienia konta, z wyrównanym czasem).
 */
const crypto = require('node:crypto');
const { ROLES } = require('../domain/constants');
const { hashPassword, verifyPassword, validatePassword, DUMMY_HASH } = require('./passwords');
const { smsText, SmsError } = require('./smsSender');

const LIMITS = Object.freeze({
  tokenHours: 72, codeMinutes: 5, maxAttempts: 5, resendCooldownSeconds: 60, maxSends: 3,
  maxChallengesPerHour: 8, maxFailedLogins: 5, lockMinutes: 15,
  inviteDays: 7, inviteAttempts: 5,
});

class ExternalAuthError extends Error {
  constructor(message, code = 'invalid') { super(message); this.name = 'ExternalAuthError'; this.code = code; }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 9 cyfr → +48…, także zapisy z 0048/48 i separatorami; wynik w formacie E.164 albo null. */
function normalizePhone(input) {
  let s = String(input ?? '').replace(/[\s\-().]/g, '');
  if (/^00/.test(s)) s = `+${s.slice(2)}`;
  if (/^\d{9}$/.test(s)) s = `+48${s}`;
  else if (/^48\d{9}$/.test(s)) s = `+${s}`;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

const maskPhone = (phone) => `${phone.slice(0, 3)} ••• ••• ${phone.slice(-3)}`;
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

function createExternalAuth(db, { config, users, sms }) {
  const codeHash = (challengeId, code) => crypto.createHmac('sha256', config.sessionSecret).update(`${challengeId}:${code}`).digest('hex');
  const authRow = (id) => db.prepare('SELECT id, password_hash, failed_logins, locked_until, phone, active, kind, name, email FROM users WHERE id = ?').get(id);

  const svc = {
    LIMITS, normalizePhone, maskPhone,
    get enabled() { return sms.enabled; },

    /** Tworzy konto zewnętrzne (rola Audytor) i zwraca użytkownika oraz jednorazowy token ustawienia hasła. */
    createUser({ name, email, phone }) {
      const cleanName = String(name ?? '').trim();
      const cleanEmail = String(email ?? '').trim().toLowerCase();
      const cleanPhone = normalizePhone(phone);
      if (cleanName.length < 2 || cleanName.length > 100) throw new ExternalAuthError('Imię i nazwisko: 2–100 znaków.', 'validation');
      if (!EMAIL_RE.test(cleanEmail) || cleanEmail.length > 200) throw new ExternalAuthError('Podaj poprawny adres e-mail.', 'validation');
      if (!cleanPhone) throw new ExternalAuthError('Podaj poprawny numer telefonu komórkowego (np. 600 100 200 lub +48600100200).', 'validation');
      if (db.prepare('SELECT 1 FROM users WHERE lower(email) = ?').get(cleanEmail)) throw new ExternalAuthError('Konto z tym adresem e-mail już istnieje.', 'duplicate');

      const info = db.prepare(`INSERT INTO users (external_id, name, email, role, kind, phone) VALUES (?, ?, ?, ?, 'external', ?)`)
        .run(`ext:${crypto.randomUUID()}`, cleanName, cleanEmail, ROLES.AUDITOR, cleanPhone);
      db.prepare('INSERT INTO user_roles (user_id, role) VALUES (?, ?)').run(info.lastInsertRowid, ROLES.AUDITOR);
      const user = users.findById(info.lastInsertRowid);
      return { user, token: svc.issueSetPasswordToken(user.id) };
    },

    /**
     * Zaproszenie do rejestracji: administrator podaje adres e-mail (opcjonalnie imię i nazwisko), a aplikacja zwraca
     * jednorazowy 7-cyfrowy kod ważny 7 dni. Kod widać tylko raz, w bazie jest sam HMAC. Poprzednie niewykorzystane
     * zaproszenia dla tego adresu przestają działać.
     */
    createInvitation({ email, name, createdBy }) {
      const cleanEmail = String(email ?? '').trim().toLowerCase();
      if (!EMAIL_RE.test(cleanEmail) || cleanEmail.length > 200) throw new ExternalAuthError('Podaj poprawny adres e-mail.', 'validation');
      if (db.prepare('SELECT 1 FROM users WHERE lower(email) = ?').get(cleanEmail)) throw new ExternalAuthError('Konto z tym adresem e-mail już istnieje.', 'duplicate');
      const cleanName = String(name ?? '').trim().slice(0, 100) || null;
      db.prepare(`UPDATE registration_codes SET used_at = datetime('now') WHERE lower(email) = ? AND used_at IS NULL`).run(cleanEmail);
      const id = crypto.randomBytes(12).toString('base64url');
      const code = String(crypto.randomInt(0, 10000000)).padStart(7, '0');
      db.prepare(`INSERT INTO registration_codes (id, email, name, code_hash, expires_at, created_by) VALUES (?, ?, ?, ?, datetime('now', ?), ?)`)
        .run(id, cleanEmail, cleanName, codeHash(id, code), `+${LIMITS.inviteDays} days`, createdBy ?? null);
      return { id, code, email: cleanEmail, days: LIMITS.inviteDays };
    },

    listInvitations: () => db.prepare(`SELECT id, email, name, expires_at, attempts, created_at FROM registration_codes
      WHERE used_at IS NULL AND expires_at > datetime('now') ORDER BY created_at DESC`).all(),

    revokeInvitation: (id) => db.prepare(`UPDATE registration_codes SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`).run(id).changes === 1,

    /**
     * Samodzielna rejestracja z kodem. Jedna odpowiedź dla błędnego kodu, nieznanego adresu, wygasłego i zablokowanego
     * zaproszenia; 5 błędnych prób unieważnia zaproszenie. Po sukcesie konto ma hasło, rolę Audytora i numer telefonu,
     * a pierwsze logowanie potwierdza numer kodem SMS.
     */
    register({ code, email, name, phone, password, repeat }) {
      const generic = new ExternalAuthError('Nieprawidłowy kod lub adres e-mail, albo zaproszenie wygasło. Poproś administratora o nowy kod.', 'code');
      const cleanEmail = String(email ?? '').trim().toLowerCase();
      const inv = db.prepare(`SELECT * FROM registration_codes WHERE lower(email) = ? AND used_at IS NULL AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1`).get(cleanEmail);
      const given = String(code ?? '').replace(/\s/g, '');
      if (!inv || inv.attempts >= LIMITS.inviteAttempts) throw generic;
      db.prepare('UPDATE registration_codes SET attempts = attempts + 1 WHERE id = ?').run(inv.id);
      const ok = /^\d{7}$/.test(given) && crypto.timingSafeEqual(Buffer.from(codeHash(inv.id, given), 'hex'), Buffer.from(inv.code_hash, 'hex'));
      if (!ok) throw generic;

      const cleanName = String(name ?? '').trim() || inv.name || '';
      const cleanPhone = normalizePhone(phone);
      if (cleanName.length < 2 || cleanName.length > 100) throw new ExternalAuthError('Imię i nazwisko: 2–100 znaków.', 'validation');
      if (!cleanPhone) throw new ExternalAuthError('Podaj poprawny numer telefonu komórkowego (np. 600 100 200).', 'validation');
      if (password !== repeat) throw new ExternalAuthError('Hasła nie są takie same.', 'validation');
      const problem = validatePassword(password, { email: cleanEmail, name: cleanName });
      if (problem) throw new ExternalAuthError(problem, 'validation');
      if (db.prepare('SELECT 1 FROM users WHERE lower(email) = ?').get(cleanEmail)) throw generic;

      const info = db.prepare(`INSERT INTO users (external_id, name, email, role, kind, phone, password_hash, password_set_at) VALUES (?, ?, ?, ?, 'external', ?, ?, datetime('now'))`)
        .run(`ext:${crypto.randomUUID()}`, cleanName, cleanEmail, ROLES.AUDITOR, cleanPhone, hashPassword(password));
      db.prepare('INSERT INTO user_roles (user_id, role) VALUES (?, ?)').run(info.lastInsertRowid, ROLES.AUDITOR);
      db.prepare(`UPDATE registration_codes SET used_at = datetime('now') WHERE id = ?`).run(inv.id);
      return users.findById(info.lastInsertRowid);
    },

    setPhone(userId, phone) {
      const normalized = normalizePhone(phone);
      if (!normalized) throw new ExternalAuthError('Podaj poprawny numer telefonu komórkowego.', 'validation');
      db.prepare(`UPDATE users SET phone = ? WHERE id = ? AND kind = 'external'`).run(normalized, userId);
      return normalized;
    },

    /** Wystawia nowy jednorazowy token (poprzednie niewykorzystane tracą ważność). */
    issueSetPasswordToken(userId) {
      db.prepare(`UPDATE auth_tokens SET used_at = datetime('now') WHERE user_id = ? AND purpose = 'set_password' AND used_at IS NULL`).run(userId);
      const token = crypto.randomBytes(32).toString('base64url');
      db.prepare(`INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, 'set_password', ?, datetime('now', ?))`)
        .run(userId, sha256(token), `+${LIMITS.tokenHours} hours`);
      return token;
    },

    /** Użytkownik dla ważnego (nieużytego, niewygasłego) tokenu albo null. */
    userForToken(token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
      const row = db.prepare(`SELECT t.id, t.user_id FROM auth_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ? AND t.purpose = 'set_password' AND t.used_at IS NULL AND t.expires_at > datetime('now') AND u.active = 1 AND u.kind = 'external'`).get(sha256(token));
      return row ? { tokenId: row.id, user: users.findById(row.user_id) } : null;
    },

    /** Ustawia hasło z tokenu (jednorazowo). Zwraca użytkownika albo rzuca ExternalAuthError. */
    setPassword(token, password, repeat) {
      const found = svc.userForToken(token);
      if (!found) throw new ExternalAuthError('Link wygasł albo został już użyty. Poproś administratora o nowy.', 'token');
      if (password !== repeat) throw new ExternalAuthError('Hasła nie są takie same.', 'validation');
      const problem = validatePassword(password, { email: found.user.email, name: found.user.name });
      if (problem) throw new ExternalAuthError(problem, 'validation');
      db.prepare(`UPDATE users SET password_hash = ?, password_set_at = datetime('now'), failed_logins = 0, locked_until = NULL WHERE id = ?`).run(hashPassword(password), found.user.id);
      db.prepare(`UPDATE auth_tokens SET used_at = datetime('now') WHERE id = ?`).run(found.tokenId);
      return found.user;
    },

    /** Sprawdza e-mail i hasło. Zwraca użytkownika albo null (jedna odpowiedź dla każdej przyczyny odmowy). */
    authenticate(email, password) {
      const row = db.prepare(`SELECT id FROM users WHERE lower(email) = ? AND kind = 'external'`).get(String(email ?? '').trim().toLowerCase());
      const u = row ? authRow(row.id) : null;
      const locked = u?.locked_until && db.prepare(`SELECT ? > datetime('now') AS l`).get(u.locked_until).l === 1;
      const passwordOk = verifyPassword(String(password ?? ''), u?.password_hash || DUMMY_HASH);   // zawsze pełne obliczenie
      if (!u || !u.active || !u.password_hash || locked) return null;
      if (!passwordOk) {
        const failed = u.failed_logins + 1;
        if (failed >= LIMITS.maxFailedLogins) {
          db.prepare(`UPDATE users SET failed_logins = 0, locked_until = datetime('now', ?) WHERE id = ?`).run(`+${LIMITS.lockMinutes} minutes`, u.id);
        } else {
          db.prepare('UPDATE users SET failed_logins = ? WHERE id = ?').run(failed, u.id);
        }
        return null;
      }
      return users.findById(u.id);
    },

    /** Po poprawnym haśle: tworzy wyzwanie i wysyła kod SMS. Zwraca { id, maskedPhone }. */
    async startChallenge(user) {
      const phone = authRow(user.id).phone;
      if (!phone) throw new ExternalAuthError('Konto nie ma numeru telefonu. Skontaktuj się z administratorem.', 'no-phone');
      const recent = db.prepare(`SELECT COUNT(*) AS n FROM login_challenges WHERE user_id = ? AND created_at > datetime('now', '-1 hour')`).get(user.id).n;
      if (recent >= LIMITS.maxChallengesPerHour) throw new ExternalAuthError('Zbyt wiele prób logowania. Spróbuj ponownie później.', 'rate');
      const id = crypto.randomBytes(24).toString('base64url');
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      db.prepare(`INSERT INTO login_challenges (id, user_id, code_hash, expires_at) VALUES (?, ?, ?, datetime('now', ?))`)
        .run(id, user.id, codeHash(id, code), `+${LIMITS.codeMinutes} minutes`);
      try {
        await sms.send({ to: phone, text: smsText(code, LIMITS.codeMinutes) });
      } catch (err) {
        db.prepare('DELETE FROM login_challenges WHERE id = ?').run(id);
        if (err instanceof SmsError) throw new ExternalAuthError('Nie udało się wysłać kodu SMS. Spróbuj ponownie za chwilę.', 'sms');
        throw err;
      }
      return { id, maskedPhone: maskPhone(phone) };
    },

    /** Dane do ekranu weryfikacji (maska numeru) albo null, gdy wyzwanie wygasło lub zostało zużyte. */
    challengeInfo(id, userId) {
      const c = db.prepare(`SELECT c.*, c.expires_at > datetime('now') AS live FROM login_challenges c WHERE c.id = ? AND c.user_id = ?`).get(id, userId);
      if (!c || c.used_at || !c.live || c.attempts >= LIMITS.maxAttempts) return null;
      const phone = authRow(userId).phone;
      return { maskedPhone: phone ? maskPhone(phone) : '', attemptsLeft: LIMITS.maxAttempts - c.attempts, sends: c.sends };
    },

    /** Ponowne wysłanie kodu (z odstępem i limitem). Nowy kod unieważnia poprzedni. */
    async resend(id, userId) {
      const c = db.prepare(`SELECT *, last_sent_at > datetime('now', ?) AS cooling FROM login_challenges WHERE id = ? AND user_id = ?`).get(`-${LIMITS.resendCooldownSeconds} seconds`, id, userId);
      if (!c || c.used_at || c.attempts >= LIMITS.maxAttempts) throw new ExternalAuthError('Wyzwanie wygasło. Zaloguj się ponownie.', 'expired');
      if (c.sends >= LIMITS.maxSends) throw new ExternalAuthError('Wykorzystano limit ponowień kodu. Zaloguj się ponownie.', 'rate');
      if (c.cooling) throw new ExternalAuthError(`Kolejny kod możesz wysłać po ${LIMITS.resendCooldownSeconds} sekundach od poprzedniego.`, 'cooldown');
      const phone = authRow(userId).phone;
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      try {
        await sms.send({ to: phone, text: smsText(code, LIMITS.codeMinutes) });
      } catch (err) {
        if (err instanceof SmsError) throw new ExternalAuthError('Nie udało się wysłać kodu SMS. Spróbuj ponownie za chwilę.', 'sms');
        throw err;
      }
      db.prepare(`UPDATE login_challenges SET code_hash = ?, sends = sends + 1, last_sent_at = datetime('now'), expires_at = datetime('now', ?) WHERE id = ?`)
        .run(codeHash(id, code), `+${LIMITS.codeMinutes} minutes`, id);
    },

    /** Weryfikacja kodu. Zwraca użytkownika (wyzwanie zużyte) albo rzuca błąd; liczy próby. */
    verify(id, userId, code) {
      const c = db.prepare(`SELECT *, expires_at > datetime('now') AS live FROM login_challenges WHERE id = ? AND user_id = ?`).get(id, userId);
      if (!c || c.used_at || !c.live) throw new ExternalAuthError('Kod wygasł. Zaloguj się ponownie.', 'expired');
      if (c.attempts >= LIMITS.maxAttempts) throw new ExternalAuthError('Przekroczono liczbę prób. Zaloguj się ponownie.', 'attempts');
      db.prepare('UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?').run(id);
      const given = Buffer.from(codeHash(id, String(code ?? '').replace(/\s/g, '')), 'hex');
      const expected = Buffer.from(c.code_hash, 'hex');
      if (!/^\d{6}$/.test(String(code ?? '').replace(/\s/g, '')) || !crypto.timingSafeEqual(given, expected)) {
        const left = LIMITS.maxAttempts - (c.attempts + 1);
        throw new ExternalAuthError(left > 0 ? `Nieprawidłowy kod. Pozostało prób: ${left}.` : 'Przekroczono liczbę prób. Zaloguj się ponownie.', left > 0 ? 'wrong' : 'attempts');
      }
      db.prepare(`UPDATE login_challenges SET used_at = datetime('now') WHERE id = ?`).run(id);
      db.prepare(`UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?`).run(userId);
      const user = users.findById(userId);
      if (!user?.active) throw new ExternalAuthError('Konto jest wyłączone.', 'inactive');
      return user;
    },
  };
  return svc;
}

module.exports = { createExternalAuth, ExternalAuthError, normalizePhone, maskPhone, LIMITS };
