import crypto from 'node:crypto';
import { config } from '../config.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrf(req, res, next) {
  let token = req.cookies?.pv_csrf;
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    res.cookie('pv_csrf', token, {
      sameSite: config.cookieSecure ? 'none' : 'strict',
      secure: config.cookieSecure,
      httpOnly: false
    });
  }
  res.locals.csrfToken = token;

  if (SAFE.has(req.method)) return next();

  const headerToken = req.get('x-csrf-token');
  if (!token || !headerToken || token !== headerToken) {
    return res.status(403).json({ message: 'Token CSRF inválido' });
  }
  next();
}

