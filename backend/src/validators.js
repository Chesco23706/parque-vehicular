import { z } from 'zod';

export const vehicleSchema = z.object({
  numero_economico: z.string().min(2),
  department_id: z.coerce.number().int().positive(),
  tipo: z.string().min(2),
  marca: z.string().min(2),
  modelo: z.string().min(1),
  anio: z.coerce.number().int().min(1950).max(2100),
  placas: z.string().min(2),
  numero_serie: z.string().min(4),
  kilometraje: z.coerce.number().int().nonnegative(),
  estatus: z.enum(['Disponible', 'En uso', 'Con falla reportada', 'En revision', 'En taller', 'Fuera de servicio']),
  observaciones: z.string().optional().default('')
});

export const reportSchema = z.object({
  vehiculo_id: z.coerce.number().int().positive(),
  tipo_falla: z.enum(['Mecanica', 'Electrica', 'Llantas', 'Frenos', 'Motor', 'Carroceria', 'Documentacion', 'Otro']),
  descripcion: z.string().min(10),
  urgencia: z.enum(['Baja', 'Media', 'Alta', 'Critica'])
});

export const seguimientoSchema = z.object({
  flujo_estatus: z.enum([
    'Reporte recibido',
    'En revision por Parque Vehicular',
    'Taller asignado',
    'En diagnostico',
    'Reparacion en proceso',
    'Reparacion terminada',
    'Vehiculo entregado',
    'Caso cerrado'
  ]),
  comentario: z.string().optional().default('')
});

export const tallerSchema = z.object({
  nombre: z.string().min(2),
  contacto: z.string().optional().default(''),
  telefono: z.string().optional().default(''),
  direccion: z.string().optional().default(''),
  tipo_servicio: z.string().min(2)
});

export const asignacionSchema = z.object({
  reporte_id: z.coerce.number().int().positive(),
  taller_id: z.coerce.number().int().positive().optional(),
  taller_nombre: z.preprocess((value) => String(value || '').trim() || undefined, z.string().min(2).optional()),
  fecha_ingreso: z.string().min(8),
  fecha_estimada_entrega: z.string().optional().default(''),
  costo_estimado: z.coerce.number().nonnegative().default(0),
  cotizacion_total: z.coerce.number().positive().optional(),
  observaciones: z.string().optional().default('')
});

export const checklistSchema = z.object({
  vehiculo_id: z.coerce.number().int().positive(),
  fecha: z.string().min(8),
  kilometraje_actual: z.coerce.number().int().nonnegative(),
  nivel_combustible: z.string().min(1),
  nivel_aceite: z.string().min(1),
  anticongelante: z.string().min(1),
  liquido_frenos: z.string().min(1),
  llantas: z.string().min(1),
  luces: z.string().min(1),
  frenos: z.string().min(1),
  motor: z.string().min(1),
  carroceria: z.string().min(1),
  documentos_vigentes: z.string().min(1),
  limpieza: z.string().min(1),
  observaciones: z.string().optional().default(''),
  responsable: z.string().min(2)
});

export const userSchema = z.object({
  nombre: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['admin', 'departamento', 'taller']),
  department_id: z.coerce.number().int().positive().nullable().optional(),
  activo: z.coerce.number().int().min(0).max(1).default(1)
});

export const repairSchema = z.object({
  vehiculo_id: z.coerce.number().int().positive(),
  taller_nombre: z.string().min(2),
  taller_direccion: z.string().optional().default(''),
  descripcion: z.string().min(5),
  fecha_ingreso: z.string().min(8),
  fecha_estimada_entrega: z.string().optional().default(''),
  estatus: z.enum(['En reparacion', 'En diagnostico', 'Esperando refacciones', 'Reparacion terminada', 'Entregado']).default('En reparacion'),
  cotizacion_total: z.coerce.number().nonnegative().optional().default(0),
  observaciones: z.string().optional().default('')
});

