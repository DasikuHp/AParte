const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

// Lee la configuración de las variables de entorno (.env) una sola vez.
function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const demo = env.DEMO_MODE === 'true';

  let sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret) {
    if (production && !demo) {
      throw new Error('Falta SESSION_SECRET en el entorno (obligatorio en producción).');
    }
    // En desarrollo se genera uno aleatorio: las sesiones se pierden al reiniciar.
    sessionSecret = crypto.randomBytes(32).toString('hex');
  }

  return {
    production,
    demo,
    port: Number(env.PORT) || 3000,
    sessionSecret,
    // Cookies solo por HTTPS cuando la app va detrás de un proxy con TLS.
    secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
    trustProxy: env.TRUST_PROXY === 'true' || production,
    dbPath: env.DB_PATH || path.join(ROOT, 'data', 'partes.db'),
    uploadsDir: env.UPLOADS_DIR || path.join(ROOT, 'uploads'),
    tecnicosFile: env.TECNICOS_FILE ||
      path.join(ROOT, 'config', demo ? 'tecnicos.example.json' : 'tecnicos.json'),
    smtp: {
      host: env.SMTP_HOST || '',
      port: Number(env.SMTP_PORT) || 587,
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.SMTP_FROM || env.SMTP_USER || '',
    },
  };
}

module.exports = { loadConfig, ROOT };
