const { loadConfig } = require('./config');
const { createApp } = require('./app');
const { seedCatalog } = require('./db/seed');

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const { app, db } = createApp(config);
seedCatalog(db); // idempotentne: uzupełnia tylko pustą bazę kryteriów i scenariuszy

const server = app.listen(config.port, () => {
  console.log(`Tajemniczy Klient działa na porcie ${config.port} (${config.env}, SZO: ${config.szo.mode})`);
});

const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
