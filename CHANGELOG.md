# Changelog

## V1 - Versión lista para producción inicial

- Proyecto conectado a GitHub, Vercel y Supabase.
- Backend Express preparado para despliegue serverless en Vercel.
- Frontend React/Vite publicado como proyecto separado.
- Base de datos migrada a Supabase PostgreSQL.
- Evidencias y cotizaciones preparadas para Supabase Storage.
- Login con cookies seguras y token Bearer de respaldo para modo incógnito y navegadores restrictivos.
- CSRF firmado compatible con frontend/backend en dominios separados.
- Sesiones simultáneas por usuario para pruebas en varios dispositivos.
- Dashboard, vehículos, reportes, checklist, reparaciones, presupuesto, usuarios e historial funcionando como demo inicial.
- Documentación privada generada en Word, ignorada por Git.

## Pendiente para V1.1

- Integrar Cloudflare Turnstile o reCAPTCHA real.
- Activar MFA obligatorio para administradores.
- Revisar políticas RLS finales con usuarios reales.
- Agregar monitoreo de errores.
- Crear manual de usuario final con capturas.
- Configurar dominio propio.
