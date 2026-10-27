/**
 * Moduł „Biuro ds. OZN”: audytor w roli kandydata na dany kierunek ocenia biuro ds. osób z niepełnosprawnościami.
 * Wyniki są liczone tym samym silnikiem co audyty, ale raportowane osobno.
 */
const { transaction } = require('../db');
const { ROLES } = require('../domain/constants');
const { STATUS, canTransition, isEditable } = require('../domain/workflow');
const {
  scoreItems, findGaps, isValidAnswer, validateForSubmit,
} = require('../domain/scoring');
const { DomainError, resolveAnswer } = require('./audits');

/** Wiersz → element punktacji (wszystko trafia do jednego obszaru, liczy się wynik łączny). */
const toScoringItem = (row) => ({
  id: row.id, area: 'OZN', category: row.category, code: row.code, text: row.text, hint: row.hint,
  weight: row.weight, answerType: row.answer_type, answer: row.answer, comment: row.comment,
});

const fmt = (p) => (p === null ? 'brak danych' : `${String(p).replace('.', ',')}%`);

function createOfficeReviewsService(db, { objects }) {
  const select = `
    SELECT r.*, o.name AS object_name, au.name AS auditor_name, rv.name AS reviewer_name,
      (SELECT COUNT(*) FROM office_review_items i WHERE i.review_id = r.id) AS item_count,
      (SELECT COUNT(*) FROM office_review_items i WHERE i.review_id = r.id AND i.answer IS NOT NULL) AS answered_count
    FROM office_reviews r
    JOIN objects o ON o.id = r.object_id
    JOIN users au ON au.id = r.auditor_id
    LEFT JOIN users rv ON rv.id = r.reviewer_id`;

  const questions = {
    list: ({ onlyActive = false } = {}) => db.prepare(`SELECT * FROM office_questions ${onlyActive ? 'WHERE active = 1' : ''} ORDER BY position, id`).all(),
    get: (id) => db.prepare('SELECT * FROM office_questions WHERE id = ?').get(id),
    codeTaken: (code, exceptId = 0) => db.prepare('SELECT 1 FROM office_questions WHERE code = ? AND id <> ?').get(code, exceptId) !== undefined,
    create(d) {
      const info = db.prepare(`INSERT INTO office_questions (code, category, text, hint, weight, answer_type, position, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(d.code, d.category, d.text, d.hint, d.weight, d.answerType, d.position, d.active ? 1 : 0);
      return questions.get(info.lastInsertRowid);
    },
    update(id, d) {
      db.prepare(`UPDATE office_questions SET code = ?, category = ?, text = ?, hint = ?, weight = ?, answer_type = ?,
        position = ?, active = ? WHERE id = ?`).run(d.code, d.category, d.text, d.hint, d.weight, d.answerType, d.position, d.active ? 1 : 0, id);
      return questions.get(id);
    },
    remove: (id) => db.prepare('DELETE FROM office_questions WHERE id = ?').run(id),
  };

  /** Identyfikatory uczelni dostępnych dla użytkownika. */
  const scopeIds = (user) => (user.role === ROLES.COORDINATOR ? objects.list({ coordinatorId: user.id }).map((o) => o.id) : null);

  const svc = {
    questions,
    get: (id) => db.prepare(`${select} WHERE r.id = ?`).get(id),
    items: (reviewId) => db.prepare('SELECT * FROM office_review_items WHERE review_id = ? ORDER BY position, id').all(reviewId),
    scoringItems: (reviewId) => svc.items(reviewId).map(toScoringItem),

    canView(user, review) {
      if (!user || !review) return false;
      if (user.role === ROLES.ADMIN) return true;
      if (user.role === ROLES.AUDITOR) return review.auditor_id === user.id;
      return user.role === ROLES.COORDINATOR && objects.isCoordinatedBy(review.object_id, user.id);
    },
    canEdit: (user, review) => user?.role === ROLES.AUDITOR && review.auditor_id === user.id && isEditable(review.status),

    list(user) {
      const where = [];
      const params = [];
      if (user.role === ROLES.AUDITOR) { where.push('r.auditor_id = ?'); params.push(user.id); }
      const scope = scopeIds(user);
      if (scope) {
        if (!scope.length) return [];
        where.push(`r.object_id IN (${scope.map(() => '?').join(',')})`);
        params.push(...scope);
      }
      return db.prepare(`${select} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY CASE r.status WHEN 'submitted' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, r.id DESC`).all(...params);
    },

    /** Rozpoczyna ocenę: tworzy migawkę aktywnych pytań. */
    create(d, auditorId) {
      const object = objects.get(d.objectId);
      if (!object || object.type !== 'uczelnia') throw new DomainError('Wybierz uczelnię z listy obiektów.');
      const active = questions.list({ onlyActive: true });
      if (!active.length) throw new DomainError('Brak aktywnych pytań w ankiecie biura ds. OZN.');
      return transaction(db, () => {
        const info = db.prepare(`INSERT INTO office_reviews (object_id, auditor_id, programme, study_level, study_mode, disability)
          VALUES (?, ?, ?, ?, ?, ?)`).run(d.objectId, auditorId, d.programme, d.studyLevel, d.studyMode, d.disability);
        const insert = db.prepare(`INSERT INTO office_review_items (review_id, question_id, code, category, text, hint, weight, answer_type, position)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const q of active) insert.run(info.lastInsertRowid, q.id, q.code, q.category, q.text, q.hint, q.weight, q.answer_type, q.position);
        return svc.get(info.lastInsertRowid);
      });
    },

    save(review, { answers, contactNotes, generalNotes }) {
      if (!isEditable(review.status)) throw new DomainError('Ocena została złożona i nie można jej edytować.', 409);
      const items = new Map(svc.items(review.id).map((i) => [String(i.id), i]));
      const errors = {};
      for (const [id, entry] of Object.entries(answers)) {
        const item = items.get(id);
        if (!item) throw new DomainError('Odpowiedź dotyczy pytania spoza tej oceny.', 400);
        const answer = resolveAnswer(entry, item);
        if (answer !== null && !isValidAnswer(item.answer_type, answer)) errors[id] = 'Niedozwolona wartość odpowiedzi.';
      }
      if (Object.keys(errors).length) throw new DomainError('Formularz zawiera niepoprawne odpowiedzi.', 422, errors);

      transaction(db, () => {
        const update = db.prepare(`UPDATE office_review_items SET answer = ?, comment = ?,
          answered_at = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END WHERE id = ? AND review_id = ?`);
        for (const [id, entry] of Object.entries(answers)) {
          const answer = resolveAnswer(entry, items.get(id));
          update.run(answer, entry.comment ? entry.comment : null, answer, Number(id), review.id);
        }
        db.prepare('UPDATE office_reviews SET contact_notes = ?, general_notes = ? WHERE id = ?').run(contactNotes, generalNotes, review.id);
      });
      return svc.get(review.id);
    },

    submit(review, user) {
      if (!canTransition(review.status, STATUS.SUBMITTED, user.role) || review.auditor_id !== user.id) {
        throw new DomainError('Tej oceny nie można teraz złożyć.', 409);
      }
      const problems = validateForSubmit(svc.scoringItems(review.id));
      if (problems.length) throw new DomainError('Ocena nie jest kompletna.', 422, problems);
      db.prepare(`UPDATE office_reviews SET status = ?, submitted_at = datetime('now'), review_comment = NULL WHERE id = ?`).run(STATUS.SUBMITTED, review.id);
      return svc.get(review.id);
    },

    approve(review, user, comment) {
      if (!canTransition(review.status, STATUS.APPROVED, user.role)) throw new DomainError('Ta ocena nie oczekuje na zatwierdzenie.', 409);
      db.prepare(`UPDATE office_reviews SET status = ?, approved_at = datetime('now'), reviewer_id = ?, review_comment = ? WHERE id = ?`)
        .run(STATUS.APPROVED, user.id, comment, review.id);
      return svc.get(review.id);
    },

    returnForCorrection(review, user, comment) {
      if (!canTransition(review.status, STATUS.IN_PROGRESS, user.role)) throw new DomainError('Ta ocena nie oczekuje na weryfikację.', 409);
      db.prepare(`UPDATE office_reviews SET status = ?, submitted_at = NULL, reviewer_id = ?, review_comment = ? WHERE id = ?`)
        .run(STATUS.IN_PROGRESS, user.id, comment, review.id);
      return svc.get(review.id);
    },

    /** Autor może usunąć swoją ocenę, dopóki nie została złożona; administrator także złożoną (nie zatwierdzoną). */
    canDelete: (user, review) => review.status !== STATUS.APPROVED
      && (user.role === ROLES.ADMIN || (user.role === ROLES.AUDITOR && review.auditor_id === user.id && isEditable(review.status))),
    remove: (review) => db.prepare('DELETE FROM office_reviews WHERE id = ?').run(review.id),

    /** Podsumowanie jednej oceny. */
    summarize(review) {
      const items = svc.items(review.id).map(toScoringItem);
      const score = scoreItems(items);
      const gaps = findGaps(items, { limit: 5 });
      const lines = [];
      if (score.total.percent === null) lines.push('Ocena nie zawiera jeszcze odpowiedzi.');
      else lines.push(`Biuro ds. OZN – ${review.object_name}, kierunek „${review.programme}”: ${fmt(score.total.percent)} (${score.total.rating.label.toLowerCase()}).`);
      if (score.total.completeness < 100) lines.push(`Uzupełniono ${fmt(score.total.completeness)} pytań — wynik może się zmienić.`);
      if (gaps.length) lines.push(`Największe braki: ${gaps.slice(0, 3).map((g) => g.text.replace(/[.\s]+$/, '')).join('; ')}.`);
      return { items, score, gaps, lines };
    },

    /**
     * Raport zbiorczy: zatwierdzone oceny pogrupowane według uczelni i kierunku.
     * Nie miesza się z wynikami audytów obiektów.
     */
    report(user) {
      const scope = scopeIds(user);
      if (scope && !scope.length) return { universities: [], totalReviews: 0 };
      const rows = db.prepare(`${select} WHERE r.status = ? ${scope ? `AND r.object_id IN (${scope.map(() => '?').join(',')})` : ''}
        ORDER BY o.name COLLATE NOCASE, r.programme COLLATE NOCASE, r.id`).all(STATUS.APPROVED, ...(scope || []));
      const withItems = rows.map((r) => ({ ...r, items: svc.items(r.id).map(toScoringItem) }));

      const group = (list, keyFn) => {
        const map = new Map();
        for (const r of list) {
          const k = keyFn(r);
          if (!map.has(k)) map.set(k, []);
          map.get(k).push(r);
        }
        return map;
      };
      const aggregate = (list) => {
        const score = scoreItems(list.flatMap((r) => r.items));
        return {
          count: list.length, score: score.total, categories: score.categories,
          disabilities: [...new Set(list.map((r) => r.disability))],
        };
      };

      const universities = [...group(withItems, (r) => r.object_id).values()].map((list) => ({
        objectId: list[0].object_id,
        name: list[0].object_name,
        ...aggregate(list),
        programmes: [...group(list, (r) => r.programme.trim().toLowerCase()).values()].map((pl) => ({
          name: pl[0].programme.trim(), ...aggregate(pl),
          reviews: pl.map((r) => ({ id: r.id, auditor: r.auditor_name, level: r.study_level, mode: r.study_mode, disability: r.disability, approvedAt: r.approved_at, percent: scoreItems(r.items).total.percent })),
        })),
      }));
      return { universities, totalReviews: rows.length };
    },
  };
  return svc;
}

module.exports = { createOfficeReviewsService };
