/**
 * Ustawienia aplikacji edytowane w panelu (obecnie: klucz API SZO).
 *
 * Wartości tajne są szyfrowane AES-256-GCM kluczem pochodnym od SESSION_SECRET (HKDF-SHA256); nazwa ustawienia jest
 * danymi uwierzytelnianymi (AAD), więc zaszyfrowanej wartości nie da się podstawić pod inną nazwę. Jawny klucz nie jest
 * nigdzie zapisywany ani zwracany do widoków — panel pokazuje tylko ostatnie znaki. Zmiana SESSION_SECRET unieważnia
 * zapisane wartości (wymagane ponowne wklejenie), co jest zachowaniem zamierzonym.
 */
const crypto = require('node:crypto');

const SZO_API_KEY = 'szo_api_key';
const SECRET_NAMES = new Set([SZO_API_KEY]);
const PREFIX = 'v1';

function createSettingsService(db, config) {
  const key = Buffer.from(crypto.hkdfSync('sha256', config.sessionSecret, 'tajemniczy-klient', 'app-settings-v1', 32));

  const encrypt = (name, plain) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(name));
    const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return [PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
  };

  /** Zwraca tekst jawny albo null, gdy wartość jest uszkodzona lub zaszyfrowana innym sekretem. */
  const decrypt = (name, blob) => {
    try {
      const [version, iv, tag, data] = String(blob).split(':');
      if (version !== PREFIX) return null;
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAAD(Buffer.from(name));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  };

  const row = (name) => db.prepare(`SELECT s.value, s.updated_at, u.name AS updated_by_name FROM app_settings s
    LEFT JOIN users u ON u.id = s.updated_by WHERE s.name = ?`).get(name);

  const svc = {
    SZO_API_KEY,

    setSecret(name, plain, userId) {
      if (!SECRET_NAMES.has(name)) throw new Error(`Nieznane ustawienie tajne: ${name}`);
      db.prepare(`INSERT INTO app_settings (name, value, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?)
        ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
        .run(name, encrypt(name, plain), userId ?? null);
    },

    clear: (name) => db.prepare('DELETE FROM app_settings WHERE name = ?').run(name).changes > 0,

    /** Wartość zapisana w bazie: tekst jawny, null (brak) albo undefined (jest, ale nie da się odczytać). */
    getSecret(name) {
      const r = row(name);
      if (!r) return null;
      const plain = decrypt(name, r.value);
      return plain === null ? undefined : plain;
    },

    /** Klucz API SZO używany przez aplikację: zapisany w panelu ma pierwszeństwo przed plikiem .env. */
    szoApiKey() {
      const stored = svc.getSecret(SZO_API_KEY);
      return typeof stored === 'string' && stored ? stored : (config.szo.apiKey || null);
    },

    /** Informacje do wyświetlenia — bez wartości klucza (tylko ostatnie znaki). */
    szoApiKeyInfo() {
      const r = row(SZO_API_KEY);
      const stored = r ? decrypt(SZO_API_KEY, r.value) : null;
      const tail = (k) => (k && k.length >= 8 ? k.slice(-4) : null);
      if (r && stored) return { source: 'panel', tail: tail(stored), updatedAt: r.updated_at, updatedBy: r.updated_by_name, unreadable: false, envFallback: Boolean(config.szo.apiKey) };
      const unreadable = Boolean(r && !stored);
      if (config.szo.apiKey) return { source: 'env', tail: tail(config.szo.apiKey), updatedAt: null, updatedBy: null, unreadable, envFallback: true };
      return { source: null, tail: null, updatedAt: null, updatedBy: null, unreadable, envFallback: false };
    },
  };
  return svc;
}

module.exports = { createSettingsService, SZO_API_KEY };
