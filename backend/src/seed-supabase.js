import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL en backend/.env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function one(sql, params = []) {
  const result = await query(sql, params);
  return result.rows[0];
}

async function main() {
  await query("insert into roles (nombre) values ('admin'), ('departamento'), ('taller') on conflict (nombre) do nothing");
  await query(
    `insert into departamentos (nombre, activo) values
      ('Parque Vehicular / Administracion', true),
      ('Policia Municipal', true),
      ('Servicios Publicos', true),
      ('Agua Potable', true),
      ('Logistica', true)
     on conflict (nombre) do nothing`
  );
  await query('insert into presupuesto_config (id, monto) values (1, 80000) on conflict (id) do nothing');
  await query(
    `insert into talleres (id, nombre, contacto, telefono, direccion, tipo_servicio, activo)
     values (1, 'Taller Municipal Central', 'Encargado de guardia', '555-0100', 'Av. Principal S/N', 'Mecanica general, frenos y electrico', true)
     on conflict (id) do nothing`
  );

  const adminRole = await one('select id from roles where nombre = $1', ['admin']);
  const deptRole = await one('select id from roles where nombre = $1', ['departamento']);
  const parque = await one('select id from departamentos where nombre = $1', ['Parque Vehicular / Administracion']);
  const policia = await one('select id from departamentos where nombre = $1', ['Policia Municipal']);
  const servicios = await one('select id from departamentos where nombre = $1', ['Servicios Publicos']);
  const agua = await one('select id from departamentos where nombre = $1', ['Agua Potable']);
  const logistica = await one('select id from departamentos where nombre = $1', ['Logistica']);
  const hash = await bcrypt.hash('Parque2026!', 12);

  const users = [
    ['Administrador Parque', 'admin@parque.local', hash, adminRole.id, parque.id],
    ['Policia Municipal', 'policia@parque.local', hash, deptRole.id, policia.id],
    ['Servicios Publicos', 'servicios@parque.local', hash, deptRole.id, servicios.id],
    ['Logistica', 'logistica@parque.local', hash, deptRole.id, logistica.id],
    ['Agua Potable', 'agua@parque.local', hash, deptRole.id, agua.id]
  ];

  for (const user of users) {
    await query(
      `insert into usuarios (nombre, email, password_hash, role_id, department_id, activo)
       values ($1, $2, $3, $4, $5, true)
       on conflict (email) do update set
         nombre = excluded.nombre,
         password_hash = excluded.password_hash,
         role_id = excluded.role_id,
         department_id = excluded.department_id,
         activo = true`,
      user
    );
  }

  const vehicles = [
    ['PM-001', policia.id, 'Patrulla', 'Ford', 'Interceptor', 2022, 'PM-001-A', 'SERIEPM001', 42100, 'Disponible', 'Unidad operativa'],
    ['PM-014', policia.id, 'Motocicleta', 'Honda', 'XR190', 2021, 'PM-014-M', 'SERIEPM014', 18500, 'En uso', 'Turno matutino'],
    ['SP-032', servicios.id, 'Camioneta', 'Nissan', 'NP300', 2020, 'SP-032-C', 'SERIESP032', 67200, 'En taller', 'Caja abierta'],
    ['AP-008', agua.id, 'Pipa', 'International', '4300', 2019, 'AP-008-P', 'SERIEAP008', 95500, 'Disponible', 'Servicio rural']
  ];

  for (const vehicle of vehicles) {
    await query(
      `insert into vehiculos (numero_economico, department_id, tipo, marca, modelo, anio, placas, numero_serie, kilometraje, estatus, observaciones)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (numero_economico) do nothing`,
      vehicle
    );
  }

  const summary = await one(
    `select
      (select count(*) from usuarios) as usuarios,
      (select count(*) from vehiculos) as vehiculos,
      (select count(*) from departamentos) as departamentos`
  );

  console.log('Supabase preparado correctamente.');
  console.log(`Usuarios: ${summary.usuarios}`);
  console.log(`Vehiculos: ${summary.vehiculos}`);
  console.log(`Departamentos: ${summary.departamentos}`);
  console.log('Acceso demo: admin@parque.local / Parque2026!');
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
