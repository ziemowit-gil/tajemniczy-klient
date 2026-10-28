const crypto = require('node:crypto');

/** Hasła: scrypt z losową solą (format `scrypt$N$r$p$sól$skrót`), porównanie w stałym czasie. */
const N = 16384; const R = 8; const P = 1; const KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

/** Sprawdza hasło względem zapisanego skrótu; zawsze wykonuje pełne obliczenie (także dla nieznanego konta: DUMMY). */
function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Skrót „atrapy” do wyrównania czasu odpowiedzi, gdy konto nie istnieje (nie ujawniamy istnienia adresu). */
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

const COMMON = new Set(['password1234', 'password12345', 'qwertyuiop12', '123456789012', 'haslo1234567', 'zaq12wsxcde3', 'admin1234567', '111111111111', 'abcdefghijkl']);

/** Zasady: 12–200 znaków, nie same powtórzenia, nie popularne, bez adresu e-mail i imienia/nazwiska w treści. */
function validatePassword(password, { email = '', name = '' } = {}) {
  const pw = String(password ?? '');
  if (pw.length < 12) return 'Hasło musi mieć co najmniej 12 znaków.';
  if (pw.length > 200) return 'Hasło może mieć najwyżej 200 znaków.';
  if (/^(.)\1+$/.test(pw)) return 'Hasło nie może składać się z jednego powtarzanego znaku.';
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return 'To hasło jest zbyt popularne. Wybierz inne.';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) return 'Hasło nie może zawierać Twojego adresu e-mail.';
  for (const part of String(name).toLowerCase().split(/\s+/)) {
    if (part.length >= 4 && lower.includes(part)) return 'Hasło nie może zawierać Twojego imienia ani nazwiska.';
  }
  if (!/[\p{L}]/u.test(pw) || !/[\p{N}\p{P}\p{S}\s]/u.test(pw)) return 'Hasło powinno zawierać litery oraz cyfry, znaki specjalne lub spacje (np. fraza z kilku słów).';
  return null;
}

module.exports = { hashPassword, verifyPassword, validatePassword, DUMMY_HASH };
