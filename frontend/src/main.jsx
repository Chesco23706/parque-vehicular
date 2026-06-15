import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  Car,
  ClipboardCheck,
  Eye,
  FileDown,
  HelpCircle,
  History,
  LayoutDashboard,
  Loader2,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  UserCog,
  Wallet,
  Wrench
} from 'lucide-react';
import { api } from './api.js';
import './styles.css';

const APP_VERSION = 'V1.1';
const APP_CHANGE_TITLE = 'Informe detallado mensual de presupuesto';
const APP_RELEASE_TITLE = `${APP_VERSION} - ${APP_CHANGE_TITLE}`;
document.title = APP_RELEASE_TITLE;
const MAX_EVIDENCE_FILES = 5;
const MAX_UPLOAD_FILE_BYTES = 100 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 250 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1600;
const IMAGE_COMPRESS_QUALITY = 0.82;
const evidenceTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4', 'video/quicktime']);

const tabs = [
  { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard },
  { id: 'vehiculos', label: 'Vehículos', icon: Car },
  { id: 'reparaciones', label: 'Reparaciones', icon: Wrench },
  { id: 'reportes', label: 'Reportes', icon: AlertTriangle },
  { id: 'checklist', label: 'Checklist', icon: ClipboardCheck },
  { id: 'historial', label: 'Historial vehicular', icon: History },
  { id: 'presupuesto', label: 'Presupuesto', icon: Wallet, adminOnly: true },
  { id: 'ayuda', label: 'Ayuda', icon: HelpCircle },
  { id: 'usuarios', label: 'Usuarios', icon: UserCog, adminOnly: true }
];

const nextFlow = {
  'Reporte recibido': 'En revision por Parque Vehicular',
  'En revision por Parque Vehicular': 'Taller asignado',
  'Taller asignado': 'En diagnostico',
  'En diagnostico': 'Reparacion en proceso',
  'Reparacion en proceso': 'Reparacion terminada',
  'Reparacion terminada': 'Vehiculo entregado',
  'Vehiculo entregado': 'Caso cerrado'
};

const reportFlowSteps = [
  ['Reporte recibido', 'Reporte recibido', 'La solicitud fue registrada.'],
  ['En revision por Parque Vehicular', 'En revisión', 'Parque Vehicular está revisando el caso.'],
  ['Taller asignado', 'Cotización registrada', 'La falla ya tiene registro de atención.'],
  ['En diagnostico', 'En diagnóstico', 'La falla está siendo revisada.'],
  ['Reparacion en proceso', 'Reparación en proceso', 'La unidad se encuentra en reparación.'],
  ['Reparacion terminada', 'Reparación terminada', 'El trabajo fue terminado por el taller.'],
  ['Vehiculo entregado', 'Vehículo entregado', 'La unidad fue devuelta al departamento.'],
  ['Caso cerrado', 'Caso cerrado', 'El reporte quedó cerrado.']
];

const statusLabels = {
  'En revision': 'En revisión',
  'En revision por Parque Vehicular': 'En revisión por Parque Vehicular',
  'En diagnostico': 'En diagnóstico',
  'Taller asignado': 'Cotización registrada',
  'Reparacion en proceso': 'Reparación en proceso',
  'Reparacion terminada': 'Reparación terminada',
  'Vehiculo entregado': 'Vehículo entregado',
  'En reparacion': 'En reparación',
  'Esperando refacciones': 'Esperando refacciones',
  'Con falla reportada': 'Con falla reportada',
  'Fuera de servicio': 'Fuera de servicio'
};

function labelStatus(value = '') {
  return statusLabels[value] || value;
}

const failureLabels = {
  Mecanica: 'Mecánica',
  Electrica: 'Eléctrica',
  Carroceria: 'Carrocería',
  Documentacion: 'Documentación',
  Reparacion: 'Reparación'
};

function labelFailure(value = '') {
  return failureLabels[value] || value;
}

function labelUrgency(value = '') {
  return value === 'Critica' ? 'Crítica' : value;
}

const departmentLabels = {
  'Parque Vehicular / Administracion': 'Parque Vehicular / Administración',
  'Policia Municipal': 'Policía Municipal',
  'Servicios Publicos': 'Servicios Públicos',
  Logistica: 'Logística'
};

function labelDepartment(value = '') {
  return departmentLabels[value] || value;
}

function labelName(value = '') {
  return departmentLabels[value] || value;
}

function statusClass(value = '') {
  const normalized = value.toLowerCase();
  if (normalized === 'disponible') return 'ok';
  if (normalized.includes('revision')) return 'warn';
  if (normalized.includes('taller')) return 'shop';
  if (normalized.includes('falla') || normalized.includes('servicio') || normalized === 'critica') return 'bad';
  return 'muted';
}

function money(value) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value || 0));
}

function localDateInput(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function localMonthInput(date = new Date()) {
  return localDateInput(date).slice(0, 7);
}

function fileSizeMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '';
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return fileSizeMb(value);
}

function renamedImageFileName(name) {
  return `${name.replace(/\.[^.]+$/, '') || 'evidencia'}.jpg`;
}

async function compressImageFile(file) {
  if (!file.type.startsWith('image/') || file.size <= MAX_UPLOAD_FILE_BYTES) return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', IMAGE_COMPRESS_QUALITY));
  if (!blob) throw new Error(`No se pudo comprimir ${file.name}.`);
  return new File([blob], renamedImageFileName(file.name), { type: 'image/jpeg', lastModified: Date.now() });
}

