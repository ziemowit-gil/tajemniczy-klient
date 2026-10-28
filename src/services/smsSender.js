/**
 * Wysyłka SMS (kody logowania użytkowników zewnętrznych).
 *  szo – przez SZO (api/v1/audytor_sms.php, uprawnienie audytor:sms): bramka SMS i dostawcy są po stronie SZO,
 *  log – wypisanie w konsoli (tylko rozwój; zabronione w produkcji),
 *  off – brak wysyłki (logowanie użytkowników zewnętrznych jest wtedy wyłączone).
 * SZO przyjmuje wyłącznie sztywny szablon wiadomości z kodem, więc klucz API nie służy do wysyłania dowolnych SMS-ów.
 */
class SmsError extends Error {
  constructor(message) { super(message); this.name = 'SmsError'; }
}

/** Jedyny dozwolony szablon (ASCII, żeby uniknąć problemów z kodowaniem u operatorów). */
const smsText = (code, minutes) => `Tajemniczy Klient: kod logowania ${code}. Wazny ${minutes} min. Nie podawaj go nikomu.`;

function createSmsSender(config, { fetchImpl = globalThis.fetch, getApiKey = () => config.szo.apiKey, logger = console } = {}) {
  const mode = config.sms.mode;
  const base = (config.szo.baseUrl || '').replace(/\/$/, '');

  return {
    mode,
    get enabled() { return mode === 'log' || (mode === 'szo' && Boolean(base) && Boolean(getApiKey())); },

    async send({ to, text }) {
      if (mode === 'log') { logger.log(`\n--- SMS (tryb log) ---\nDo: ${to}\n${text}\n--- koniec ---`); return; }
      if (mode !== 'szo') throw new SmsError('Wysyłka SMS jest wyłączona.');
      if (!getApiKey()) throw new SmsError('Brak klucza API SZO (Administracja → Integracja z SZO).');
      let res;
      try {
        res = await fetchImpl(`${base}/api/v1/audytor_sms.php`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ phone: to, message: text }),
          signal: AbortSignal.timeout(config.szo.timeoutMs),
        });
      } catch {
        throw new SmsError('SZO jest niedostępne.');
      }
      let json = null;
      try { json = await res.json(); } catch { /* brak JSON */ }
      if (res.status === 401 || res.status === 403) throw new SmsError('SZO odrzuciło klucz API (uprawnienie audytor:sms).');
      if (res.status === 404) throw new SmsError('SZO nie ma jeszcze endpointu SMS.');
      if (res.status === 429) throw new SmsError('Limit wysyłek SMS w SZO.');
      if (!res.ok || json?.ok !== true) throw new SmsError(`SZO nie wysłało SMS (${json?.error || res.status}).`);
    },
  };
}

module.exports = { createSmsSender, SmsError, smsText };
