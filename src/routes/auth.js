const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

function authRouter({ tecnicos, config }) {
  const router = express.Router();

  // 10 intentos fallidos de login por IP cada 15 minutos.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera unos minutos.' },
  });

  // Lista pública para la pantalla de login (sin NIF, móvil ni firma).
  router.get('/tecnicos', (req, res) => {
    res.json({ tecnicos: tecnicos.publicList(), demo: config.demo });
  });

  router.post('/auth/login', loginLimiter, async (req, res, next) => {
    try {
      const { tech, password } = req.body || {};
      if (typeof tech !== 'string' || typeof password !== 'string' || !password) {
        return res.status(400).json({ error: 'Faltan el técnico o la contraseña' });
      }
      const t = tecnicos.get(tech);
      // Mismo mensaje si el técnico no existe o la contraseña falla.
      if (!t || !(await bcrypt.compare(password, t.passwordHash))) {
        return res.status(401).json({ error: 'Técnico o contraseña incorrectos' });
      }
      // Nueva sesión al entrar, para que no se pueda reutilizar un id de sesión previo.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.tech = t.id;
        res.json({ perfil: tecnicos.perfil(t.id) });
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/logout', (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('partes.sid');
      res.json({ ok: true });
    });
  });

  router.get('/auth/me', (req, res) => {
    const perfil = req.session?.tech && tecnicos.perfil(req.session.tech);
    if (!perfil) return res.status(401).json({ error: 'No autenticado' });
    res.json({ perfil });
  });

  return router;
}

module.exports = { authRouter };
