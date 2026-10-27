const { idParam } = require('../validation/schemas');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Odczytuje parametr ścieżki jako dodatni int albo rzuca 404. */
function paramId(req, name = 'id') {
  const parsed = idParam.safeParse(req.params[name]);
  if (!parsed.success) throw httpError(404, 'Nie znaleziono strony.');
  return parsed.data;
}

const FLASH_COOKIE = 'tk_flash';

/** Komunikaty „flash” w krótkotrwałym cookie (przeżywają jedno przekierowanie). */
function flashMiddleware(req, res, next) {
  let flash = null;
  try {
    if (req.cookies?.[FLASH_COOKIE]) flash = JSON.parse(req.cookies[FLASH_COOKIE]);
  } catch { flash = null; }
  if (flash) res.clearCookie(FLASH_COOKIE, { path: '/' });
  res.locals.flash = flash && typeof flash.message === 'string' ? flash : null;
  res.flash = (type, message) => res.cookie(FLASH_COOKIE, JSON.stringify({ type, message }), {
    httpOnly: true, sameSite: 'lax', maxAge: 60 * 1000, path: '/',
  });
  next();
}

/**
 * Pola formularza mają płaskie nazwy `answer_<id>` / `comment_<id>`. Zagnieżdżona notacja `answers[<id>]`
 * jest zawodna: parser qs zamienia małe, numeryczne indeksy w tablicę i kompaktuje luki.
 */
function collectAnswers(body) {
  const answers = {};
  for (const [name, value] of Object.entries(body || {})) {
    const m = /^(answer|comment)_(\d+)$/.exec(name);
    if (m && typeof value === 'string') (answers[m[2]] ??= {})[m[1]] = value;
  }
  return answers;
}

module.exports = { httpError, paramId, flashMiddleware, collectAnswers };
