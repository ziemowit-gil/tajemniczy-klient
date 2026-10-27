const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { seedCatalog } = require('../src/db/seed');

const config = loadConfig();
const db = openDatabase(config.databasePath);
seedCatalog(db);
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
console.log(`Baza gotowa: ${config.databasePath}\nKryteria: ${count('criteria')}, scenariusze: ${count('scenarios')}`);
db.close();
