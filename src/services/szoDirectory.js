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

function createSzoDirectory(config, { fetchImpl = globalThis.fetch } = {}) {
  const cfg = config.szo;
  const enabled = cfg.mode === 'szo' && Boolean(cfg.apiKey) && Boolean(cfg.baseUrl);
  const url = `${(cfg.baseUrl || '').replace(/\/$/, '')}/api/v1/audytor_users.php`;

  return {
    enabled,

    /** @returns {Promise<Array<{id:number,name:string,email:string}>>} */
    async listUsers() {
      if (!enabled) throw new DirectoryError('Import z SZO nie jest skonfigurowany (brak SZO_API_KEY).', { status: 400 });
      let res;
      try {
        res = await fetchImpl(url, { headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' }, signal: AbortSignal.timeout(cfg.timeoutMs) });
      } catch {
        throw new DirectoryError('SZO jest niedostępne. Spróbuj ponownie za chwilę.', { status: 503 });
      }
      if (res.status === 401 || res.status === 403) throw new DirectoryError('SZO odrzuciło klucz API (sprawdź SZO_API_KEY i jego uprawnienie audytor:users).', { status: 502 });
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
  };
}

module.exports = { createSzoDirectory, DirectoryError };
