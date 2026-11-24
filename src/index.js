require('dotenv').config();

const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { createMailer } = require('./mailer');
const { loadTecnicos } = require('./tecnicos');
const { createApp } = require('./app');

const config = loadConfig();
const db = openDb(config.dbPath);
const mailer = createMailer(config);
const tecnicos = loadTecnicos(config.tecnicosFile);

if (config.demo) {
  require('./scripts/seed').seedIfEmpty(db);
}

createApp({ config, db, mailer, tecnicos }).listen(config.port, () => {
  console.log(`Partes de servicio en http://localhost:${config.port}`);
  if (config.demo) console.log('Modo demo: datos ficticios, contraseña demo1234, los correos no se envían.');
  else if (mailer.simulated) console.log('Aviso: SMTP sin configurar, los correos no se envían.');
});
