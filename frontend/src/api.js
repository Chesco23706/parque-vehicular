const API_HOST = window.location.hostname || '127.0.0.1';
const API = import.meta.env.VITE_API_URL || `http://${API_HOST}:4000/api`;
let csrfToken = '';
let sessionToken = sessionStorage.getItem('pv_session_token') || '';

function csrf() {
  return csrfToken || document.cookie.split('; ').find((row) => row.startsWith('pv_csrf='))?.split('=')[1] || '';
}

async function ensureCsrf() {
  if (csrfToken) return csrfToken;
  const res = await fetch(`${API}/csrf`, { credentials: 'include' });
  const data = await res.json();
  csrfToken = data.csrfToken || '';
  return csrfToken;
}

export async function request(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const method = String(options.method || 'GET').toUpperCase();
  const needsCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (needsCsrf) await ensureCsrf();
  const headers = {
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    'x-csrf-token': csrf(),
    ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    ...options,
    headers
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Error de conexión' }));
    throw new Error(error.message || 'Solicitud no válida');
  }
  const type = res.headers.get('content-type') || '';
  return type.includes('application/json') ? res.json() : res.blob();
}

async function login(data) {
  const user = await request('/auth/login', { method: 'POST', body: JSON.stringify(data) });
  if (user.sessionToken) {
    sessionToken = user.sessionToken;
    sessionStorage.setItem('pv_session_token', sessionToken);
    delete user.sessionToken;
  }
  return user;
}

async function securityConfig() {
  return request('/security/config');
}

async function bootstrapMfa(data) {
  return request('/auth/mfa/bootstrap', { method: 'POST', body: JSON.stringify(data) });
}

async function enableBootstrapMfa(data) {
  return request('/auth/mfa/bootstrap/enable', { method: 'POST', body: JSON.stringify(data) });
}

async function logout() {
  try {
    return await request('/auth/logout', { method: 'POST' });
  } finally {
    sessionToken = '';
    sessionStorage.removeItem('pv_session_token');
  }
}

async function uploadToSignedUrl(signed, file) {
  const body = new FormData();
  body.append('cacheControl', '3600');
  body.append('', file);
  const res = await fetch(signed.signedUrl, { method: 'PUT', body });
  if (!res.ok) throw new Error('No se pudo subir el archivo a Supabase Storage');
  return res.json().catch(() => ({ ok: true }));
}

async function signedUpload(path, file, signer, completer) {
  const signed = await signer({
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size
  });
  await uploadToSignedUrl(signed, file);
  return completer({
    bucket: signed.bucket,
    storedName: signed.storedName,
    fileName: signed.fileName,
    mimeType: signed.mimeType,
    sizeBytes: signed.sizeBytes
  });
}

export async function downloadFile(path, filename) {
  const blob = await request(path);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  securityConfig,
  login,
  bootstrapMfa,
  enableBootstrapMfa,
  logout,
  me: () => request('/auth/me'),
  usuarios: () => request('/auth/users'),
  crearUsuario: (data) => request('/auth/users', { method: 'POST', body: JSON.stringify(data) }),
  cambiarUsuario: (id, activo) => request(`/auth/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ activo }) }),
  cambiarPassword: (id, password) => request(`/auth/users/${id}/password`, { method: 'PATCH', body: JSON.stringify({ password }) }),
  dashboard: () => request('/dashboard'),
  presupuesto: (month) => request(`/presupuesto${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  actualizarPresupuesto: (monto, month) => request('/presupuesto', { method: 'PUT', body: JSON.stringify({ monto, month }) }),
  catalogos: () => request('/meta/catalogos'),
  departamentos: () => request('/meta/departamentos'),
  vehiculos: () => request('/vehiculos'),
  historialVehiculo: (id) => request(`/vehiculos/${id}/historial`),
  crearVehiculo: (data) => request('/vehiculos', { method: 'POST', body: JSON.stringify(data) }),
  editarVehiculo: (id, data) => request(`/vehiculos/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  eliminarVehiculo: (id) => request(`/vehiculos/${id}`, { method: 'DELETE' }),
  crearVehículo: (data) => request('/vehiculos', { method: 'POST', body: JSON.stringify(data) }),
  editarVehículo: (id, data) => request(`/vehiculos/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  eliminarVehículo: (id) => request(`/vehiculos/${id}`, { method: 'DELETE' }),
  reportes: () => request('/reportes'),
  detalleReporte: (id) => request(`/reportes/${id}`),
  reparaciones: () => request('/reparaciones'),
  crearReparacion: (data) => request('/reparaciones', { method: 'POST', body: data instanceof FormData ? data : JSON.stringify(data) }),
  editarReparacion: (id, data) => request(`/reparaciones/${id}`, { method: 'PUT', body: data instanceof FormData ? data : JSON.stringify(data) }),
  crearReporte: (form) => request('/reportes', { method: 'POST', body: form }),
  crearReporteJson: (data) => request('/reportes', { method: 'POST', body: JSON.stringify(data) }),
  editarReporte: (id, data) => request(`/reportes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  subirEvidenciaReporte: (id, file) => signedUpload(
    `/reportes/${id}`,
    file,
    (meta) => request(`/reportes/${id}/evidencias/sign`, { method: 'POST', body: JSON.stringify(meta) }),
    (meta) => request(`/reportes/${id}/evidencias/complete`, { method: 'POST', body: JSON.stringify(meta) })
  ),
  eliminarReporte: (id) => request(`/reportes/${id}`, { method: 'DELETE' }),
  descargarEvidenciaReporte: (reportId, evidence) => downloadFile(`/reportes/${reportId}/evidencias/${evidence.id}/download`, evidence.file_name || `evidencia-${evidence.id}`),
  seguimiento: (id, form) => request(`/reportes/${id}/seguimiento`, { method: 'POST', body: form }),
  talleres: () => request('/talleres'),
  crearTaller: (data) => request('/talleres', { method: 'POST', body: JSON.stringify(data) }),
  asignarTaller: (data) => request('/talleres/asignaciones', { method: 'POST', body: JSON.stringify(data) }),
  asignarTallerCotizacion: (form) => request('/talleres/asignaciones-cotizacion', { method: 'POST', body: form }),
  asignaciones: () => request('/talleres/asignaciones'),
  descargarCotizacionReparacion: (id, filename) => downloadFile(`/reparaciones/${id}/cotizacion`, filename || `cotizacion-reparacion-${id}`),
  checklists: () => request('/checklists'),
  crearChecklist: (data) => request('/checklists', { method: 'POST', body: data instanceof FormData ? data : JSON.stringify(data) }),
  subirEvidenciaChecklist: (id, file) => signedUpload(
    `/checklists/${id}`,
    file,
    (meta) => request(`/checklists/${id}/evidencias/sign`, { method: 'POST', body: JSON.stringify(meta) }),
    (meta) => request(`/checklists/${id}/evidencias/complete`, { method: 'POST', body: JSON.stringify(meta) })
  ),
  alertasChecklist: () => request('/checklists/alertas'),
  historial: () => request('/auditoria'),
  exportarVehiculos: () => downloadFile('/exportar/vehiculos.xls', 'vehiculos.xls'),
  exportarVehículos: () => downloadFile('/exportar/vehiculos.xls', 'vehiculos.xls'),
  descargarRespaldoMensual: (month) => downloadFile(`/exportar/mensual.zip?month=${encodeURIComponent(month)}`, `respaldo-${month}.zip`),
  limpiarRespaldoMensual: (month) => request(`/exportar/mensual?month=${encodeURIComponent(month)}`, { method: 'DELETE' })
};
