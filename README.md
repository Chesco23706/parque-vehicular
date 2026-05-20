# Parque Vehicular Izamal

Versión actual: **v0.5**

Plataforma web para administrar vehículos oficiales por departamentos, con inicio de sesión, roles, reportes de fallas, seguimiento, talleres, reparaciones, checklist diario, presupuesto, auditoría y exportación de reportes.

## Estructura

- `backend/`: API Node.js + Express conectada a Supabase/PostgreSQL.
- `frontend/`: React + Vite para la interfaz web.
- Supabase Storage: evidencias, cotizaciones, reparaciones y respaldos mensuales.

## Arranque local

1. Instalar dependencias:

```bash
npm run install:all
```

2. Crear `backend/.env` tomando como base `backend/.env.example`.

3. Preparar datos demo:

```bash
npm run seed
```

4. Ejecutar backend y frontend:

```bash
npm run dev
```

URLs locales:

- Frontend: `http://127.0.0.1:5173`
- Backend: `http://127.0.0.1:4000/api`
- Health check: `http://127.0.0.1:4000/api/health`

## Variables importantes

Backend:

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `FRONTEND_ORIGIN`
- `FRONTEND_ORIGINS`
- `COOKIE_SECURE`
- `REQUIRE_HTTPS`

Frontend:

- `VITE_API_URL`

## Usuarios demo

- `admin@parque.local`
- `policia@parque.local`
- `servicios@parque.local`
- `agua@parque.local`
- `logistica@parque.local`

Contraseña demo: `Parque2026!`

## Seguridad incluida

- Contraseñas cifradas con bcrypt.
- Sesiones en cookie HTTP-only y respaldo por token Bearer para navegadores que bloquean cookies de terceros.
- CSRF firmado compatible con despliegue separado en Vercel.
- Helmet, CSP, CORS restringido y rate limiting.
- Validación backend con Zod.
- Consultas parametrizadas contra PostgreSQL.
- Roles y permisos por departamento.
- Bitácora de actividad.
- Restricción de tipo y tamaño en archivos.
- Storage privado en Supabase.

## Despliegue sugerido

- Backend: Vercel, root directory `backend`.
- Frontend: Vercel, root directory `frontend`.
- Base de datos y archivos: Supabase.
