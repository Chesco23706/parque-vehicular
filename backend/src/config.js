import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  sessionMinutes: Number(process.env.SESSION_MINUTES || 30),
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: process.env.DATABASE_SSL !== 'false',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  databasePath: process.env.DATABASE_PATH || './parque_vehicular.db',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5173',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 25),
  cookieSecure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
  requireHttps: process.env.REQUIRE_HTTPS === 'true' || process.env.NODE_ENV === 'production',
  captchaToken: process.env.CAPTCHA_TOKEN || '',
  passwordResetMinutes: Number(process.env.PASSWORD_RESET_MINUTES || 20)
};

