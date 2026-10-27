/**
 * Powiadomienia e-mail (czysty tekst) z kolejką w bazie.
 *
 * Zdarzenia trafiają do tabeli `notifications`, a wysyłka odbywa się osobno (`processOutbox`): zaraz po zdarzeniu
 * (jeśli MAIL_AUTOFLUSH) oraz z crona (`npm run notify`), który też ponawia nieudane próby i wysyła przypomnienia o terminach.
 * Dzięki temu awaria SMTP nie blokuje pracy w aplikacji, a wiadomości nie giną, gdy aplikacja jest akurat uśpiona.
 */
const { ROLES } = require('../domain/constants');
const { singleLine } = require('./mailer');

const MAX_ATTEMPTS = 5;
const STALE_CLAIM_MINUTES = 10;
const SUBJECT_PREFIX = '[Tajemniczy Klient] ';

const warsawDate = (now) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(now); // RRRR-MM-DD
const daysBetween = (fromIso, toIso) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);

function createNotifier(db, { config, mailer, users, objects }) {
  const mailCfg = config.mail;
  const enabled = mailCfg.mode !== 'off';
  const base = (config.appUrl || '').replace(/\/$/, '');
  const link = (p) => `${base}${p}`;

  const insert = db.prepare(`INSERT OR IGNORE INTO notifications (user_id, to_email, subject, body, event, dedupe_key)
    VALUES (?, ?, ?, ?, ?, ?)`);

  /** Wiadomość z własnym, kompletnym tekstem (bez imiennego powitania i stopki) i dokładnie wskazanym tematem. */
  function enqueueRaw(user, event, subject, body, dedupeKey = null) {
    if (!enabled || !user || !user.active || !user.email || !user.notify_email) return false;
    return insert.run(user.id, user.email, singleLine(subject), body, event, dedupeKey).changes > 0;
  }

  const footer = `\n--\nWiadomość wysłana automatycznie przez aplikację Tajemniczy Klient.\nPowiadomienia możesz wyłączyć w ustawieniach konta: ${link('/account')}\n`;

  /** Dodaje wiadomość do kolejki, jeśli odbiorca ma e-mail, jest aktywny i nie wyłączył powiadomień. */
  function enqueue(user, event, subject, lines, dedupeKey = null) {
    if (!enabled || !user || !user.active || !user.email || !user.notify_email) return false;
    const body = `Dzień dobry ${user.name},\n\n${lines.join('\n')}\n${footer}`;
    const info = insert.run(user.id, user.email, singleLine(`${SUBJECT_PREFIX}${subject}`), body, event, dedupeKey);
    return info.changes > 0;
  }

  /** Koordynatorzy obiektu (także przez obiekty nadrzędne); gdy brak, administratorzy. */
  function reviewers(objectId) {
    const ids = objects.coordinatorIds(objectId);
    const coordinators = ids.map((id) => users.findById(id)).filter(Boolean);
    return coordinators.length ? coordinators : users.listByRole(ROLES.ADMIN);
  }

  const flushSoon = () => {
    if (enabled && mailCfg.autoFlush) setImmediate(() => svc.processOutbox().catch((err) => console.error('Wysyłka powiadomień:', err.message)));
  };
  const queueAll = (recipients, event, subject, lines) => {
    let any = false;
    for (const r of recipients) any = enqueue(r, event, subject, lines) || any;
    if (any) flushSoon();
  };

  const svc = {
    enabled,

    /**
     * Informacja o przydzieleniu roli Audytora dostępności / Tajemniczego klienta. Wysyłana po nadaniu roli
     * (import z SZO, zmiana roli w panelu, pierwsze logowanie przez SZO). Klucz dedupe: jedna wiadomość na osobę dziennie.
     */
    roleAssignedAuditor(user, now = new Date()) {
      const panel = base || 'https://audytor.feer.org.pl';
      const body = [
        'Dzień dobry,',
        '',
        'Informujemy, że w systemie została Ci przydzielona rola Audytora dostępności / Tajemniczego klienta.',
        '',
        'Dostęp do panelu audytora uzyskasz po zalogowaniu na stronie:',
        panel,
        '',
        'Zaloguj się przyciskiem „Zaloguj przez SZO”, kontem Microsoft 365, którego używasz w SZO.',
        '',
        'Przyznana rola uprawnia do realizowania przydzielonych audytów dostępności, wprowadzania formularzy z obserwacji (metodą tajemniczego klienta) oraz weryfikacji wymogów i standardów dostępności w wyznaczonym zakresie.',
        '',
        'W razie pytań lub problemów z logowaniem prosimy o kontakt z zespołem technicznym.',
        '',
        'Z poważaniem,',
        '',
        'Fundacja Edukacji Empatii Rozwoju „FEER”',
        '',
      ].join('\n');
      const queued = enqueueRaw(user, 'role_assigned_auditor', 'Przydzielenie roli: Audytor dostępności (Tajemniczy klient)', body, `role_auditor:${user?.id}:${warsawDate(now)}`);
      if (queued) flushSoon();
      return queued;
    },

    /* ----- zdarzenia audytów obiektów ----- */
    auditAssigned(audit) {
      queueAll([users.findById(audit.auditor_id)], 'audit_assigned', `Przydzielono Ci audyt: ${audit.object_name}`, [
        `Administrator przydzielił Ci audyt obiektu „${audit.object_name}”.`,
        `Scenariusze: ${audit.scenario_title}.`,
        audit.due_date ? `Termin wykonania: ${audit.due_date}.` : 'Termin wykonania nie został ustalony.',
        '', `Otwórz audyt: ${link(`/audits/${audit.id}`)}`,
      ]);
    },
    auditSubmitted(audit) {
      queueAll(reviewers(audit.object_id), 'audit_submitted', `Audyt czeka na weryfikację: ${audit.object_name}`, [
        `Audytor ${audit.auditor_name} złożył audyt obiektu „${audit.object_name}”. Czeka na Twoją weryfikację.`,
        '', `Otwórz audyt: ${link(`/audits/${audit.id}`)}`,
      ]);
    },
    auditApproved(audit, comment) {
      queueAll([users.findById(audit.auditor_id)], 'audit_approved', `Audyt zatwierdzony: ${audit.object_name}`, [
        `Twój audyt obiektu „${audit.object_name}” został zatwierdzony.`,
        ...(comment ? ['', `Komentarz koordynatora: ${comment}`] : []),
        '', `Otwórz audyt: ${link(`/audits/${audit.id}`)}`,
      ]);
    },
    auditReturned(audit, comment) {
      queueAll([users.findById(audit.auditor_id)], 'audit_returned', `Audyt zwrócony do poprawy: ${audit.object_name}`, [
        `Twój audyt obiektu „${audit.object_name}” został zwrócony do poprawy.`,
        '', `Uzasadnienie: ${comment}`,
        '', `Popraw audyt i złóż go ponownie: ${link(`/audits/${audit.id}`)}`,
      ]);
    },

    /* ----- zdarzenia ocen „Dostępność kształcenia” ----- */
    reviewAssigned(review) {
      queueAll([users.findById(review.auditor_id)], 'review_assigned', `Przydzielono Ci ocenę: ${review.object_name}, ${review.programme}`, [
        `Administrator przydzielił Ci ocenę dostępności kształcenia: ${review.object_name}, kierunek „${review.programme}”.`,
        review.scenario_title ? `Scenariusze: ${review.scenario_title}.` : 'Scenariusze nie zostały jeszcze nadane.',
        '', `Otwórz ocenę: ${link(`/office/${review.id}`)}`,
      ]);
    },
    reviewScenariosChanged(review) {
      queueAll([users.findById(review.auditor_id)], 'review_scenarios', `Zmieniono scenariusze oceny: ${review.object_name}, ${review.programme}`, [
        `Administrator zmienił scenariusze Twojej oceny: ${review.object_name}, kierunek „${review.programme}”.`,
        review.scenario_title ? `Aktualne scenariusze: ${review.scenario_title}.` : 'Ocena nie ma teraz żadnych scenariuszy.',
        '', `Otwórz ocenę: ${link(`/office/${review.id}`)}`,
      ]);
    },
    reviewSubmitted(review) {
      queueAll(reviewers(review.object_id), 'review_submitted', `Ocena czeka na weryfikację: ${review.object_name}, ${review.programme}`, [
        `Audytor ${review.auditor_name} złożył ocenę dostępności kształcenia: ${review.object_name}, kierunek „${review.programme}”.`,
        '', `Otwórz ocenę: ${link(`/office/${review.id}`)}`,
      ]);
    },
    reviewApproved(review, comment) {
      queueAll([users.findById(review.auditor_id)], 'review_approved', `Ocena zatwierdzona: ${review.object_name}, ${review.programme}`, [
        `Twoja ocena dostępności kształcenia (${review.object_name}, kierunek „${review.programme}”) została zatwierdzona.`,
        ...(comment ? ['', `Komentarz koordynatora: ${comment}`] : []),
        '', `Otwórz ocenę: ${link(`/office/${review.id}`)}`,
      ]);
    },
    reviewReturned(review, comment) {
      queueAll([users.findById(review.auditor_id)], 'review_returned', `Ocena zwrócona do poprawy: ${review.object_name}, ${review.programme}`, [
        `Twoja ocena dostępności kształcenia (${review.object_name}, kierunek „${review.programme}”) została zwrócona do poprawy.`,
        '', `Uzasadnienie: ${comment}`,
        '', `Popraw ocenę i złóż ją ponownie: ${link(`/office/${review.id}`)}`,
      ]);
    },

    /**
     * Przypomnienia o terminach audytów (każde wysyłane tylko raz dzięki kluczowi dedupe):
     * na `reminderDays` dni przed terminem, w dniu terminu i po jego przekroczeniu.
     */
    sendDueReminders(now = new Date()) {
      if (!enabled) return 0;
      const today = warsawDate(now);
      const rows = db.prepare(`SELECT a.id, a.auditor_id, a.due_date, o.name AS object_name FROM audits a JOIN objects o ON o.id = a.object_id
        WHERE a.status IN ('assigned', 'in_progress') AND a.due_date IS NOT NULL`).all();
      let queued = 0;
      for (const a of rows) {
        const left = daysBetween(today, a.due_date);
        let kind; let subject; let line;
        if (left < 0) { kind = 'overdue'; subject = `Audyt po terminie: ${a.object_name}`; line = `Termin wykonania audytu obiektu „${a.object_name}” minął (${a.due_date}).`; }
        else if (left === 0) { kind = 'due-today'; subject = `Dziś mija termin audytu: ${a.object_name}`; line = `Dziś mija termin wykonania audytu obiektu „${a.object_name}”.`; }
        else if (left <= mailCfg.reminderDays) { kind = 'due-soon'; subject = `Zbliża się termin audytu: ${a.object_name}`; line = `Za ${left} ${left === 1 ? 'dzień' : 'dni'} (${a.due_date}) mija termin wykonania audytu obiektu „${a.object_name}”.`; }
        else continue;
        const ok = enqueue(users.findById(a.auditor_id), `audit_${kind.replace('-', '_')}`, subject, [line, '', `Otwórz audyt: ${link(`/audits/${a.id}`)}`], `${kind}:audit:${a.id}:${a.due_date}`);
        if (ok) queued += 1;
      }
      return queued;
    },

    /**
     * Wysyła oczekujące wiadomości. Wiersz jest najpierw „zajmowany” (status sending), więc równoległe procesy
     * (aplikacja i cron) nie wyślą jednej wiadomości dwa razy. Błędy są ponawiane z rosnącym opóźnieniem.
     */
    async processOutbox({ limit = 50 } = {}) {
      if (!enabled) return { sent: 0, failed: 0, retried: 0 };
      db.prepare(`UPDATE notifications SET status = 'pending' WHERE status = 'sending' AND claimed_at < datetime('now', ?)`)
        .run(`-${STALE_CLAIM_MINUTES} minutes`);
      const due = db.prepare(`SELECT id FROM notifications WHERE status = 'pending' AND next_attempt_at <= datetime('now') ORDER BY id LIMIT ?`).all(limit);
      const stats = { sent: 0, failed: 0, retried: 0 };

      for (const { id } of due) {
        const claim = db.prepare(`UPDATE notifications SET status = 'sending', attempts = attempts + 1, claimed_at = datetime('now')
          WHERE id = ? AND status = 'pending'`).run(id);
        if (claim.changes !== 1) continue; // zajęte przez inny proces
        const n = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
        try {
          await mailer.send({ to: n.to_email, subject: n.subject, text: n.body });
          db.prepare(`UPDATE notifications SET status = 'sent', sent_at = datetime('now'), last_error = NULL WHERE id = ?`).run(id);
          stats.sent += 1;
        } catch (err) {
          const message = String(err.message || err).slice(0, 500);
          if (err.permanent || n.attempts >= MAX_ATTEMPTS) {
            db.prepare(`UPDATE notifications SET status = 'failed', last_error = ? WHERE id = ?`).run(message, id);
            stats.failed += 1;
          } else {
            db.prepare(`UPDATE notifications SET status = 'pending', last_error = ?, next_attempt_at = datetime('now', ?) WHERE id = ?`)
              .run(message, `+${n.attempts * n.attempts * 5} minutes`, id);
            stats.retried += 1;
          }
        }
      }
      return stats;
    },

    /** Pełny cykl dla crona: przypomnienia + wysyłka. */
    async runCycle(now = new Date()) {
      const reminders = svc.sendDueReminders(now);
      const delivery = await svc.processOutbox();
      return { reminders, ...delivery };
    },

    stats: () => Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM notifications GROUP BY status').all().map((r) => [r.status, r.n])),
  };
  return svc;
}

module.exports = { createNotifier, MAX_ATTEMPTS };
