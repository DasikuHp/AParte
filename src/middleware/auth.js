const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  const tokenRuben = process.env.TOKEN_LAURA;
  const tokenTono = process.env.TOKEN_CARLOS;

  if (token && token === tokenRuben) {
    req.tech = 'laura';
    next();
  } else if (token && token === tokenTono) {
    req.tech = 'carlos';
    next();
  } else {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

module.exports = authMiddleware;
