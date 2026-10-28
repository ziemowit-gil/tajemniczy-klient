const { DECLARATION_TEXT, DECLARATION_HASH } = require('../domain/declaration');

/** Oświadczenia składane przez użytkowników. Status jest zapamiętany w bazie: złożone raz nie jest wymagane ponownie. */
function createDeclarationsService(db) {
  const find = db.prepare('SELECT accepted_at FROM declarations WHERE user_id = ? AND text_hash = ?');
  return {
    hash: DECLARATION_HASH,

    /** Czy użytkownik złożył oświadczenie w aktualnej wersji treści. */
    isAccepted: (userId) => find.get(userId, DECLARATION_HASH) !== undefined,

    /** Data złożenia aktualnej wersji albo null. */
    acceptedAt: (userId) => find.get(userId, DECLARATION_HASH)?.accepted_at ?? null,

    /** Zapisuje oświadczenie (z kopią treści, imieniem i e-mailem z chwili złożenia); powtórne złożenie nic nie zmienia. */
    accept(user) {
      db.prepare(`INSERT OR IGNORE INTO declarations (user_id, text_hash, text, user_name, user_email) VALUES (?, ?, ?, ?, ?)`)
        .run(user.id, DECLARATION_HASH, DECLARATION_TEXT, user.name, user.email ?? null);
    },

    /** Mapa id użytkownika → data złożenia aktualnej wersji (do panelu administratora). */
    acceptedMap: () => new Map(db.prepare('SELECT user_id, accepted_at FROM declarations WHERE text_hash = ?').all(DECLARATION_HASH).map((r) => [r.user_id, r.accepted_at])),
  };
}

module.exports = { createDeclarationsService };
