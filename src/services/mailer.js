const nodemailer = require('nodemailer');

/**
 * Wysyłka e-mail. Wiadomości są WYŁĄCZNIE czystym tekstem (bez HTML).
 *  smtp – prawdziwa wysyłka przez nodemailer,
 *  log  – wypisanie wiadomości w konsoli (rozwój i testy ręczne),
 *  off  – brak wysyłki (powiadomienia nie są w ogóle kolejkowane).
 */
function createMailer(mail, { logger = console } = {}) {
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

  return {
    mode: mail.mode,
    async send({ to, subject, text }) {
      const message = { from: mail.from || 'Tajemniczy Klient <noreply@localhost>', to, subject: singleLine(subject), text, headers: { 'Auto-Submitted': 'auto-generated' } };
      if (mail.mode === 'smtp') {
        await getTransport().sendMail(message);
      } else if (mail.mode === 'log') {
        logger.log(`\n--- E-mail (tryb log) ---\nDo: ${to}\nTemat: ${message.subject}\n\n${text}\n--- koniec ---`);
      } else {
        throw new Error('Wysyłka e-mail jest wyłączona (MAIL_MODE=off).');
      }
    },
  };
}

/** Temat w jednej linii – zapobiega wstrzyknięciu nagłówków przez znaki nowej linii w danych. */
const singleLine = (s) => String(s).replace(/[\r\n]+/g, ' ').trim().slice(0, 180);

module.exports = { createMailer, singleLine };
