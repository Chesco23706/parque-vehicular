import dotenv from 'dotenv';

dotenv.config();

function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === 'true';
}

export const config = {
  appVersion: process.env.APP_VERSION || '0.5.0',
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  sessionMinutes: Number(process.env.SESSION_MINUTES || 30),
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: process.env.DATABASE_SSL !== 'false',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  databasePath: process.env.DATABASE_PATH || './parque_vehicular.db',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5173',
  frontendOrigins: (process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 25),
  cookieSecure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
  requireHttps: process.env.REQUIRE_HTTPS === 'true' || process.env.NODE_ENV === 'production',
  captchaToken: process.env.CAPTCHA_TOKEN || '',
  captchaProvider: (process.env.CAPTCHA_PROVIDER || '').toLowerCase(),
  captchaSecretKey: process.env.CAPTCHA_SECRET_KEY || '',
  captchaSiteKey: process.env.CAPTCHA_SITE_KEY || '',
  captchaRequired: envFlag('CAPTCHA_REQUIRED', process.env.NODE_ENV === 'production'),
  passwordResetMinutes: Number(process.env.PASSWORD_RESET_MINUTES || 20),
  mfaRequiredRoles: (process.env.MFA_REQUIRED_ROLES || 'admin')
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean),
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || '',
  alertMinLevel: process.env.ALERT_MIN_LEVEL || 'high',
  maxIpChangesPerSession: Number(process.env.MAX_IP_CHANGES_PER_SESSION || 2),
  maxSuspiciousSessionsPerUser: Number(process.env.MAX_SUSPICIOUS_SESSIONS_PER_USER || 3),
  backupBucket: process.env.BACKUP_BUCKET || 'backups',
  rlsAppSetting: process.env.RLS_APP_SETTING || 'app.current_user_id',
  runMigrations: process.env.RUN_MIGRATIONS === 'true' || (process.env.NODE_ENV !== 'production' && process.env.RUN_MIGRATIONS !== 'false')
};

