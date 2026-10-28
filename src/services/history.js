/** Dziennik zdarzeń audytów (`audit`) i ocen „Dostępność kształcenia” (`review`). */
const ACTION_LABELS = {
  entered: 'Wprowadzono do systemu',
  assigned: 'Przydzielono do TK',
  edited: 'Zmieniono dane audytu',
  accepted: 'Przyjęto audyt do realizacji',
  declined: 'Odrzucono audyt przez TK',
  created: 'Rozpoczęto ocenę',
  started: 'Rozpoczęto wypełnianie',
  submitted: 'Uzupełniono raport',
  approved: 'Zatwierdzono',
  returned: 'Zwrócono do poprawy',
  scenarios_changed: 'Zmieniono scenariusze',
  attachment_added: 'Dodano załączniki',
  attachment_removed: 'Usunięto załącznik',
};

function createHistoryService(db) {
  const insert = db.prepare(`INSERT INTO history_events (entity_type, entity_id, actor_id, actor_name, action, note) VALUES (?, ?, ?, ?, ?, ?)`);
  const select = db.prepare('SELECT * FROM history_events WHERE entity_type = ? AND entity_id = ? ORDER BY id');

  return {
    labels: ACTION_LABELS,

    /** Zapisuje zdarzenie; actor może być null (zdarzenie systemowe). */
    log(entityType, entityId, actor, action, note = null) {
      if (!ACTION_LABELS[action]) throw new Error(`Nieznane zdarzenie historii: ${action}`);
      insert.run(entityType, entityId, actor?.id ?? null, actor?.name ?? null, action, note ? String(note).slice(0, 2000) : null);
    },

    list: (entityType, entityId) => select.all(entityType, entityId),
  };
}

module.exports = { createHistoryService, ACTION_LABELS };
