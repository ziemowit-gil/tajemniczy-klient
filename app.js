// Punkt wejścia dla Phusion Passenger (MyDevil wymaga pliku app.js w katalogu public_nodejs).
// Ustawienia czytamy z pliku .env obok aplikacji (hosting nie przekazuje flag `node --env-file`).
const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

require('./src/server');