async function prepareEvidenceFiles(incoming, currentFiles) {
  const nextFiles = [...currentFiles];
  const messages = [];

  for (const originalFile of incoming) {
    if (!evidenceTypes.has(originalFile.type)) {
      messages.push(`${originalFile.name}: formato no permitido.`);
      continue;
    }

    let file = originalFile;
    try {
      file = await compressImageFile(originalFile);
      if (file !== originalFile) messages.push(`${originalFile.name}: imagen comprimida para poder subirla.`);
    } catch (error) {
      messages.push(error.message);
      continue;
    }

    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      messages.push(`${file.name}: pesa ${fileSizeMb(file.size)}. El máximo por archivo es ${fileSizeMb(MAX_UPLOAD_FILE_BYTES)}.`);
      continue;
    }

    const exists = nextFiles.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
    if (!exists) nextFiles.push(file);
  }

  if (nextFiles.length > MAX_EVIDENCE_FILES) {
    return { files: currentFiles, message: `Puedes subir máximo ${MAX_EVIDENCE_FILES} evidencias.` };
  }

  const total = nextFiles.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_UPLOAD_TOTAL_BYTES) {
    return {
      files: currentFiles,
      message: `Las evidencias pesan ${fileSizeMb(total)} en total. Sube máximo ${fileSizeMb(MAX_UPLOAD_TOTAL_BYTES)} por envío.`
    };
  }

  return { files: nextFiles, message: messages.join(' ') };
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [captcha, setCaptcha] = useState({ captchaProvider: null, captchaSiteKey: null, captchaRequired: false });
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [mfaSecret, setMfaSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const captchaEnabled = Boolean(captcha.captchaProvider && captcha.captchaSiteKey);
  const captchaMissing = captchaEnabled && !captchaToken;

  function resetCaptcha() {
    if (!captchaEnabled) return;
    setCaptchaToken('');
    setCaptchaResetKey((current) => current + 1);
  }

  useEffect(() => {
    let active = true;
    api.securityConfig().then((settings) => {
      if (active) setCaptcha(settings);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!captcha.captchaProvider || !captcha.captchaSiteKey) return;
    const src = captcha.captchaProvider === 'turnstile'
      ? 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      : 'https://www.google.com/recaptcha/api.js?render=explicit';
    if (!document.querySelector(`script[src="${src}"]`)) {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }, [captcha.captchaProvider, captcha.captchaSiteKey]);

  useEffect(() => {
    if (!captcha.captchaProvider || !captcha.captchaSiteKey) return undefined;
    const container = document.getElementById('captcha-widget');
    if (!container) return undefined;
    container.innerHTML = '';
    setCaptchaToken('');
    let cancelled = false;
    let widgetId = null;
    const timer = setInterval(() => {
      if (cancelled) return;
      if (captcha.captchaProvider === 'turnstile' && window.turnstile) {
        clearInterval(timer);
        widgetId = window.turnstile.render(container, {
          sitekey: captcha.captchaSiteKey,
          callback: setCaptchaToken,
          'expired-callback': () => setCaptchaToken('')
        });
      }
      if (captcha.captchaProvider === 'recaptcha' && window.grecaptcha?.render) {
        clearInterval(timer);
        widgetId = window.grecaptcha.render(container, {
          sitekey: captcha.captchaSiteKey,
          callback: setCaptchaToken,
          'expired-callback': () => setCaptchaToken('')
        });
      }
    }, 250);
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (captcha.captchaProvider === 'turnstile' && window.turnstile && widgetId !== null) window.turnstile.remove(widgetId);
    };
  }, [captcha.captchaProvider, captcha.captchaSiteKey, captchaResetKey]);

  async function submit(event) {
    event.preventDefault();
    if (captchaMissing) {
      setError('Completa la verificacion anti-bot.');
      return;
    }
    setBusy(true);
    setError('');
    setMfaSecret('');
    try {
      onLogin(await api.login({ email, password, mfa_code: mfaCode, captchaToken }));
    } catch (err) {
      setError(err.message);
    } finally {
      resetCaptcha();
      setBusy(false);
    }
  }

  async function setupMfa() {
    if (captchaMissing) {
      setError('Completa la verificacion anti-bot nuevamente para generar el secreto MFA.');
      return;
    }
    setBusy(true);
    setError('');
    setMfaSecret('');
    try {
      const result = await api.bootstrapMfa({ email, password, captchaToken });
      setMfaSecret(result.secret);
    } catch (err) {
      setError(err.message);
    } finally {
      resetCaptcha();
      setBusy(false);
    }
  }

  async function enableMfa() {
    if (captchaMissing) {
      setError('Completa la verificacion anti-bot nuevamente para habilitar MFA.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.enableBootstrapMfa({ email, password, code: mfaCode, captchaToken });
      setMfaSecret('');
      setError('MFA habilitado. Ingresa de nuevo con tu codigo.');
    } catch (err) {
      setError(err.message);
    } finally {
      resetCaptcha();
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <section className="login-shell">
        <div className="login-copy">
          <div className="login-mark">
            <img src="/assets/izamal-logo.jpg" alt="Ayuntamiento de Izamal" />
            <div>
              <strong>Sistema de control de unidades</strong>
              <span>Ayuntamiento 2025-2027</span>
            </div>
          </div>
          <h1>Sistema de control de unidades</h1>
          <p>Ayuntamiento de Izamal 2025-2027. Acceso por rol para Parque Vehicular, departamentos y talleres. Cada área ve solo la información que le corresponde.</p>
          <div className="login-benefits">
            <span>Roles y permisos</span>
            <span>Bitácora de actividad</span>
            <span>Bloqueo por intentos fallidos</span>
          </div>
          <div className="login-photo" aria-hidden="true" />
        </div>
        <form className="login-panel" onSubmit={submit}>
          <h2>Iniciar sesión</h2>
          <label>Correo<input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" /></label>
          <label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
          <label>Codigo MFA<input value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6 digitos" /></label>
          {captchaEnabled && <div id="captcha-widget" key={captchaResetKey} className="captcha-widget" />}
          {mfaSecret && <p className="success">Secreto MFA: {mfaSecret}. Agregalo a tu app autenticadora, resuelve el captcha otra vez, captura el codigo de 6 digitos y habilitalo.</p>}
          {error && <p className="error">{error}</p>}
          {error.includes('MFA obligatorio') && <button type="button" onClick={setupMfa} disabled={busy || captchaMissing}>Generar secreto MFA</button>}
          {mfaSecret && <button type="button" onClick={enableMfa} disabled={busy || captchaMissing || mfaCode.length !== 6}>Habilitar MFA</button>}
          <button className="primary" disabled={busy || captchaMissing}>{busy ? <Loader2 className="spin" /> : <ShieldCheck />} Entrar</button>
        </form>
      </section>
    </main>
  );
}

function Stat({ icon: Icon, label, value, tone }) {
  return <article className={`stat ${tone || ''}`}><Icon /><span>{label}</span><strong>{value ?? 0}</strong></article>;
}

function Empty({ text }) {
  return <div className="empty">{text}</div>;
}

function ReportFlow({ status }) {
  const activeIndex = Math.max(0, reportFlowSteps.findIndex(([id]) => id === status));

  return (
    <div className="report-flow">
      <h3>Detalle del proceso</h3>
      <div className="progress-steps compact">
        {reportFlowSteps.map(([id, title, text], index) => {
          const active = index === activeIndex;
          const complete = index < activeIndex;
          return (
            <div className={`progress-step ${active ? 'active' : ''} ${complete ? 'complete' : ''}`} key={id}>
              <span aria-hidden="true" />
              <div>
                <strong>{title}</strong>
                <p>{active ? text : complete ? 'Completado' : 'Pendiente'}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder = 'Buscar' }) {
  return <label className="search"><Search size={18} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

function Dashboard({ data, user }) {
  const incidenciasTitle = user?.role === 'admin' ? 'Incidencias por departamento' : 'Incidencias vigentes del departamento';

  return (
    <>
      <div className="stats">
        <Stat icon={Car} label="Total vehículos" value={data.totalVehiculos ?? data.totalVehículos} />
        <Stat icon={ShieldCheck} label="Disponibles" value={data.disponibles} tone="ok" />
        <Stat icon={AlertTriangle} label="Con fallas" value={data.conFallas} tone="bad" />
        <Stat icon={Wrench} label="En taller" value={data.enTaller} tone="shop" />
        <Stat icon={ClipboardCheck} label="Checklists faltantes" value={data.checklistsFaltantes} tone="warn" />
        <Stat icon={AlertTriangle} label="Urgentes" value={data.reportesUrgentes} tone="bad" />
      </div>
      <section className="panel">
        <h2>{incidenciasTitle}</h2>
        <div className="bars">
          {(data.incidenciasPorDepartamento || []).map((row) => (
            <div key={row.nombre}><span>{labelDepartment(row.nombre)}</span><b className={row.total ? '' : 'empty-bar'} style={{ width: row.total ? `${Math.max(10, row.total * 24)}px` : '100%' }} /><strong>{row.total}</strong></div>
          ))}
        </div>
      </section>
    </>
  );
}

function Vehicles({ data, departments, role, refresh }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('Todos');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [vehicleError, setVehicleError] = useState('');
  const blankVehicle = { numero_economico: '', department_id: departments[0]?.id || '', tipo: '', marca: '', modelo: '', anio: 2026, placas: '', numero_serie: '', kilometraje: 0, estatus: 'Disponible', observaciones: '' };
  const [form, setForm] = useState(blankVehicle);

  useEffect(() => {
    if (!form.department_id && departments[0]?.id) setForm((current) => ({ ...current, department_id: departments[0].id }));
  }, [departments, form.department_id]);

  const vehicles = useMemo(() => data.filter((vehicle) => {
    const text = `${vehicle.numero_economico} ${vehicle.departamento} ${vehicle.tipo} ${vehicle.marca} ${vehicle.modelo} ${vehicle.placas}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (status === 'Todos' || vehicle.estatus === status);
  }), [data, query, status]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setVehicleError('');
    try {
      if (editingId) await api.editarVehiculo(editingId, form);
      else await api.crearVehiculo(form);
      setOpen(false);
      setEditingId(null);
      setForm({ ...blankVehicle, department_id: departments[0]?.id || '' });
      await refresh('vehiculos', true);
      await refresh('checklist', true);
      await refresh('dashboard', true);
    } catch (err) {
      setVehicleError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function openCreate() {
    setEditingId(null);
    setVehicleError('');
    setForm({ ...blankVehicle, department_id: departments[0]?.id || '' });
    setOpen(true);
  }

  function openEdit(vehicle) {
    setEditingId(vehicle.id);
    setVehicleError('');
    setForm({
      numero_economico: vehicle.numero_economico,
      department_id: vehicle.department_id,
      tipo: vehicle.tipo,
      marca: vehicle.marca,
      modelo: vehicle.modelo,
      anio: vehicle.anio,
      placas: vehicle.placas,
      numero_serie: vehicle.numero_serie,
      kilometraje: vehicle.kilometraje,
      estatus: vehicle.estatus,
      observaciones: vehicle.observaciones || ''
    });
    setOpen(true);
  }

  async function removeVehicle(vehicle) {
    const ok = window.confirm(`¿Eliminar vehículo ${vehicle.numero_economico}? Esta acción no se puede deshacer.`);
    if (!ok) return;
    setVehicleError('');
    try {
      await api.eliminarVehiculo(vehicle.id);
      await refresh('vehiculos', true);
      await refresh('checklist', true);
      await refresh('dashboard', true);
    } catch (err) {
      setVehicleError(err.message);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div><h2>Inventario vehicular</h2><p>{vehicles.length} unidades visibles</p></div>
        {['admin', 'departamento'].includes(role) && <button className="primary" onClick={openCreate}><Plus size={18} /> Agregar vehículo</button>}
      </div>
      {vehicleError && <p className="error">{vehicleError}</p>}
      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Buscar por unidad, placas o departamento" />
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {['Todos', 'Disponible', 'En uso', 'Con falla reportada', 'En revision', 'En taller', 'Fuera de servicio'].map((item) => <option key={item} value={item}>{labelStatus(item)}</option>)}
        </select>
      </div>
      {open && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal wide">
            <div className="panel-head">
              <div>
                <h2>{editingId ? 'Editar vehículo' : 'Agregar vehículo'}</h2>
                <p>{editingId ? 'Actualiza la información de la unidad.' : 'Registra una nueva unidad y asígnala a su departamento.'}</p>
              </div>
              <button onClick={() => { setOpen(false); setEditingId(null); }}>Cerrar</button>
            </div>
            {vehicleError && <p className="error">{vehicleError}</p>}
            <form className="grid-form" onSubmit={save}>
              <label>Número económico<input placeholder="Ej. PM-021" value={form.numero_economico} onChange={(event) => setForm({ ...form, numero_economico: event.target.value })} required /></label>
              <label>Departamento<select value={form.department_id} disabled={role !== 'admin'} onChange={(event) => setForm({ ...form, department_id: event.target.value })}>{departments.map((department) => <option key={department.id} value={department.id}>{labelDepartment(department.nombre)}</option>)}</select></label>
              <label>Tipo<input placeholder="Patrulla, camioneta, pipa..." value={form.tipo} onChange={(event) => setForm({ ...form, tipo: event.target.value })} required /></label>
              <label>Marca<input placeholder="Marca" value={form.marca} onChange={(event) => setForm({ ...form, marca: event.target.value })} required /></label>
              <label>Modelo<input placeholder="Modelo" value={form.modelo} onChange={(event) => setForm({ ...form, modelo: event.target.value })} required /></label>
              <label>Año<input type="number" value={form.anio} onChange={(event) => setForm({ ...form, anio: event.target.value })} /></label>
              <label>Placas<input placeholder="Placas" value={form.placas} onChange={(event) => setForm({ ...form, placas: event.target.value })} required /></label>
              <label>Número de serie<input placeholder="Serie/VIN" value={form.numero_serie} onChange={(event) => setForm({ ...form, numero_serie: event.target.value })} required /></label>
              <label>Kilometraje<input type="number" value={form.kilometraje} onChange={(event) => setForm({ ...form, kilometraje: event.target.value })} /></label>
              <label>Estatus<select value={form.estatus} onChange={(event) => setForm({ ...form, estatus: event.target.value })}>{['Disponible', 'En uso', 'Con falla reportada', 'En revision', 'En taller', 'Fuera de servicio'].map((item) => <option key={item} value={item}>{labelStatus(item)}</option>)}</select></label>
              <label className="full-field">Observaciones<textarea value={form.observaciones} onChange={(event) => setForm({ ...form, observaciones: event.target.value })} placeholder="Observaciones generales de la unidad" /></label>
              <div className="modal-actions full-field">
                <button type="button" onClick={() => { setOpen(false); setEditingId(null); }}>Cancelar</button>
                <button className="primary" disabled={saving}>{saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Guardar vehículo'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
      <div className="data-list">
        {vehicles.map((vehicle) => (
          <article className="vehicle-row" key={vehicle.id}>
            <strong>{vehicle.numero_economico}</strong>
            <span>{labelDepartment(vehicle.departamento)}</span>
            <span>{vehicle.tipo} {vehicle.marca} {vehicle.modelo} {vehicle.anio}</span>
            <span>{vehicle.placas}</span>
            <span>{Number(vehicle.kilometraje).toLocaleString('es-MX')} km</span>
            <em className={statusClass(vehicle.estatus)}>{labelStatus(vehicle.estatus)}</em>
            {['admin', 'departamento'].includes(role) && <button onClick={() => openEdit(vehicle)}>Editar</button>}
            {['admin', 'departamento'].includes(role) && <button className="danger" onClick={() => removeVehicle(vehicle)}>Eliminar</button>}
          </article>
        ))}
        {!vehicles.length && <Empty text="No hay vehículos con esos filtros." />}
      </div>
    </section>
  );
}

function ReportEvidenceList({ detail, loading, onDownload }) {
  const files = detail?.evidencias || [];

  return (
    <div className="evidence-panel">
      <div className="evidence-panel-head">
        <strong>Archivos del reporte</strong>
        {!loading && <span>{files.length} archivo{files.length === 1 ? '' : 's'}</span>}
      </div>
      {loading && <p>Cargando archivos...</p>}
      {!loading && !files.length && <p>No hay evidencia o cotización subida.</p>}
      {!loading && files.length > 0 && (
        <div className="evidence-files">
          {files.map((file) => {
            const meta = [file.mime_type, formatFileSize(file.size_bytes)].filter(Boolean).join(' | ');
            return (
              <div key={file.id}>
                <span>
                  <strong>{file.es_cotizacion ? 'Cotización' : 'Evidencia'}</strong>
                  {file.file_name}
                  {meta && <small>{meta}</small>}
                </span>
                <button type="button" onClick={() => onDownload(file)}><FileDown size={16} /> Descargar</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Reports({ vehicles, reports, workshops, refresh, role }) {
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [progressStep, setProgressStep] = useState(null);
  const [evidenceFiles, setEvidenceFiles] = useState([]);
  const [assigning, setAssigning] = useState(null);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentError, setAssignmentError] = useState('');
  const [reportDetails, setReportDetails] = useState({});
  const [detailLoadingId, setDetailLoadingId] = useState(null);
  const [editingReport, setEditingReport] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const failureOptions = ['Mecanica', 'Electrica', 'Llantas', 'Frenos', 'Motor', 'Carroceria', 'Documentacion', 'Otro'];
  const urgencyOptions = ['Baja', 'Media', 'Alta', 'Critica'];
  const [assignmentForm, setAssignmentForm] = useState({
    taller_nombre: '',
    fecha_ingreso: localDateInput(),
    fecha_estimada_entrega: '',
    cotizacion_total: '',
    observaciones: ''
  });
  const [editForm, setEditForm] = useState({
    vehiculo_id: vehicles[0]?.id || '',
    tipo_falla: 'Mecanica',
    urgencia: 'Baja',
    descripcion: ''
  });
  const visible = useMemo(() => reports.filter((report) => `${report.numero_economico} ${report.tipo_falla} ${report.descripcion || ''} ${report.urgencia} ${labelStatus(report.flujo_estatus)}`.toLowerCase().includes(query.toLowerCase())), [reports, query]);

  useEffect(() => {
    if (!editForm.vehiculo_id && vehicles[0]?.id) setEditForm((current) => ({ ...current, vehiculo_id: vehicles[0].id }));
  }, [vehicles, editForm.vehiculo_id]);

  async function submit(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const payload = Object.fromEntries(data.entries());
    setSaving(true);
    setError('');
    setProgressStep('preparing');
    try {
      await new Promise((resolve) => setTimeout(resolve, 180));
      setProgressStep('saving');
      const report = await api.crearReporteJson(payload);
      for (const file of evidenceFiles) {
        await api.subirEvidenciaReporte(report.id, file);
      }
      formElement.reset();
      setEvidenceFiles([]);
      setProgressStep('syncing');
      await refresh('reportes', true);
      await refresh('vehiculos', true);
      await refresh('dashboard', true);
      setProgressStep('done');
      setTimeout(() => setProgressStep(null), 1800);
    } catch (err) {
      setProgressStep('error');
      setError(err.message);
      setTimeout(() => setProgressStep(null), 2800);
    } finally {
      setSaving(false);
    }
  }

  async function validateFiles(event) {
    const incoming = Array.from(event.target.files || []);
    event.target.value = '';
    const result = await prepareEvidenceFiles(incoming, evidenceFiles);
    setEvidenceFiles(result.files);
    setError(result.message || '');
  }

  function removeEvidence(index) {
    setEvidenceFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setError('');
  }

  async function advance(report) {
    const next = nextFlow[report.flujo_estatus] || 'Caso cerrado';
    const form = new FormData();
    form.append('flujo_estatus', next);
    form.append('comentario', `Avance a ${next}`);
    await api.seguimiento(report.id, form);
    await refresh('reportes', true);
    await refresh('reparaciones', true);
    await refresh('vehiculos', true);
    await refresh('dashboard', true);
  }

  function openAssignment(report) {
    setAssigning(report);
    setAssignmentError('');
    setAssignmentForm({
      taller_nombre: report.taller_asignado || '',
      fecha_ingreso: localDateInput(),
      fecha_estimada_entrega: '',
      cotizacion_total: '',
      observaciones: ''
    });
  }

  async function saveAssignment(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.append('reporte_id', assigning.id);
    setAssignmentSaving(true);
    setAssignmentError('');
    try {
      await api.asignarTallerCotizacion(data);
      setAssigning(null);
      await refresh('reportes', true);
      await refresh('reparaciones', true);
      await refresh('vehiculos', true);
      await refresh('dashboard', true);
      await refresh('presupuesto', true);
    } catch (err) {
      setAssignmentError(err.message);
    } finally {
      setAssignmentSaving(false);
    }
  }

  async function toggleReportFiles(report) {
    const current = reportDetails[report.id];
    if (current) {
      setReportDetails((details) => ({ ...details, [report.id]: { ...current, open: !current.open } }));
      return;
    }

    setDetailLoadingId(report.id);
    setError('');
    try {
      const detail = await api.detalleReporte(report.id);
      setReportDetails((details) => ({ ...details, [report.id]: { ...detail, open: true } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoadingId(null);
    }
  }

  async function downloadReportEvidence(report, evidence) {
    setError('');
    try {
      await api.descargarEvidenciaReporte(report.id, evidence);
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteReport(report) {
    const ok = window.confirm(`Eliminar la solicitud #${report.id} de ${report.numero_economico}? Esta acción también elimina sus evidencias.`);
    if (!ok) return;
    setError('');
    try {
      await api.eliminarReporte(report.id);
      await refresh('reportes', true);
      await refresh('vehiculos', true);
      await refresh('dashboard', true);
      await refresh('presupuesto', true);
    } catch (err) {
      setError(err.message);
    }
  }

  function openEditReport(report) {
    setEditingReport(report);
    setEditError('');
    setEditForm({
      vehiculo_id: report.vehiculo_id,
      tipo_falla: report.tipo_falla,
      urgencia: report.urgencia,
      descripcion: report.descripcion || ''
    });
  }

  async function saveReportEdit(event) {
    event.preventDefault();
    if (!editingReport) return;
    setEditSaving(true);
    setEditError('');
    try {
      await api.editarReporte(editingReport.id, editForm);
      setReportDetails((details) => {
        const next = { ...details };
        delete next[editingReport.id];
        return next;
      });
      setEditingReport(null);
      await refresh('reportes', true);
      await refresh('reparaciones', true);
      await refresh('vehiculos', true);
      await refresh('dashboard', true);
      await refresh('presupuesto', true);
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="work-grid">
      <section className="panel">
        <h2>Nuevo reporte de falla</h2>
        {error && <p className="error">{error}</p>}
        <form className="stack-form" onSubmit={submit}>
          <select name="vehiculo_id" required>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.numero_economico} - {vehicle.tipo}</option>)}</select>
          <div className="two-col">
            <select name="tipo_falla">{failureOptions.map((item) => <option key={item} value={item}>{labelFailure(item)}</option>)}</select>
            <select name="urgencia">{urgencyOptions.map((item) => <option key={item} value={item}>{labelUrgency(item)}</option>)}</select>
          </div>
          <textarea name="descripcion" placeholder="Descripción clara del problema" required minLength={10} />
          <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,application/pdf" onChange={validateFiles} />
          <p className="hint">Puedes agregar archivos uno por uno. Máximo 5 evidencias, 100 MB por archivo y 250 MB por envío.</p>
          {evidenceFiles.length > 0 && (
            <div className="file-list">
              {evidenceFiles.map((file, index) => (
                <span key={`${file.name}-${file.size}-${file.lastModified}`}>
                  {file.name}
                  <button type="button" onClick={() => removeEvidence(index)}>Quitar</button>
                </span>
              ))}
            </div>
          )}
          <button className="primary" disabled={saving}>{saving ? 'Enviando...' : 'Enviar reporte'}</button>
          {progressStep && <ReportProgress step={progressStep} />}
        </form>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Seguimiento de reportes</h2><p>{visible.length} casos</p></div></div>
        <SearchBox value={query} onChange={setQuery} placeholder="Buscar reportes" />
        <div className="report-list">
          {visible.map((report) => {
            const detail = reportDetails[report.id];
            const loadingFiles = detailLoadingId === report.id;
            return (
              <article className="report-card" key={report.id}>
                <div><strong>#{report.id} {report.numero_economico}</strong><span>{labelDepartment(report.departamento)}</span></div>
                <p className="failure-summary"><strong>{labelFailure(report.tipo_falla)}</strong><span>{report.descripcion || 'Sin descripción registrada'}</span></p>
                <em className={report.urgencia === 'Critica' ? 'bad' : 'warn'}>{labelUrgency(report.urgencia)}</em>
                <small>{labelStatus(report.flujo_estatus)}{report.asignacion_id ? ` | ${report.taller_asignado || 'Sin taller asignado'} | ${money(report.cotizacion_total)}` : ''}</small>
                {role === 'admin' && <button onClick={() => openEditReport(report)}>Editar</button>}
                {role === 'admin' && <button onClick={() => toggleReportFiles(report)} disabled={loadingFiles}>{loadingFiles ? 'Cargando...' : detail?.open ? 'Ocultar archivos' : 'Ver archivos'}</button>}
                {role === 'admin' && !report.asignacion_id && report.flujo_estatus !== 'Caso cerrado' && <button onClick={() => openAssignment(report)}>Registrar cotización</button>}
                {['admin', 'taller'].includes(role) && report.flujo_estatus !== 'Caso cerrado' && <button onClick={() => advance(report)}>Siguiente etapa</button>}
                {role === 'admin' && <button className="danger" onClick={() => deleteReport(report)}>Eliminar</button>}
                {role === 'admin' && (detail?.open || loadingFiles) && (
                  <ReportEvidenceList
                    detail={detail}
                    loading={loadingFiles}
                    onDownload={(evidence) => downloadReportEvidence(report, evidence)}
                  />
                )}
                <ReportFlow status={report.flujo_estatus} />
              </article>
            );
          })}
          {!visible.length && <Empty text="No hay reportes para mostrar." />}
        </div>
      </section>
      {assigning && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal">
            <div className="panel-head">
              <div>
                <h2>Registrar cotización</h2>
                <p>Sube la cotización y registra el total para descontarlo del presupuesto.</p>
              </div>
              <button onClick={() => setAssigning(null)}>Cerrar</button>
            </div>
            {assignmentError && <p className="error">{assignmentError}</p>}
            <form className="stack-form" onSubmit={saveAssignment}>
              <label>Reporte<input value={`#${assigning.id} ${assigning.numero_economico}`} disabled /></label>
              <label>Taller opcional<input name="taller_nombre" value={assignmentForm.taller_nombre} onChange={(event) => setAssignmentForm({ ...assignmentForm, taller_nombre: event.target.value })} placeholder="Nombre del taller o proveedor" /></label>
              <div className="two-col">
                <label>Fecha de ingreso<input type="date" name="fecha_ingreso" value={assignmentForm.fecha_ingreso} onChange={(event) => setAssignmentForm({ ...assignmentForm, fecha_ingreso: event.target.value })} required /></label>
                <label>Entrega estimada<input type="date" name="fecha_estimada_entrega" value={assignmentForm.fecha_estimada_entrega} onChange={(event) => setAssignmentForm({ ...assignmentForm, fecha_estimada_entrega: event.target.value })} /></label>
              </div>
              <label>Total de cotización<input type="number" name="cotizacion_total" min="1" step="0.01" value={assignmentForm.cotizacion_total} onChange={(event) => setAssignmentForm({ ...assignmentForm, cotizacion_total: event.target.value })} placeholder="Ej. 12500" required /></label>
              <label>Archivo de cotización<input type="file" name="cotizacion" accept="image/jpeg,image/png,image/webp,application/pdf" required /></label>
              <label>Observaciones<textarea name="observaciones" value={assignmentForm.observaciones} onChange={(event) => setAssignmentForm({ ...assignmentForm, observaciones: event.target.value })} placeholder="Notas sobre la cotización o la atención" /></label>
              <div className="modal-actions">
                <button type="button" onClick={() => setAssigning(null)}>Cancelar</button>
                <button className="primary" disabled={assignmentSaving}>{assignmentSaving ? 'Guardando...' : 'Registrar y descontar presupuesto'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
      {editingReport && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal wide">
            <div className="panel-head">
              <div>
                <h2>Editar reporte de falla</h2>
                <p>Actualiza la unidad, el tipo de falla, la urgencia o la descripción.</p>
              </div>
              <button type="button" onClick={() => setEditingReport(null)}>Cerrar</button>
            </div>
            {editError && <p className="error">{editError}</p>}
            <form className="grid-form" onSubmit={saveReportEdit}>
              <label>Vehículo<select value={editForm.vehiculo_id} onChange={(event) => setEditForm({ ...editForm, vehiculo_id: event.target.value })} required>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.numero_economico} - {vehicle.tipo}</option>)}</select></label>
              <label>Tipo de falla<select value={editForm.tipo_falla} onChange={(event) => setEditForm({ ...editForm, tipo_falla: event.target.value })}>{failureOptions.map((item) => <option key={item} value={item}>{labelFailure(item)}</option>)}</select></label>
              <label>Urgencia<select value={editForm.urgencia} onChange={(event) => setEditForm({ ...editForm, urgencia: event.target.value })}>{urgencyOptions.map((item) => <option key={item} value={item}>{labelUrgency(item)}</option>)}</select></label>
              <label className="full-field">Descripción<textarea value={editForm.descripcion} onChange={(event) => setEditForm({ ...editForm, descripcion: event.target.value })} minLength={10} required /></label>
              <div className="modal-actions full-field">
                <button type="button" onClick={() => setEditingReport(null)}>Cancelar</button>
                <button className="primary" disabled={editSaving}>{editSaving ? 'Guardando...' : 'Guardar cambios'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function Repairs({ vehicles, repairs, refresh, role }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const blank = {
    vehiculo_id: vehicles[0]?.id || '',
    taller_nombre: '',
    taller_direccion: '',
    descripcion: '',
    fecha_ingreso: localDateInput(),
    fecha_estimada_entrega: '',
    estatus: 'En reparacion',
    cotizacion_total: '',
    observaciones: ''
  };
  const [form, setForm] = useState(blank);

  useEffect(() => {
    if (!form.vehiculo_id && vehicles[0]?.id) setForm((current) => ({ ...current, vehiculo_id: vehicles[0].id }));
  }, [vehicles, form.vehiculo_id]);

  function startCreate() {
    setEditing(null);
    setError('');
    setForm({ ...blank, vehiculo_id: vehicles[0]?.id || '' });
    setOpen(true);
  }

  function startEdit(item) {
    setEditing(item);
    setError('');
    setForm({
      vehiculo_id: item.vehiculo_id,
      taller_nombre: item.taller_nombre,
      taller_direccion: item.taller_direccion || '',
      descripcion: item.descripcion,
      fecha_ingreso: item.fecha_ingreso,
      fecha_estimada_entrega: item.fecha_estimada_entrega || '',
      estatus: item.estatus,
      cotizacion_total: item.cotizacion_total || '',
      observaciones: item.observaciones || ''
    });
    setOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const data = new FormData();
      Object.entries(form).forEach(([key, value]) => data.append(key, value ?? ''));
      const file = event.currentTarget.elements.cotizacion?.files?.[0];
      if (file) data.append('cotizacion', file);
      if (editing) await api.editarReparacion(editing.id, data);
      else await api.crearReparacion(data);
      setOpen(false);
      setEditing(null);
      await refresh('reparaciones', true);
      await refresh('vehiculos', true);
      await refresh('dashboard', true);
      await refresh('presupuesto', true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function downloadRepairQuote(item) {
    setError('');
    try {
      await api.descargarCotizacionReparacion(item.id, item.cotizacion_file_name);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Vehículos en reparación</h2>
          <p>Consulta dónde están, qué se repara y cuánto tiempo llevan.</p>
        </div>
        {['admin', 'departamento'].includes(role) && <button className="primary" onClick={startCreate}><Plus size={18} /> Registrar reparación</button>}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="repair-list">
        {repairs.map((item) => (
          <article className="repair-card" key={item.id}>
            <div>
              <strong>{item.numero_economico}</strong>
              <span>{item.tipo} {item.marca} {item.modelo} | {labelDepartment(item.departamento)}</span>
            </div>
            <div>
              <strong>{item.descripcion}</strong>
              <span>{item.taller_nombre} {item.taller_direccion ? `| ${item.taller_direccion}` : ''}</span>
            </div>
            <div>
              <strong>{item.dias_en_taller || 0} días</strong>
              <span>Ingreso: {item.fecha_ingreso}</span>
            </div>
            <em className={item.estatus === 'Entregado' ? 'ok' : 'shop'}>{labelStatus(item.estatus)}</em>
            {['admin', 'departamento'].includes(role) && <button onClick={() => startEdit(item)}>Actualizar</button>}
            {role === 'admin' && item.cotizacion_stored_name && <button type="button" onClick={() => downloadRepairQuote(item)}><FileDown size={16} /> Cotización</button>}
            {item.fecha_estimada_entrega && <p>Entrega estimada: {item.fecha_estimada_entrega}</p>}
            {Number(item.cotizacion_total || 0) > 0 && <p>Cotización: {money(item.cotizacion_total)}</p>}
            {item.observaciones && <p>{item.observaciones}</p>}
          </article>
        ))}
        {!repairs.length && <Empty text="No hay reparaciones registradas." />}
      </div>
      {open && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal wide">
            <div className="panel-head">
              <div>
                <h2>{editing ? 'Actualizar reparación' : 'Registrar reparación'}</h2>
                <p>Indica qué se está reparando, cuándo ingresó y dónde está la unidad.</p>
              </div>
              <button onClick={() => setOpen(false)}>Cerrar</button>
            </div>
            <form className="grid-form" onSubmit={save}>
              <label>Vehículo<select value={form.vehiculo_id} disabled={Boolean(editing)} onChange={(event) => setForm({ ...form, vehiculo_id: event.target.value })}>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.numero_economico} - {vehicle.tipo}</option>)}</select></label>
              <label>Taller o lugar<input value={form.taller_nombre} onChange={(event) => setForm({ ...form, taller_nombre: event.target.value })} placeholder="Nombre del taller o área" required /></label>
              <label>Dirección / ubicación<input value={form.taller_direccion} onChange={(event) => setForm({ ...form, taller_direccion: event.target.value })} placeholder="Dónde lo llevaron" /></label>
              <label>Fecha de ingreso<input type="date" value={form.fecha_ingreso} onChange={(event) => setForm({ ...form, fecha_ingreso: event.target.value })} required /></label>
              <label>Entrega estimada<input type="date" value={form.fecha_estimada_entrega} onChange={(event) => setForm({ ...form, fecha_estimada_entrega: event.target.value })} /></label>
              <label>Estatus<select value={form.estatus} onChange={(event) => setForm({ ...form, estatus: event.target.value })}>{['En reparacion', 'En diagnostico', 'Esperando refacciones', 'Reparacion terminada', 'Entregado'].map((item) => <option key={item} value={item}>{labelStatus(item)}</option>)}</select></label>
              <label>Total de cotización<input type="number" min="0" step="0.01" value={form.cotizacion_total} onChange={(event) => setForm({ ...form, cotizacion_total: event.target.value })} placeholder="Ej. 12500" /></label>
              <label>Archivo de cotización<input type="file" name="cotizacion" accept="image/jpeg,image/png,image/webp,application/pdf" /></label>
              <label className="full-field">Qué se está reparando<textarea value={form.descripcion} onChange={(event) => setForm({ ...form, descripcion: event.target.value })} placeholder="Ej. Cambio de clutch, frenos, suspensión, diagnóstico eléctrico..." required /></label>
              <label className="full-field">Observaciones<textarea value={form.observaciones} onChange={(event) => setForm({ ...form, observaciones: event.target.value })} placeholder="Notas adicionales" /></label>
              <div className="modal-actions full-field">
                <button type="button" onClick={() => setOpen(false)}>Cancelar</button>
                <button className="primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar reparación'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

const checklistItems = [
  ['nivel_combustible', 'Combustible', '⛽'],
  ['nivel_aceite', 'Nivel de aceite', '◍'],
  ['anticongelante', 'Anticongelante', '❄'],
  ['liquido_frenos', 'Líquido de freno', '◒'],
  ['llantas', 'Llantas', '◉'],
  ['luces', 'Luces', '✦'],
  ['frenos', 'Frenos', '⚠'],
  ['motor', 'Motor', '⚙'],
  ['carroceria', 'Carrocería', '▣'],
  ['documentos_vigentes', 'Documentos vigentes', '◈'],
  ['limpieza', 'Limpieza', '✧']
];

function StatusChoice({ name, label, icon, value, onChange }) {
  return (
    <div className="check-item">
      <span><i aria-hidden="true">{icon}</i>{label}</span>
      <input type="hidden" name={name} value={value} />
      <div className="segmented">
        {['Correcto', 'Regular', 'Requiere atencion'].map((option) => (
          <button
            key={option}
            type="button"
            className={value === option ? 'selected' : ''}
            onClick={() => onChange(name, option)}
          >
            {option === 'Requiere atencion' ? 'Revisar' : option}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReportProgress({ step }) {
  const steps = [
    ['preparing', 'Preparando reporte', 'Validando la descripción y las evidencias.'],
    ['saving', 'Enviando solicitud', 'Registrando la falla en el sistema.'],
    ['syncing', 'Actualizando seguimiento', 'Notificando el pendiente a Parque Vehicular.'],
    ['done', 'Reporte enviado', 'La solicitud quedó registrada correctamente.']
  ];
  const activeIndex = step === 'error' ? 1 : Math.max(0, steps.findIndex(([id]) => id === step));

  return (
    <div className="progress-card" role="status" aria-live="polite">
      <h3>Detalle del reporte</h3>
      <div className="progress-steps">
        {steps.map(([id, title, text], index) => {
          const active = index === activeIndex;
          const complete = step !== 'error' && index < activeIndex;
          return (
            <div className={`progress-step ${active ? 'active' : ''} ${complete ? 'complete' : ''}`} key={id}>
              <span aria-hidden="true" />
              <div>
                <strong>{step === 'error' && active ? 'No se pudo guardar' : title}</strong>
                <p>{step === 'error' && active ? 'Revisa el mensaje de error e intenta nuevamente.' : text}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Checklist({ vehicles, alerts, refresh }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState([]);
  const [values, setValues] = useState(() => Object.fromEntries(checklistItems.map(([name]) => [name, 'Correcto'])));

  function updateValue(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    setSaving(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    try {
      const checklist = await api.crearChecklist(payload);
      for (const file of evidenceFiles) {
        await api.subirEvidenciaChecklist(checklist.id, file);
      }
      form.reset();
      setEvidenceFiles([]);
      setValues(Object.fromEntries(checklistItems.map(([name]) => [name, 'Correcto'])));
      await refresh('dashboard', true);
      await refresh('checklist', true);
      await refresh('vehiculos', true);
      setMessage('Checklist guardado correctamente.');
    } catch (error) {
      setMessage(error.message || 'No se pudo guardar el checklist. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  async function addEvidence(event) {
    const incoming = Array.from(event.target.files || []);
    event.target.value = '';
    const result = await prepareEvidenceFiles(incoming, evidenceFiles);
    setEvidenceFiles(result.files);
    setMessage(result.message || '');
  }

  function removeEvidence(index) {
    setEvidenceFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className="work-grid checklist-layout">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Revisión rápida</h2>
            <p>Marca solo lo que requiera atención; lo demás queda como correcto.</p>
          </div>
        </div>
        <form className="stack-form" onSubmit={submit}>
          {message && <div className={message.includes('correctamente') ? 'success' : 'error'}>{message}</div>}
          <div className="two-col">
            <label>Vehículo<select name="vehiculo_id">{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.numero_economico} - {vehicle.tipo}</option>)}</select></label>
            <label>Fecha<input type="date" name="fecha" defaultValue={localDateInput()} required /></label>
          </div>
          <div className="two-col">
            <label>Kilometraje actual<input type="number" name="kilometraje_actual" placeholder="Ej. 42100" required /></label>
            <label>Responsable<input name="responsable" placeholder="Nombre de quien revisa" required /></label>
          </div>
          <div className="check-grid">
            {checklistItems.map(([name, label, icon]) => <StatusChoice key={name} name={name} label={label} icon={icon} value={values[name]} onChange={updateValue} />)}
          </div>
          <label>Fotos o evidencias de daño<input type="file" name="evidencias" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={addEvidence} /></label>
          <p className="hint">Opcional. Agrega fotos una por una si hay daño visible. Máximo 5 archivos, 100 MB por archivo y 250 MB por envío.</p>
          {evidenceFiles.length > 0 && (
            <div className="file-list">
              {evidenceFiles.map((file, index) => (
                <span key={`${file.name}-${file.size}-${file.lastModified}`}>
                  {file.name}
                  <button type="button" onClick={() => removeEvidence(index)}>Quitar</button>
                </span>
              ))}
            </div>
          )}
          <label>Observaciones<textarea name="observaciones" placeholder="Solo si hay algo importante que reportar" /></label>
          <button className="primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar checklist'}</button>
        </form>
      </section>
      <section className="panel">
        <h2>Alertas de hoy</h2>
        <div className="alert-list">
          <strong>Checklists faltantes</strong>
          {(alerts?.faltantes || []).slice(0, 8).map((item) => <p key={item.id}>{item.numero_economico} · {labelDepartment(item.departamento)}</p>)}
          {!alerts?.faltantes?.length && <p className="ok-text">Todos los vehículos visibles tienen checklist.</p>}
          <strong>Problemas frecuentes</strong>
          {(alerts?.problemasFrecuentes || []).map((item) => <p key={item.id}>{item.numero_economico} · {item.reportes_30_dias} reportes recientes</p>)}
          {!alerts?.problemasFrecuentes?.length && <p className="ok-text">Sin reincidencias recientes.</p>}
        </div>
      </section>
    </div>
  );
}

function Users({ users, departments, refresh }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ nombre: '', email: '', password: '', role: 'departamento', department_id: departments[0]?.id || '', activo: 1 });

  async function save(event) {
    event.preventDefault();
    await api.crearUsuario(form);
    setOpen(false);
    setForm({ nombre: '', email: '', password: '', role: 'departamento', department_id: departments[0]?.id || '', activo: 1 });
    await refresh('usuarios', true);
  }

  async function toggle(user) {
    await api.cambiarUsuario(user.id, user.activo ? 0 : 1);
    await refresh('usuarios', true);
    if (selected?.id === user.id) setSelected({ ...selected, activo: user.activo ? 0 : 1 });
  }

  async function changePassword(event) {
    event.preventDefault();
    setMessage('');
    try {
      await api.cambiarPassword(selected.id, newPassword);
      setNewPassword('');
      setMessage('Contraseña actualizada correctamente.');
      await refresh('usuarios', true);
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head"><div><h2>Sistema de logins</h2><p>Usuarios, roles y acceso por departamento</p></div><button onClick={() => setOpen(!open)}><Plus size={18} /> Nuevo usuario</button></div>
      {open && (
        <form className="grid-form raised" onSubmit={save}>
          <input placeholder="Nombre" value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} required />
          <input type="email" placeholder="Correo" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          <input type="password" placeholder="Contraseña temporal" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="admin">Administrador</option><option value="departamento">Departamento</option><option value="taller">Taller</option></select>
          {form.role !== 'taller' && <select value={form.department_id} onChange={(event) => setForm({ ...form, department_id: event.target.value })}>{departments.map((department) => <option key={department.id} value={department.id}>{labelDepartment(department.nombre)}</option>)}</select>}
          <button className="primary">Crear login</button>
        </form>
      )}
      <div className="data-list">
        {users.map((user) => (
          <article className="user-row" key={user.id}>
            <strong>{labelName(user.nombre)}</strong>
            <span>{user.email}</span>
            <span>{user.role}</span>
            <span>{labelDepartment(user.departamento) || 'Sin departamento'}</span>
            <em className={user.activo ? 'ok' : 'muted'}>{user.activo ? 'Activo' : 'Inactivo'}</em>
            <button onClick={() => { setSelected(user); setMessage(''); setNewPassword(''); }}><Eye size={18} /> Detalles</button>
            <button onClick={() => toggle(user)}>{user.activo ? 'Desactivar' : 'Activar'}</button>
          </article>
        ))}
      </div>
      {selected && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal">
            <div className="panel-head">
              <div>
                <h2>{labelName(selected.nombre)}</h2>
                <p>{selected.email}</p>
              </div>
              <button onClick={() => setSelected(null)}>Cerrar</button>
            </div>
            <div className="detail-grid">
              <div><span>Rol</span><strong>{selected.role}</strong></div>
              <div><span>Departamento</span><strong>{labelDepartment(selected.departamento) || 'Sin departamento'}</strong></div>
              <div><span>Estatus</span><strong>{selected.activo ? 'Activo' : 'Inactivo'}</strong></div>
              <div><span>Ultimo acceso</span><strong>{selected.ultimo_acceso || 'Sin registro'}</strong></div>
              <div><span>Intentos fallidos</span><strong>{selected.failed_login_attempts || 0}</strong></div>
              <div><span>Contraseña actual</span><strong>Protegida y cifrada</strong></div>
            </div>
            <p className="security-note">Por seguridad, la contraseña actual no se puede ver. Puedes asignar una nueva contraseña temporal y compartirla con el usuario.</p>
            <form className="stack-form" onSubmit={changePassword}>
              <label>Nueva contraseña<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Mínimo 8 caracteres" required minLength={8} /></label>
              {message && <p className="success">{message}</p>}
              <div className="modal-actions">
                <button type="button" onClick={() => toggle(selected)}>{selected.activo ? 'Desactivar usuario' : 'Activar usuario'}</button>
                <button className="primary">Cambiar contraseña</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

function formatDateTime(value) {
  if (!value) return 'Sin registro';
  return new Date(String(value).replace(' ', 'T')).toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function checklistIssues(item) {
  const labels = [
    ['nivel_combustible', 'Combustible'],
    ['nivel_aceite', 'Aceite'],
    ['anticongelante', 'Anticongelante'],
    ['liquido_frenos', 'Líquido de freno'],
    ['llantas', 'Llantas'],
    ['luces', 'Luces'],
    ['frenos', 'Frenos'],
    ['motor', 'Motor'],
    ['carroceria', 'Carrocería'],
    ['documentos_vigentes', 'Documentos'],
    ['limpieza', 'Limpieza']
  ];
  return labels
    .filter(([key]) => item[key] && item[key] !== 'Correcto')
    .map(([, label]) => label);
}

function VehicleHistory({ vehicles, role }) {
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');
  const [reportDetails, setReportDetails] = useState({});
  const [detailLoadingId, setDetailLoadingId] = useState(null);

  useEffect(() => {
    if (!selectedId && vehicles[0]?.id) setSelectedId(String(vehicles[0].id));
  }, [vehicles, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    setLoadingDetail(true);
    setError('');
    setReportDetails({});
    api.historialVehiculo(selectedId)
      .then((value) => { if (active) setDetail(value); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoadingDetail(false); });
    return () => { active = false; };
  }, [selectedId]);

  const vehicle = detail?.vehiculo;
  const checklists = detail?.checklists || [];
  const reports = detail?.reportes || [];
  const statusHistory = detail?.estatus || [];

  async function toggleReportFiles(report) {
    const current = reportDetails[report.id];
    if (current) {
      setReportDetails((details) => ({ ...details, [report.id]: { ...current, open: !current.open } }));
      return;
    }

    setDetailLoadingId(report.id);
    setError('');
    try {
      const reportDetail = await api.detalleReporte(report.id);
      setReportDetails((details) => ({ ...details, [report.id]: { ...reportDetail, open: true } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoadingId(null);
    }
  }

  async function downloadReportEvidence(report, evidence) {
    setError('');
    try {
      await api.descargarEvidenciaReporte(report.id, evidence);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="vehicle-history">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Historial vehicular</h2>
            <p>Selecciona una unidad para consultar su información, checklists, fallas y cambios de estatus.</p>
          </div>
        </div>
        <div className="toolbar">
          <label>Vehículo
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {vehicles.map((item) => <option key={item.id} value={item.id}>{item.numero_economico} - {item.tipo} - {labelDepartment(item.departamento)}</option>)}
            </select>
          </label>
        </div>
        {!vehicles.length && <Empty text="No hay vehículos disponibles para consultar." />}
        {error && <p className="error">{error}</p>}
        {loadingDetail && <div className="loading"><Loader2 className="spin" /> Cargando historial...</div>}
      </section>

      {vehicle && (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>{vehicle.numero_economico} - {vehicle.tipo}</h2>
                <p>{labelDepartment(vehicle.departamento)}</p>
              </div>
              <em className={statusClass(vehicle.estatus)}>{labelStatus(vehicle.estatus)}</em>
            </div>
            <div className="detail-grid vehicle-detail-grid">
              <div><span>Marca</span><strong>{vehicle.marca}</strong></div>
              <div><span>Modelo</span><strong>{vehicle.modelo} {vehicle.anio}</strong></div>
              <div><span>Placas</span><strong>{vehicle.placas}</strong></div>
              <div><span>Número de serie</span><strong>{vehicle.numero_serie}</strong></div>
              <div><span>Kilometraje actual</span><strong>{Number(vehicle.kilometraje).toLocaleString('es-MX')} km</strong></div>
              <div><span>Registrado</span><strong>{formatDateTime(vehicle.created_at)}</strong></div>
              <div className="full-field"><span>Observaciones</span><strong>{vehicle.observaciones || 'Sin observaciones'}</strong></div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Checklists registrados</h2>
                <p>{checklists.length} revisiones encontradas para esta unidad.</p>
              </div>
            </div>
            <div className="timeline">
              {checklists.map((item) => {
                const issues = checklistIssues(item);
                return (
                  <article className="history-row checklist-history-row" key={item.id}>
                    <div><strong>{item.fecha}</strong><span>{formatDateTime(item.created_at)}</span></div>
                    <div><strong>{item.responsable}</strong><span>Registrado por {labelName(item.usuario)}</span></div>
                    <div><strong>{Number(item.kilometraje_actual).toLocaleString('es-MX')} km</strong><span>{issues.length ? `Atención: ${issues.join(', ')}` : 'Todo correcto'}</span></div>
                    <p>
                      Combustible: {item.nivel_combustible} | Aceite: {item.nivel_aceite} | Anticongelante: {item.anticongelante} | Líquido de freno: {item.liquido_frenos} | Llantas: {item.llantas} | Luces: {item.luces} | Frenos: {item.frenos} | Motor: {item.motor} | Carrocería: {item.carroceria} | Documentos: {item.documentos_vigentes} | Limpieza: {item.limpieza}
                      {item.observaciones ? ` | Observaciones: ${item.observaciones}` : ''}
                      {Number(item.evidencias_count || 0) > 0 ? ` | Evidencias: ${item.evidencias_count}` : ''}
                    </p>
                  </article>
                );
              })}
              {!checklists.length && <Empty text="Este vehículo aún no tiene checklists registrados." />}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Fallas y mantenimientos</h2>
                <p>{reports.length} reportes registrados para esta unidad.</p>
              </div>
            </div>
            <div className="timeline">
              {reports.map((item) => {
                const reportDetail = reportDetails[item.id];
                const loadingFiles = detailLoadingId === item.id;
                return (
                  <article className="history-row" key={item.id}>
                    <div><strong>{labelFailure(item.tipo_falla)}</strong><span>{labelUrgency(item.urgencia)}</span></div>
                    <div><strong>{labelStatus(item.flujo_estatus)}</strong><span>{formatDateTime(item.created_at)}</span></div>
                    <div><strong>{labelName(item.usuario)}</strong><span>{item.closed_at ? `Cerrado: ${formatDateTime(item.closed_at)}` : 'Caso vigente'}</span></div>
                    {role === 'admin' && <button type="button" onClick={() => toggleReportFiles(item)} disabled={loadingFiles}>{loadingFiles ? 'Cargando...' : reportDetail?.open ? 'Ocultar archivos' : 'Ver archivos'}</button>}
                    <p>
                      {item.descripcion}
                      {item.asignacion_id ? ` | ${item.taller_asignado || 'Sin taller asignado'} | ${money(item.cotizacion_total)}` : ''}
                      {Number(item.evidencias_count || 0) > 0 ? ` | Archivos: ${item.evidencias_count}` : ''}
                    </p>
                    {role === 'admin' && (reportDetail?.open || loadingFiles) && (
                      <ReportEvidenceList
                        detail={reportDetail}
                        loading={loadingFiles}
                        onDownload={(evidence) => downloadReportEvidence(item, evidence)}
                      />
                    )}
                  </article>
                );
              })}
              {!reports.length && <Empty text="Este vehículo no tiene reportes de falla registrados." />}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Cambios de estatus</h2>
                <p>{statusHistory.length} movimientos de estatus.</p>
              </div>
            </div>
            <div className="timeline">
              {statusHistory.map((item) => (
                <article className="history-row" key={item.id}>
                  <div><strong>{labelStatus(item.estatus_anterior) || 'Inicio'}</strong><span>Estatus anterior</span></div>
                  <div><strong>{labelStatus(item.estatus_nuevo)}</strong><span>Nuevo estatus</span></div>
                  <div><strong>{labelName(item.usuario)}</strong><span>{formatDateTime(item.created_at)}</span></div>
                  {item.comentario && <p>{item.comentario}</p>}
                </article>
              ))}
              {!statusHistory.length && <Empty text="No hay cambios de estatus registrados." />}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function BudgetView({ data, refresh }) {
  const [budgetMonth, setBudgetMonth] = useState(data.month || localMonthInput());
  const [summary, setSummary] = useState({ month: data.month || localMonthInput(), asignado: data.asignado || 80000, gastado: data.gastado || 0, disponible: data.disponible || 80000, porcentajeUsado: data.porcentajeUsado || 0, movimientos: data.movimientos || [] });
  const [amount, setAmount] = useState(summary.asignado || 80000);
  const [archiveMonth, setArchiveMonth] = useState(localMonthInput());
  const [saving, setSaving] = useState(false);
  const [loadingBudget, setLoadingBudget] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const used = Number(summary.porcentajeUsado || 0);
  const disponible = Number(summary.disponible || 0);
  const movimientos = summary.movimientos || [];

  useEffect(() => {
    if (!data.month) return;
    setBudgetMonth(data.month);
    setSummary({ month: data.month, asignado: data.asignado || 80000, gastado: data.gastado || 0, disponible: data.disponible || 0, porcentajeUsado: data.porcentajeUsado || 0, movimientos: data.movimientos || [] });
  }, [data.month, data.asignado, data.gastado, data.disponible, data.porcentajeUsado]);

  useEffect(() => {
    let active = true;
    async function loadBudgetMonth() {
      setLoadingBudget(true);
      setError('');
      try {
        const result = await api.presupuesto(budgetMonth);
        if (!active) return;
        setSummary(result);
        setAmount(result.asignado || 80000);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoadingBudget(false);
      }
    }
    loadBudgetMonth();
    return () => { active = false; };
  }, [budgetMonth]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const result = await api.actualizarPresupuesto(amount, budgetMonth);
      setSummary(result);
      setAmount(result.asignado || 80000);
      await refresh('dashboard', true);
      setMessage(`Presupuesto de ${result.month} actualizado correctamente.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function downloadArchive() {
    setMessage('');
    setError('');
    try {
      await api.descargarRespaldoMensual(archiveMonth);
    } catch (err) {
      setError(err.message);
    }
  }

  async function cleanupArchive() {
    const ok = window.confirm(`Limpiar reportes cerrados y evidencias del mes ${archiveMonth}? Descarga primero el respaldo mensual.`);
    if (!ok) return;
    setMessage('');
    setError('');
    try {
      const result = await api.limpiarRespaldoMensual(archiveMonth);
      setSummary(await api.presupuesto(budgetMonth));
      await refresh('reportes', true);
      await refresh('dashboard', true);
      setMessage(`Limpieza completada: ${result.deletedReports} reportes y ${result.deletedFiles} archivos eliminados.`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="budget-page">
      <section className="panel budget-overview">
        <div>
          <h2>Estado del presupuesto</h2>
          <p>Mes {summary.month}</p>
        </div>
        <div className="budget-chart" style={{ '--used': `${used}%` }}>
          <div>
            <strong>{used}%</strong>
            <span>usado</span>
          </div>
        </div>
        <div className="budget-grid">
          <article><span>Asignado</span><strong>{money(summary.asignado)}</strong></article>
          <article><span>Gastado</span><strong>{money(summary.gastado)}</strong></article>
          <article><span>Disponible</span><strong className={disponible < 0 ? 'negative' : ''}>{money(summary.disponible)}</strong></article>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Asignar presupuesto mensual</h2>
            <p>El monto debe cubrir el gasto registrado del mes.</p>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}
        <form className="budget-form" onSubmit={save}>
          <label>Mes<input type="month" value={budgetMonth} onChange={(event) => setBudgetMonth(event.target.value)} required /></label>
          <label>Presupuesto<input type="number" min="1" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
          <button className="primary" disabled={saving || loadingBudget}>{saving ? 'Guardando...' : loadingBudget ? 'Cargando...' : 'Actualizar presupuesto'}</button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Respaldo mensual</h2>
            <p>Descarga fallas, seguimientos, estatus de vehículos y evidencias. La limpieza solo borra reportes cerrados del mes.</p>
          </div>
        </div>
        <div className="archive-actions">
          <label>Mes<input type="month" value={archiveMonth} onChange={(event) => setArchiveMonth(event.target.value)} /></label>
          <button type="button" onClick={downloadArchive}>Descargar respaldo</button>
          <button type="button" className="danger" onClick={cleanupArchive}>Limpiar mes respaldado</button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Informe detallado de {summary.month}</h2>
            <p>{movimientos.length} gastos enlistados al detalle</p>
          </div>
          <strong>{money(summary.gastado)}</strong>
        </div>
        <div className="budget-report-list">
          {movimientos.map((item) => {
            const origin = item.tipo_movimiento === 'reporte' ? `Reporte #${item.reporte_id}` : `Reparación #${item.reparacion_id}`;
            const vehicle = `${item.numero_economico} - ${item.vehiculo_tipo || 'Unidad'}`;
            const vehicleMeta = [item.marca, item.modelo, item.placas].filter(Boolean).join(' | ');
            return (
              <article className="budget-report-row" key={item.id}>
                <div className="budget-report-main">
                  <div><span>Origen</span><strong>{origin}</strong></div>
                  <div><span>Monto</span><strong>{money(item.cotizacion_total)}</strong></div>
                  <div><span>Departamento</span><strong>{labelDepartment(item.departamento)}</strong></div>
                  <div><span>Unidad</span><strong>{vehicle}</strong>{vehicleMeta && <small>{vehicleMeta}</small>}</div>
                </div>
                <div className="budget-report-detail">
                  <div><span>Concepto</span><strong>{labelFailure(item.tipo_falla)}</strong></div>
                  <div><span>Estatus</span><strong>{labelStatus(item.estatus || item.urgencia)}</strong></div>
                  <div><span>Taller</span><strong>{item.taller || 'Sin taller registrado'}</strong></div>
                  <div><span>Registrado por</span><strong>{labelName(item.usuario || 'Sin usuario')}</strong></div>
                  <div><span>{item.tipo_movimiento === 'reporte' ? 'Fecha del reporte' : 'Fecha de ingreso'}</span><strong>{formatDateTime(item.fecha_presupuesto)}</strong></div>
                  <div><span>Ingreso a taller</span><strong>{formatDateTime(item.fecha_ingreso)}</strong></div>
                  <div><span>Entrega estimada</span><strong>{item.fecha_estimada_entrega ? formatDateTime(item.fecha_estimada_entrega) : 'Sin fecha'}</strong></div>
                  <div><span>Cotización registrada</span><strong>{formatDateTime(item.cotizacion_registrada_at || item.fecha_movimiento)}</strong></div>
                </div>
                <p>{item.descripcion || 'Sin descripción registrada'}</p>
                {item.observaciones && <p>Observaciones: {item.observaciones}</p>}
              </article>
            );
          })}
          {!movimientos.length && <Empty text="No hay gastos registrados en este mes." />}
        </div>
      </section>
    </div>
  );
}

function HelpView({ user }) {
  const roleName = {
    admin: 'Administrador / Parque Vehicular',
    departamento: 'Usuario de departamento',
    taller: 'Taller o encargado de reparación'
  }[user.role] || user.role;

  const permissions = {
    admin: [
      'Ver todos los departamentos y vehículos.',
      'Agregar, editar y eliminar vehículos sin historial.',
      'Registrar y administrar usuarios del sistema.',
      'Revisar reportes de fallas y avanzar su seguimiento.',
      'Consultar el historial completo de cualquier vehículo.',
      'Exportar reportes de vehículos en Excel.'
    ],
    departamento: [
      'Ver solo los vehículos de su departamento.',
      'Agregar vehículos para su propio departamento.',
      'Editar o eliminar vehículos de su departamento si no tienen historial protegido.',
      'Reportar fallas y consultar el seguimiento.',
      'Llenar checklist diario de sus unidades.',
      'Consultar el historial de los vehículos de su departamento.'
    ],
    taller: [
      'Consultar información asignada al taller cuando existan reparaciones.',
      'Actualizar avances de reportes asignados.',
      'Consultar información asignada según permisos.',
      'No administra usuarios ni vehículos de otros departamentos.'
    ]
  };

  const sections = [
    ['Inicio', 'Muestra un resumen general: total de vehículos, disponibles, en taller, fallas, reportes urgentes y checklists faltantes. Sirve para detectar rápido dónde hay pendientes.'],
    ['Vehículos', 'Permite consultar el inventario, buscar por unidad, placas o departamento, filtrar por estatus y administrar unidades según permisos. Admin ve todo; departamentos ven sus propias unidades.'],
    ['Reparaciones', 'Muestra vehículos en reparación, qué se está reparando, dónde están, fecha de ingreso, días transcurridos y entrega estimada. Admin ve todo; departamentos ven lo suyo.'],
    ['Reportes', 'Sirve para reportar fallas mecánicas, eléctricas, llantas, frenos, motor, carrocería, documentación u otro problema. Admin y taller pueden avanzar el flujo del reporte.'],
    ['Checklist', 'Revisión diaria rápida por vehículo. Se registra kilometraje, responsable y estado de combustible, llantas, luces, frenos, motor, carrocería, documentos y limpieza.'],
    ['Historial vehicular', 'Permite seleccionar un vehículo y consultar su ficha, checklists diarios, fallas reportadas, mantenimientos y cambios de estatus. Admin ve todos; departamentos ven sus unidades.'],
    ['Usuarios', 'Solo para administrador. Permite crear usuarios, activar/desactivar accesos, ver detalles y cambiar contraseñas protegidas.'],
    ['Excel', 'Descarga el reporte de vehículos visibles para el usuario. Admin descarga todo; departamento descarga solo sus vehículos.']
  ];

  return (
    <div className="help-grid">
      <section className="panel">
        <h2>Cómo usar el sistema</h2>
        <p className="help-intro">Estas son las funciones principales del sistema y para qué sirve cada apartado.</p>
        <div className="help-list">
          {sections.map(([title, text]) => (
            <article key={title}>
              <strong>{title}</strong>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Tu tipo de usuario</h2>
        <div className="role-card">
          <span>Rol actual</span>
          <strong>{roleName}</strong>
          <p>{labelName(user.nombre)}</p>
        </div>
        <h2>Acciones permitidas</h2>
        <ul className="permission-list">
          {(permissions[user.role] || []).map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cache, setCache] = useState({ dashboard: null, vehiculos: null, reparaciones: null, reportes: null, departamentos: null, usuarios: null, talleres: null, presupuesto: null, checklist: null, historial: null });

  async function refresh(key = tab, force = false) {
    const staticTabs = new Set(['ayuda', 'historial']);
    if (staticTabs.has(key)) {
      setLoading(false);
      setError('');
      return null;
    }
    if (!force && cache[key]) return cache[key];
    setLoading(true);
    setError('');
    try {
      const loaders = {
        dashboard: api.dashboard,
        vehiculos: api.vehiculos,
        reparaciones: api.reparaciones,
        reportes: api.reportes,
        departamentos: api.departamentos,
        usuarios: api.usuarios,
        talleres: api.talleres,
        presupuesto: api.presupuesto,
        checklist: api.alertasChecklist,
        historial: api.historial
      };
      const value = await loaders[key]();
      setCache((current) => ({ ...current, [key]: value }));
      return value;
    } catch (err) {
      setError(err.message);
      if (err.message.includes('Sesión') || err.message.includes('Sesion')) setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api.me()
      .then((session) => setUser(session))
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    refresh('dashboard');
    refresh('departamentos');
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (tab === 'reportes' || tab === 'checklist' || tab === 'reparaciones' || tab === 'historial') refresh('vehiculos', tab === 'historial');
    if (tab === 'reportes' && user.role === 'admin') refresh('talleres');
    refresh(tab, tab === 'checklist');
  }, [tab, user]);

  const visibleTabs = tabs.filter((item) => !item.adminOnly || user?.role === 'admin');
  const title = { dashboard: 'Inicio', vehiculos: 'Gestión de vehículos', reparaciones: 'Reparaciones', reportes: 'Fallas y seguimiento', checklist: 'Revisión diaria', historial: 'Historial vehicular', presupuesto: 'Presupuesto', ayuda: 'Ayuda', usuarios: 'Usuarios y accesos' }[tab];

  if (!user) return <Login onLogin={(session) => { setUser(session); setLoading(false); }} />;

  return (
    <div className="app">
      <aside>
        <div className="brand side-brand">
          <span>Parque Vehicular<br />Izamal</span>
          <strong>PV</strong>
          <small>{APP_RELEASE_TITLE}</small>
        </div>
        <nav className="side-nav" aria-label="Navegación principal">
          {visibleTabs.map(({ id, label, icon: Icon }) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon /> {label}</button>
          ))}
          <button className="download" onClick={() => api.exportarVehiculos()}><FileDown /> Excel</button>
        </nav>
      </aside>
      <main>
        <header>
          <div><h1>{title}</h1><p>{labelName(user.nombre)} | {user.role}</p></div>
          <button onClick={async () => { await api.logout(); setUser(null); setCache({}); }}><LogOut /> Salir</button>
        </header>
        {error && <p className="error">{error}</p>}
        {loading && <div className="loading"><Loader2 className="spin" /> Cargando información...</div>}
        {tab === 'dashboard' && <Dashboard data={cache.dashboard || {}} user={user} />}
        {tab === 'vehiculos' && <Vehicles data={cache.vehiculos || []} departments={cache.departamentos || []} role={user.role} refresh={refresh} />}
        {tab === 'reparaciones' && <Repairs vehicles={cache.vehiculos || []} repairs={cache.reparaciones || []} role={user.role} refresh={refresh} />}
        {tab === 'reportes' && <Reports vehicles={cache.vehiculos || []} reports={cache.reportes || []} workshops={cache.talleres || []} role={user.role} refresh={refresh} />}
        {tab === 'checklist' && <Checklist vehicles={cache.vehiculos || []} alerts={cache.checklist} refresh={refresh} />}
        {tab === 'historial' && <VehicleHistory vehicles={cache.vehiculos || []} role={user.role} />}
        {tab === 'presupuesto' && user.role === 'admin' && <BudgetView data={cache.presupuesto || { month: localMonthInput(), asignado: 80000, gastado: 0, disponible: 80000, porcentajeUsado: 0, movimientos: [] }} refresh={refresh} />}
        {tab === 'ayuda' && <HelpView user={user} />}
        {tab === 'usuarios' && user.role === 'admin' && <Users users={cache.usuarios || []} departments={cache.departamentos || []} refresh={refresh} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

