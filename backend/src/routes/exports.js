import { Router } from 'express';
import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import { all, transaction } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { departmentScope, inClause, whereClause } from '../sql.js';
import { audit } from '../audit.js';
import { downloadFile, removeFiles } from '../storage.js';

export const exportsRouter = Router();
const require = createRequire(import.meta.url);
const archiver = require('archiver');

async function vehicles(req) {
  const scope = whereClause(departmentScope(req, 'v.department_id'));
  return all(
    `SELECT v.numero_economico, d.nombre departamento, v.tipo, v.marca, v.modelo, v.anio, v.placas, v.kilometraje, v.estatus
     FROM vehiculos v JOIN departamentos d ON d.id = v.department_id ${scope.sql}`,
    scope.params
  );
}

function escapeXml(value) {
  return String(value ?? '').replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);
}

function cell(value, type = 'String', style = 'Cell') {
  return `<Cell ss:StyleID="${style}"><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
}

function statusStyle(status) {
  if (['Disponible', 'Reparado'].includes(status)) return 'StatusOk';
  if (status === 'En revision') return 'StatusWarn';
  if (status === 'En taller') return 'StatusShop';
  if (['Con falla reportada', 'Fuera de servicio'].includes(status)) return 'StatusBad';
  return 'StatusNeutral';
}

function statusLabel(status = '') {
  const labels = {
    'En revision': 'En revisión',
    'En revision por Parque Vehicular': 'En revisión por Parque Vehicular',
    'En diagnostico': 'En diagnóstico',
    'Reparacion en proceso': 'Reparación en proceso',
    'Reparacion terminada': 'Reparación terminada',
    'Vehiculo entregado': 'Vehículo entregado',
    'En reparacion': 'En reparación'
  };
  return labels[status] || status;
}

exportsRouter.get('/vehiculos.xls', authRequired, async (req, res) => {
  const rows = await vehicles(req);
  const generatedAt = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
  const columns = [
    ['numero_economico', 'Número económico', 110],
    ['departamento', 'Departamento', 190],
    ['tipo', 'Tipo', 110],
    ['marca', 'Marca', 100],
    ['modelo', 'Modelo', 130],
    ['anio', 'Año', 70],
    ['placas', 'Placas', 100],
    ['kilometraje', 'Kilometraje', 100],
    ['estatus', 'Estatus', 145]
  ];
  const xmlRows = [
    `<Row ss:Height="28"><Cell ss:MergeAcross="8" ss:StyleID="Title"><Data ss:Type="String">Reporte de vehículos oficiales</Data></Cell></Row>`,
    `<Row><Cell ss:MergeAcross="8" ss:StyleID="Subtitle"><Data ss:Type="String">Generado: ${escapeXml(generatedAt)} | Usuario: ${escapeXml(req.user.nombre)} | Rol: ${escapeXml(req.user.role)}</Data></Cell></Row>`,
    `<Row></Row>`,
    `<Row ss:Height="24">${columns.map(([, label]) => cell(label, 'String', 'Header')).join('')}</Row>`,
    ...rows.map((row) => `<Row>${columns.map(([key]) => {
      if (key === 'kilometraje') return cell(Number(row[key] || 0), 'Number', 'NumberCell');
      if (key === 'anio') return cell(Number(row[key] || 0), 'Number', 'Cell');
      if (key === 'estatus') return cell(statusLabel(row[key]), 'String', statusStyle(row[key]));
      return cell(row[key], 'String', 'Cell');
    }).join('')}</Row>`),
    `<Row></Row>`,
    `<Row><Cell ss:MergeAcross="8" ss:StyleID="Footer"><Data ss:Type="String">Total de vehículos: ${rows.length}</Data></Cell></Row>`
  ].join('');
  const xml = `<?xml version="1.0"?>
    <?mso-application progid="Excel.Sheet"?>
    <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
      xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
      <Styles>
        <Style ss:ID="Title"><Font ss:Bold="1" ss:Size="16" ss:Color="#2B2D42"/><Alignment ss:Vertical="Center"/></Style>
        <Style ss:ID="Subtitle"><Font ss:Size="10" ss:Color="#6B6258"/></Style>
        <Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#2B2D42"/><Interior ss:Color="#E9C46A" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DDA15E"/></Borders><Alignment ss:Vertical="Center"/></Style>
        <Style ss:ID="Cell"><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#EFE7D8"/></Borders><Alignment ss:Vertical="Center"/></Style>
        <Style ss:ID="NumberCell"><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#EFE7D8"/></Borders><NumberFormat ss:Format="#,##0"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>
        <Style ss:ID="StatusOk"><Font ss:Bold="1" ss:Color="#2F7D55"/><Interior ss:Color="#EAF7EF" ss:Pattern="Solid"/></Style>
        <Style ss:ID="StatusWarn"><Font ss:Bold="1" ss:Color="#8B641B"/><Interior ss:Color="#FFF8E8" ss:Pattern="Solid"/></Style>
        <Style ss:ID="StatusShop"><Font ss:Bold="1" ss:Color="#9A5C1F"/><Interior ss:Color="#FFF0E1" ss:Pattern="Solid"/></Style>
        <Style ss:ID="StatusBad"><Font ss:Bold="1" ss:Color="#9F3A2A"/><Interior ss:Color="#FFF1EE" ss:Pattern="Solid"/></Style>
        <Style ss:ID="StatusNeutral"><Font ss:Bold="1" ss:Color="#6B6258"/><Interior ss:Color="#F7F4EE" ss:Pattern="Solid"/></Style>
        <Style ss:ID="Footer"><Font ss:Bold="1" ss:Color="#2B2D42"/></Style>
      </Styles>
      <Worksheet ss:Name="Vehículos">
        <Table>${columns.map(([, , width]) => `<Column ss:Width="${width}"/>`).join('')}${xmlRows}</Table>
        <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>4</SplitHorizontal><TopRowBottomPane>4</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions>
      </Worksheet>
    </Workbook>`;
  res.setHeader('Content-Disposition', 'attachment; filename="vehiculos.xls"');
  res.type('application/vnd.ms-excel').send(xml);
});

exportsRouter.get('/vehiculos.pdf', authRequired, async (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="vehiculos.pdf"');
  res.type('application/pdf');
  const doc = new PDFDocument({ margin: 36, size: 'A4' });
  doc.pipe(res);
  doc.fontSize(16).text('Reporte de vehículos oficiales');
  doc.moveDown();
  for (const v of await vehicles(req)) {
    doc.fontSize(10).text(`${v.numero_economico} | ${v.departamento} | ${v.tipo} ${v.marca} ${v.modelo} | ${statusLabel(v.estatus)} | ${v.placas}`);
  }
  doc.end();
});

function monthParam(req) {
  const month = String(req.query.month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  return month;
}

exportsRouter.get('/mensual.zip', authRequired, requireRole('admin'), async (req, res, next) => {
  const month = monthParam(req);
  if (!month) return res.status(400).json({ message: 'Indica el mes en formato YYYY-MM' });

  const reportes = await all(
    `SELECT r.*, v.numero_economico, d.nombre AS departamento, u.nombre AS usuario
     FROM reportes_fallas r
     JOIN vehiculos v ON v.id = r.vehiculo_id
     JOIN departamentos d ON d.id = r.department_id
     JOIN usuarios u ON u.id = r.usuario_id
     WHERE to_char(r.created_at, 'YYYY-MM') = ?
     ORDER BY r.created_at`,
    [month]
  );
  const seguimiento = await all(
    `SELECT s.*, r.id AS reporte, u.nombre AS usuario
     FROM seguimiento_reportes s
     JOIN reportes_fallas r ON r.id = s.reporte_id
     JOIN usuarios u ON u.id = s.usuario_id
     WHERE to_char(r.created_at, 'YYYY-MM') = ?
     ORDER BY s.created_at`,
    [month]
  );
  const historial = await all(
    `SELECT h.*, v.numero_economico, u.nombre AS usuario
     FROM historial_estatus h
     JOIN vehiculos v ON v.id = h.vehiculo_id
     JOIN usuarios u ON u.id = h.usuario_id
     WHERE to_char(h.created_at, 'YYYY-MM') = ?
     ORDER BY h.created_at`,
    [month]
  );
  const vehiculos = await all(`SELECT v.*, d.nombre AS departamento FROM vehiculos v JOIN departamentos d ON d.id = v.department_id ORDER BY d.nombre, v.numero_economico`);
  const evidencias = await all(
    `SELECT e.*, r.id AS reporte_id
     FROM evidencias_reportes e
     JOIN reportes_fallas r ON r.id = e.reporte_id
     WHERE to_char(r.created_at, 'YYYY-MM') = ?
     ORDER BY e.created_at`,
    [month]
  );

  res.setHeader('Content-Disposition', `attachment; filename="respaldo-${month}.zip"`);
  res.type('application/zip');
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', next);
  archive.pipe(res);
  archive.append(JSON.stringify({ generado: new Date().toISOString(), month }, null, 2), { name: 'manifest.json' });
  archive.append(JSON.stringify(reportes, null, 2), { name: 'reportes_fallas.json' });
  archive.append(JSON.stringify(seguimiento, null, 2), { name: 'seguimiento_reportes.json' });
  archive.append(JSON.stringify(historial, null, 2), { name: 'historial_estatus.json' });
  archive.append(JSON.stringify(vehiculos, null, 2), { name: 'estatus_vehiculos_actual.json' });
  for (const file of evidencias) {
    const buffer = await downloadFile(file.bucket || 'evidencias-reportes', file.stored_name);
    if (buffer) archive.append(buffer, { name: `evidencias/reporte-${file.reporte_id}/${file.file_name}` });
  }
  await audit(req, 'descargar_respaldo_mensual', 'exportar', null, { month, reportes: reportes.length, evidencias: evidencias.length });
  archive.finalize();
});

exportsRouter.delete('/mensual', authRequired, requireRole('admin'), async (req, res) => {
  const month = monthParam(req);
  if (!month) return res.status(400).json({ message: 'Indica el mes en formato YYYY-MM' });
  const reportes = await all(
    `SELECT id FROM reportes_fallas WHERE to_char(created_at, 'YYYY-MM') = ? AND flujo_estatus = 'Caso cerrado'`,
    [month]
  );
  const ids = reportes.map((row) => row.id);
  if (!ids.length) return res.json({ deletedReports: 0, deletedFiles: 0 });
  const reportIds = inClause('reporte_id', ids);
  const rowIds = inClause('id', ids);
  const files = await all(`SELECT bucket, stored_name FROM evidencias_reportes WHERE ${reportIds.clause}`, reportIds.params);

  await transaction(async (tx) => {
    await tx.run(`DELETE FROM asignaciones_taller WHERE ${reportIds.clause}`, reportIds.params);
    await tx.run(`DELETE FROM seguimiento_reportes WHERE ${reportIds.clause}`, reportIds.params);
    await tx.run(`DELETE FROM evidencias_reportes WHERE ${reportIds.clause}`, reportIds.params);
    await tx.run(`DELETE FROM reportes_fallas WHERE ${rowIds.clause}`, rowIds.params);
  });

  let deletedFiles = 0;
  const grouped = files.reduce((acc, file) => {
    const bucket = file.bucket || 'evidencias-reportes';
    acc[bucket] = [...(acc[bucket] || []), file.stored_name];
    return acc;
  }, {});
  for (const [bucket, paths] of Object.entries(grouped)) deletedFiles += await removeFiles(bucket, paths);
  await audit(req, 'limpiar_respaldo_mensual', 'exportar', null, { month, deletedReports: ids.length, deletedFiles });
  res.json({ deletedReports: ids.length, deletedFiles });
});
