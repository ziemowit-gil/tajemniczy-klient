/**
 * Cykl powiadomień dla crona: przypomnienia o terminach audytów + wysyłka kolejki e-mail (z ponawianiem).
 * Aplikacja na hostingu współdzielonym usypia się po braku ruchu, więc to ten skrypt gwarantuje wysyłkę i przypomnienia.
 *   */5 * * * *  cd ~/domains/audytor.feer.org.pl/public_nodejs && node scripts/notify.js
 */
const fs = require('node:fs');
if (fs.existsSync('.env')) process.loadEnvFile('.env');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');

const config = loadConfig();
const { db, services } = createApp(config);

services.notifier.runCycle()
  .then((r) => {
    if (r.reminders || r.sent || r.failed || r.retried) {
      console.log(`${new Date().toISOString()} powiadomienia: przypomnienia ${r.reminders}, wysłano ${r.sent}, ponowień ${r.retried}, błędów ${r.failed}`);
    }
  })
  .catch((err) => { console.error(`${new Date().toISOString()} błąd cyklu powiadomień:`, err.message); process.exitCode = 1; })
  .finally(() => db.close());
