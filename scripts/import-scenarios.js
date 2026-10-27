/**
 * Import paczki przykładowych scenariuszy do słownika (idempotentny: istniejące tytuły są pomijane).
 *   npm run scenarios:import -- uczelnie
 */
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { PACKS, importPack } = require('../src/db/scenarioPacks');

const key = process.argv[2] || 'uczelnie';
if (!PACKS[key]) {
  console.error(`Nieznana paczka „${key}”. Dostępne: ${Object.keys(PACKS).join(', ')}`);
  process.exit(1);
}
const config = loadConfig();
const db = openDatabase(config.databasePath);
const { added, skipped } = importPack(db, key);
console.log(`Paczka „${key}”: dodano ${added.length}, pominięto istniejące ${skipped.length}.`);
db.close();
