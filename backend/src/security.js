import crypto from 'node:crypto';
import { config } from './config.js';

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(bytes = 20) {
  const data = crypto.randomBytes(bytes);
  let bits = '';
  let secret = '';

  for (const byte of data) {
    bits += byte.toString(2).padStart(8, '0');
  }

  for (let i = 0; i + 5 <= bits.length; i += 5) {
    secret += base32Alphabet[parseInt(bits.slice(i, i + 5), 2)];
  }

  return secret;
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

export function sessionFingerprint(req) {
  return crypto
    .createHash('sha256')
    .update(`${normalizeUserAgent(req)}|${normalizeIp(req).split('.').slice(0, 3).join('.')}`)
    .digest('hex');
}

export function isMfaRequired(role) {
  return config.mfaRequiredRoles.includes(role);
}

export function captchaConfigured() {
  return Boolean(config.captchaSecretKey && ['turnstile', 'recaptcha'].includes(config.captchaProvider));
}

export async function verifyCaptcha(req) {
  const token = String(req.body?.captchaToken || req.get('x-captcha-token') || '').trim();

  if (!config.captchaRequired && !token) return { ok: true, skipped: true };

  if (config.captchaToken && token && token === config.captchaToken && process.env.NODE_ENV !== 'production') {
    return { ok: true, provider: 'dev-token' };
  }

  if (!captchaConfigured()) {
    return { ok: false, reason: 'captcha_not_configured' };
  }

  const endpoint = config.captchaProvider === 'turnstile'
    ? 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
    : 'https://www.google.com/recaptcha/api/siteverify';

  const body = new URLSearchParams({
    secret: config.captchaSecretKey,
    response: token,
    remoteip: normalizeIp(req)
  });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const data = await response.json();
    return {
      ok: Boolean(data.success),
      provider: config.captchaProvider,
      reason: data['error-codes']?.join(',') || null
    };
  } catch (error) {
    return { ok: false, provider: config.captchaProvider, reason: error.message };
  }
}

const alertLevels = { low: 1, medium: 2, high: 3, critical: 4 };

export async function sendSecurityAlert(event, payload = {}, level = 'high') {
  if (!config.alertWebhookUrl) return;
  if ((alertLevels[level] || 0) < (alertLevels[config.alertMinLevel] || alertLevels.high)) return;

  const safePayload = JSON.parse(JSON.stringify(payload, (_key, value) => {
    if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}...`;
    return value;
  }));

  try {
    await fetch(config.alertWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `[${level.toUpperCase()}] ${event}`,
        event,
        level,
        app: 'parque-vehicular',
        version: config.appVersion,
        at: new Date().toISOString(),
        payload: safePayload
      })
    });
  } catch (error) {
    console.error('No se pudo enviar alerta de seguridad', error);
  }
}

export function verifyTotp(secret, code) {
  if (!secret || !code || !/^\d{6}$/.test(String(code))) return false;
  const windowSteps = [-1, 0, 1];
  const step = Math.floor(Date.now() / 30000);
  return windowSteps.some((offset) => hotp(secret, step + offset) === String(code));
}

function hotp(secret, counter) {
  const key = decodeTotpSecret(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 1000000).padStart(6, '0');
}

function decodeTotpSecret(secret) {
  const normalized = String(secret).replace(/\s+/g, '').replace(/=+$/g, '').toUpperCase();
  if (/^[A-Z2-7]+$/.test(normalized)) return decodeBase32(normalized);
  return Buffer.from(secret, 'base64url');
}

function decodeBase32(value) {
  let bits = '';
  const bytes = [];

  for (const char of value) {
    const index = base32Alphabet.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 TOTP secret');
    bits += index.toString(2).padStart(5, '0');
  }

  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return Buffer.from(bytes);
}

