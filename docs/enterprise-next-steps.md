# Siguientes pasos empresariales

## Prioridad alta

1. Activar CAPTCHA real.
   - Recomendado: Cloudflare Turnstile.
   - Vercel backend:
     - `CAPTCHA_PROVIDER=turnstile`
     - `CAPTCHA_SITE_KEY=<site-key-publica>`
     - `CAPTCHA_SECRET_KEY=<secret-key-privada>`
     - `CAPTCHA_REQUIRED=true`
   - Redeploy backend y frontend.
   - Verificar `/api/health`: `captchaConfigured=true` y `captchaRequired=true`.

2. Revisar permisos finales de `app_api`.
   - Ejecutar `backend/sql/security-audit.sql`.
   - Confirmar que `app_api` no tenga `rolsuper`, `rolcreaterole`, `rolcreatedb` ni `rolbypassrls`.
   - Confirmar que Vercel usa `app_api.<project-ref>` en `DATABASE_URL`, no `postgres`.

3. Aplicar politica de retencion.
   - Revisar los intervalos en `backend/sql/retention-policies.sql`.
   - Ejecutar el SQL en Supabase.
   - Ejecutar manualmente `select * from cleanup_operational_retention();` o programarlo con `pg_cron` si esta disponible.

## Prioridad media

1. Alertas.
   - Sentry sirve para errores de aplicacion.
   - Un webhook tipo Slack/Teams/Discord sirve para eventos de seguridad ya auditados por el backend.
   - Variable backend: `ALERT_WEBHOOK_URL=<url-del-webhook>`.

2. Pentesting basico.
   - No es "hackeo avanzado"; es una prueba controlada para validar que los controles funcionan.
   - Ejecutar `npm run security:smoke`.
   - Probar manualmente:
     - SQL injection en login y filtros.
     - Acceso sin sesion a endpoints privados.
     - Acceso cruzado entre departamentos.
     - CSRF en POST/PUT/DELETE sin `x-csrf-token`.
     - Subida de archivos no permitidos o demasiado grandes.
     - Reuso de token desde otro navegador/IP.

3. Secret scanning.
   - Ejecutar `npm run security:secrets` antes de cada entrega.
   - Revisar tambien historial con busquedas sobre commits si se sospecha exposicion.

## Pendiente aceptado

RLS fino para `sesiones` y `bitacora_actividad` queda diferido. El siguiente paso correcto seria reemplazar los inserts directos con funciones `security definer` controladas, para poder reactivar RLS sin romper login/auditoria.

