const session = require('express-session');

function createSessionMiddleware(config) {
  return session({
    name: 'partes.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax', // el navegador no la envía en peticiones POST desde otras webs (CSRF)
      secure: config.secureCookies,
      maxAge: 8 * 60 * 60 * 1000, // 8 horas
    },
  });
}

// Corta la petición si no hay un técnico en la sesión.
function requireAuth(req, res, next) {
  if (!req.session || !req.session.tech) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
}

module.exports = { createSessionMiddleware, requireAuth };
