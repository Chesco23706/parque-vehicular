import crypto from 'node:crypto';
import { config } from '../config.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrf(req, res, next) {
  if (!req.cookies?.pv_csrf) {
    res.cookie('pv_csrf', crypto.randomBytes(24).toString('hex'), {
      sameSite: config.cookieSecure ? 'none' : 'strict',
      secure: config.cookieSecure,
      httpOnly: false
    });
  }

  if (SAFE.has(req.method)) return next();

  const cookieToken = req.cookies?.pv_csrf;
  const headerToken = req.get('x-csrf-token');
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ message: 'Token CSRF inválido' });
  }
  next();
}

