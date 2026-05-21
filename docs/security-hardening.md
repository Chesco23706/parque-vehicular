# Seguridad Operativa

## Controles implementados

- Captcha real en endpoints sensibles: login, reset de password, verificacion de email y bootstrap MFA.
- MFA obligatorio para roles definidos en `MFA_REQUIRED_ROLES`, por defecto `admin`.
- Sesiones con huella de navegador/IP, revocacion por cambio de user-agent/fingerprint y alertas por cambios repetidos de IP.
- Alertas por webhook para eventos criticos: MFA faltante, captcha fallido, sesiones sospechosas, errores 500 y backups.
- Script de respaldo automatico con `pg_dump`, subida a Supabase Storage y retencion.
- Smoke tests basicos de seguridad y scanner local de secretos.
- Plantilla SQL para RLS final en Supabase.

## Variables criticas por ambiente

Produccion y preview deben usar proyectos/secretos separados:

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FRONTEND_ORIGIN` y `FRONTEND_ORIGINS`
- `CAPTCHA_PROVIDER`, `CAPTCHA_SITE_KEY`, `CAPTCHA_SECRET_KEY`
- `ALERT_WEBHOOK_URL`
- `MFA_REQUIRED_ROLES`
- `BACKUP_BUCKET`

En Vercel configura valores distintos para `Production`, `Preview` y `Development`. No reutilices la service role key de produccion en preview.

## Rotacion de claves

Rota cualquier clave que haya sido vista en pantalla, enviada por chat o guardada en `.env` fuera del equipo autorizado:

1. Supabase: rota `service_role`, anon key si se expuso, password de base y JWT secret del proyecto si aplica.
2. Vercel: actualiza Environment Variables en Production y Preview por separado.
3. Captcha: regenera secret key del proveedor.
4. Webhooks: regenera URLs de Slack/Teams/Discord si se compartieron.
5. Ejecuta `npm run security:secrets` antes de publicar.

## Backups

Ejecuta manualmente:

```bash
npm run backup
```

Para automatizarlo, programa un job diario en un runner seguro con:

```bash
cd backend
npm run backup
```

Requisitos:

- `pg_dump` instalado o `PG_DUMP_PATH` apuntando al binario.
- Bucket privado `backups` en Supabase Storage.
- `BACKUP_RETENTION_DAYS` definido segun politica municipal o contractual.

## Pentesting basico

Con el backend levantado:

```bash
npm run security:smoke
```

Complementa con:

- Intentos de login con SQL injection.
- Acceso cruzado entre departamentos.
- Carga de archivos no permitidos y archivos grandes.
- Reuso de sesion desde otro navegador/IP.
- Pruebas de CSRF en POST/PUT/DELETE.

## RLS final

Antes de operar con datos reales, revisa y adapta:

```text
backend/sql/rls-policies.sql
```

Modo empresarial recomendado:

1. Ejecuta `backend/sql/app-api-role.sql` en Supabase, cambiando la contrasena.
2. Ejecuta `backend/sql/rls-policies.sql`.
3. Cambia `DATABASE_URL` para usar `app_api`, no `postgres`.
4. Conserva `SUPABASE_SERVICE_ROLE_KEY` solo para Storage/backups desde backend.
5. Verifica que cada request autenticado define `app.current_user_id`. El backend ya lo hace en `authRequired` con una transaccion por request.

Nota: `service_role` y roles con `BYPASSRLS` saltan RLS. No uses esos roles para `DATABASE_URL` normal.
