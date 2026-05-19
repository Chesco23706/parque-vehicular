import crypto from 'node:crypto';
import { config } from '../config.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function sign(value) {
  return crypto.createHmac('sha256', config.jwtSecret).update(value).digest('base64url');
}

function createToken() {
  const nonce = crypto.randomBytes(24).toString('base64url');
  return `${nonce}.${sign(nonce)}`;
}

function validSignedToken(token = '') {
  const [nonce, signature] = String(token).split('.');
  if (!nonce || !signature) return false;
  const expected = sign(nonce);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function csrf(req, res, next) {
  let token = req.cookies?.pv_csrf;
  if (!validSignedToken(token)) {
    token = createToken();
    res.cookie('pv_csrf', token, {
      sameSite: config.cookieSecure ? 'none' : 'strict',
      secure: config.cookieSecure,
      httpOnly: false
    });
  }
  res.locals.csrfToken = token;

  if (SAFE.has(req.method)) return next();

  const headerToken = req.get('x-csrf-token');
  const cookieMatches = token && headerToken && token === headerToken;
  const signedHeaderIsValid = validSignedToken(headerToken);
  if (!cookieMatches && !signedHeaderIsValid) {
    return res.status(403).json({ message: 'Token CSRF inválido' });
  }
  next();
}

