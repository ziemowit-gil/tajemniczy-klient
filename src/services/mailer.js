const nodemailer = require('nodemailer');

/**
 * Wysyłka e-mail. Wiadomości są WYŁĄCZNIE czystym tekstem (bez HTML).
 *  szo  – przez SZO i Microsoft Graph (api/v1/audytor_mail.php, klucz SZO_API_KEY z uprawnieniem audytor:mail),
 *  smtp – bezpośrednio przez SMTP (nodemailer),
 *  log  – wypisanie wiadomości w konsoli (rozwój i testy ręczne),
 *  off  – brak wysyłki (powiadomienia nie są w ogóle kolejkowane).
 *
 * Błędy mają flagę `permanent`: true, gdy ponawianie nie ma sensu (odrzucenie żądania, adres spoza uprawnionych),
 * a false przy awarii przejściowej (sieć, limit, błąd serwera) — wtedy kolejka próbuje ponownie.
 */
class MailError extends Error {
  constructor(message, { permanent = false } = {}) {
    super(message);
    this.name = 'MailError';
    this.permanent = permanent;
  }
}

function createMailer(mail, { logger = console, szo = {}, fetchImpl = globalThis.fetch } = {}) {
  let transport;
  const getTransport = () => {
    transport ??= nodemailer.createTransport({
      host: mail.smtp.host,
      port: mail.smtp.port,
      secure: mail.smtp.secure,
      auth: mail.smtp.user ? { user: mail.smtp.user, pass: mail.smtp.pass } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
    return transport;
  };

  async function sendViaSzo({ to, subject, text }) {
    const url = `${(szo.baseUrl || '').replace(/\/$/, '')}/api/v1/audytor_mail.php`;
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${szo.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ recipients: [{ email: to }], subject: singleLine(subject), message: text }),
        signal: AbortSignal.timeout(szo.timeoutMs || 10000),
      });
    } catch {
      throw new MailError('SZO jest niedostępne.');
    }
    let json = null;
    try { json = await res.json(); } catch { /* brak JSON */ }
    const detail = json?.error || json?.message || '';

    if (res.status === 401 || res.status === 403) throw new MailError(`SZO odrzuciło klucz API (uprawnienie audytor:mail). ${detail}`.trim(), { permanent: false });
    if (res.status === 404) throw new MailError('SZO nie ma jeszcze endpointu wysyłki (api/v1/audytor_mail.php).');
    if (res.status === 429) throw new MailError(`Limit wysyłek SZO. ${detail}`.trim());
    if (res.status >= 400 && res.status < 500) throw new MailError(`SZO odrzuciło wiadomość: ${detail || res.status}`, { permanent: true });
    if (!res.ok) throw new MailError(`Błąd SZO (${res.status}).`);
    if (!json || json.ok !== true) throw new MailError('Niepoprawna odpowiedź SZO.');
    if (!(json.queued > 0)) {
      const reason = json.skipped?.[0]?.reason || 'adres pominięty';
      throw new MailError(`SZO pominęło adresata: ${reason}.`, { permanent: true });
    }
  }

  return {
    mode: mail.mode,
    async send({ to, subject, text }) {
      if (mail.mode === 'szo') return sendViaSzo({ to, subject, text });
      const message = { from: mail.from || 'Tajemniczy Klient <noreply@localhost>', to, subject: singleLine(subject), text, headers: { 'Auto-Submitted': 'auto-generated' } };
      if (mail.mode === 'smtp') {
        await getTransport().sendMail(message);
      } else if (mail.mode === 'log') {
        logger.log(`\n--- E-mail (tryb log) ---\nDo: ${to}\nTemat: ${message.subject}\n\n${text}\n--- koniec ---`);
      } else {
        throw new Error('Wysyłka e-mail jest wyłączona (MAIL_MODE=off).');
      }
      return undefined;
    },
  };
}

/** Temat w jednej linii – zapobiega wstrzyknięciu nagłówków przez znaki nowej linii w danych. */
const singleLine = (s) => String(s).replace(/[\r\n]+/g, ' ').trim().slice(0, 180);

module.exports = { createMailer, singleLine, MailError };
