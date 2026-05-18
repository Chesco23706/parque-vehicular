import crypto from 'node:crypto';
import { config } from './config.js';

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function expiresInMinutes(minutes = config.sessionMinutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

export function cookieOptions(maxAgeMs = config.sessionMinutes * 60 * 1000, httpOnly = true) {
  return {
    httpOnly,
    sameSite: config.cookieSecure ? 'none' : 'strict',
    secure: config.cookieSecure,
    maxAge: maxAgeMs,
    path: '/'
  };
}

export function normalizeIp(req) {
  return String(req.ip || req.socket?.remoteAddress || '').slice(0, 80);
}

export function normalizeUserAgent(req) {
  return String(req.get('user-agent') || 'unknown').slice(0, 500);
}

export function verifyTotp(secret, code) {
  if (!secret || !code || !/^\d{6}$/.test(String(code))) return false;
  const windowSteps = [-1, 0, 1];
  const step = Math.floor(Date.now() / 30000);
  return windowSteps.some((offset) => hotp(secret, step + offset) === String(code));
}

function hotp(secret, counter) {
  const key = Buffer.from(secret, 'base64url');
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 1000000).padStart(6, '0');
}

