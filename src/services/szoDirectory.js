/**
 * Katalog użytkowników SZO: lista kont z uprawnieniem „Tajemniczy Klient” do importu osób w panelu Użytkownicy.
 * Korzysta z endpointu SZO api/v1/audytor_users.php (tylko odczyt, scope audytor:users, klucz API w SZO_API_KEY).
 * Zwraca minimum danych: id, imię i nazwisko, e-mail. Identyfikator `szo:<id>` jest taki sam jak przy logowaniu,
 * więc zaimportowana osoba po pierwszym logowaniu trafia na to samo konto.
 */
class DirectoryError extends Error {
  constructor(message, { status = 502 } = {}) {
    super(message);
    this.name = 'DirectoryError';
    this.status = status;
  }
}

function createSzoDirectory(config, { fetchImpl = globalThis.fetch, getApiKey = () => config.szo.apiKey } = {}) {
  const cfg = config.szo;
  const base = (cfg.baseUrl || '').replace(/\/$/, '');
  const url = `${base}/api/v1/audytor_users.php`;

  return {
    /** Import jest dostępny w trybie szo, gdy znamy adres SZO i klucz API (z panelu lub z .env). */
    get enabled() { return cfg.mode === 'szo' && Boolean(getApiKey()) && Boolean(cfg.baseUrl); },

    /** @returns {Promise<Array<{id:number,name:string,email:string}>>} */
    async listUsers() {
      if (!this.enabled) throw new DirectoryError('Import z SZO nie jest skonfigurowany (brak klucza API: Administracja → Integracja z SZO).', { status: 400 });
      let res;
      try {
        res = await fetchImpl(url, { headers: { Authorization: `Bearer ${getApiKey()}`, Accept: 'application/json' }, signal: AbortSignal.timeout(cfg.timeoutMs) });
      } catch {
        throw new DirectoryError('SZO jest niedostępne. Spróbuj ponownie za chwilę.', { status: 503 });
      }
      if (res.status === 401 || res.status === 403) throw new DirectoryError('SZO odrzuciło klucz API (sprawdź klucz w Administracja → Integracja z SZO i jego uprawnienie audytor:users).', { status: 502 });
      if (res.status === 404) throw new DirectoryError('SZO nie ma jeszcze endpointu importu (api/v1/audytor_users.php).', { status: 502 });
      if (!res.ok) throw new DirectoryError('SZO zwróciło błąd przy pobieraniu listy użytkowników.');

      let body;
      try { body = await res.json(); } catch { throw new DirectoryError('Niepoprawna odpowiedź SZO.'); }
      if (!body || body.ok !== true || !Array.isArray(body.users)) throw new DirectoryError('Niepoprawna odpowiedź SZO.');

      const seen = new Set();
      const users = [];
      for (const u of body.users) {
        const id = Number(u?.id);
        const email = String(u?.email || '').trim().toLowerCase();
        if (!Number.isInteger(id) || id <= 0 || seen.has(id) || !email) continue;
        seen.add(id);
        users.push({ id, name: String(u.name || email).trim().slice(0, 200), email: email.slice(0, 200) });
      }
      return users;
    },

    /**
     * Sprawdza zapisany klucz bez skutków ubocznych: import (GET listy użytkowników) i wysyłkę poczty (POST z pustą
     * treścią — SZO sprawdza uprawnienie przed walidacją, więc 422 oznacza „uprawniony”, a 401/403 „brak uprawnienia”).
     * Zwraca { users: {ok, message}, mail: {ok, message} }.
     */
    async check() {
      const key = getApiKey();
      if (!cfg.baseUrl) return { users: { ok: false, message: 'Brak SZO_BASE_URL w konfiguracji.' }, mail: { ok: false, message: 'Brak SZO_BASE_URL w konfiguracji.' } };
      if (!key) return { users: { ok: false, message: 'Brak klucza API.' }, mail: { ok: false, message: 'Brak klucza API.' } };

      const result = {};
      try {
        const users = await (async () => {
          const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(cfg.timeoutMs) });
          return { status: res.status, body: await res.json().catch(() => null) };
        })();
        if (users.status === 200 && users.body?.ok === true) result.users = { ok: true, message: `działa (kont z uprawnieniem do aplikacji: ${users.body.users?.length ?? 0})` };
        else if (users.status === 401 || users.status === 403) result.users = { ok: false, message: 'SZO odrzuciło klucz lub klucz nie ma uprawnienia „lista użytkowników” (audytor:users).' };
        else if (users.status === 404) result.users = { ok: false, message: 'SZO nie ma jeszcze endpointu importu (wdróż SZO).' };
        else result.users = { ok: false, message: `SZO zwróciło błąd (${users.status}).` };
      } catch {
        result.users = { ok: false, message: 'SZO jest niedostępne.' };
      }
      try {
        const res = await fetchImpl(`${base}/api/v1/audytor_mail.php`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ recipients: [], subject: '', message: '' }),
          signal: AbortSignal.timeout(cfg.timeoutMs),
        });
        if (res.status === 422 || res.status === 400) result.mail = { ok: true, message: 'działa (klucz ma uprawnienie wysyłki).' };
        else if (res.status === 401 || res.status === 403) result.mail = { ok: false, message: 'SZO odrzuciło klucz lub klucz nie ma uprawnienia „wysyłka powiadomień” (audytor:mail).' };
        else if (res.status === 404) result.mail = { ok: false, message: 'SZO nie ma jeszcze endpointu wysyłki (wdróż SZO).' };
        else result.mail = { ok: false, message: `SZO zwróciło błąd (${res.status}).` };
      } catch {
        result.mail = { ok: false, message: 'SZO jest niedostępne.' };
      }
      return result;
    },
  };
}

module.exports = { createSzoDirectory, DirectoryError };
