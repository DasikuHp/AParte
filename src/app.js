const express = require('express');
const path = require('path');
const helmet = require('helmet');

const { createSessionMiddleware, requireAuth } = require('./middleware/auth');
const { authRouter } = require('./routes/auth');
const { partesRouter } = require('./routes/partes');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Crea la app sin arrancar el servidor, para poder usarla en los tests.
function createApp({ config, db, mailer, tecnicos }) {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);

  // Cabeceras de seguridad. La CSP permite solo los CDN que usa partes.html
  // y los manejadores onclick en línea que tiene el HTML.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
        'script-src-attr': ["'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': config.production ? [] : null,
      },
    },
  }));

  app.use(express.json({ limit: '15mb' })); // el PDF viaja en base64
  app.use(createSessionMiddleware(config));

  app.use(express.static(PUBLIC_DIR));
  app.use('/uploads', requireAuth, express.static(config.uploadsDir, { index: false, dotfiles: 'deny' }));

  app.use('/api', authRouter({ tecnicos, config }));
  app.use('/api', requireAuth, partesRouter({ db, mailer, config, tecnicos }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'partes.html')));

  // Errores: al cliente solo le llega el mensaje si es un error suyo (4xx).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status < 500 ? err.message : 'Error interno del servidor' });
  });

  return app;
}

module.exports = { createApp };
