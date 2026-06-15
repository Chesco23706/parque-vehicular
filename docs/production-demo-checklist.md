# Checklist para demo de producción

## Antes de compartir el enlace

- Confirmar que frontend y backend estén desplegados en Vercel sin errores.
- Probar `https://<backend>/api/health` y confirmar `ok: true`.
- Probar login en navegador normal e incógnito.
- Probar al menos un usuario administrador y un usuario de departamento.
- Confirmar que `FRONTEND_ORIGIN` y `FRONTEND_ORIGINS` tengan el dominio público real del frontend.
- Confirmar que `VITE_API_URL` apunte al backend público terminado en `/api`.
- Confirmar que `.env` no esté en GitHub.
- Confirmar que el demo no muestre contraseñas ni datos sensibles en pantalla.

## Variables recomendadas en backend

```txt
NODE_ENV=production
APP_VERSION=1.0.0
DATABASE_SSL=true
COOKIE_SECURE=true
REQUIRE_HTTPS=true
CAPTCHA_REQUIRED=false
MFA_REQUIRED_ROLES=
SESSION_MINUTES=30
MAX_UPLOAD_MB=25
```

Para una demo cerrada puedes dejar `CAPTCHA_REQUIRED=false` y `MFA_REQUIRED_ROLES=`. Para producción formal, activa captcha y MFA.

## Pruebas rápidas

1. Iniciar sesión como administrador.
2. Crear o editar un vehículo de prueba.
3. Crear un reporte de falla.
4. Asignar taller y cotización.
5. Registrar una reparación.
6. Llenar checklist diario.
7. Revisar dashboard y presupuesto.
8. Probar descarga Excel.
9. Cerrar sesión.
10. Repetir con usuario de departamento para validar permisos.

## Recomendaciones para venta

- Presentar el sistema como V1 operativa, lista para uso inicial controlado.
- Explicar que las mejoras futuras se priorizarán con retroalimentación de usuarios.
- Ofrecer una etapa piloto de 15 a 30 días.
- Crear un canal de soporte: WhatsApp, correo o formulario.
- Registrar solicitudes de mejora por módulo: vehículos, reportes, checklist, presupuesto, usuarios.
- Separar ambiente demo y ambiente cliente para no mezclar datos.

## Pendiente antes de operación real

- Dominio propio.
- Captcha real con Cloudflare Turnstile.
- MFA obligatorio para administradores.
- Backups automáticos programados.
- Política de privacidad y aviso de tratamiento de datos.
- Manual rápido de usuario con capturas.
- Prueba de carga con usuarios reales estimados.
