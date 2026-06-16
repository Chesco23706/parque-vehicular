import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_PATH = path.resolve(__dirname, '../assets/izamal-logo.jpg');
const COLORS = {
  ink: '#2B2D42',
  muted: '#6B6258',
  brown: '#4A2D1E',
  gold: '#E9C46A',
  paleGold: '#FFF6D3',
  line: '#EADCA7',
  green: '#2F7D55',
  red: '#9F3A2A',
  blue: '#386FA4'
};

function money(value) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return 'Sin registro';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: '2-digit' });
}

function labelStatus(value = '') {
  return {
    'En revision': 'En revision',
    'En revision por Parque Vehicular': 'En revision por Parque Vehicular',
    'En diagnostico': 'En diagnostico',
    'Reparacion en proceso': 'Reparacion en proceso',
    'Reparacion terminada': 'Reparacion terminada',
    'Vehiculo entregado': 'Vehiculo entregado',
    'En reparacion': 'En reparacion'
  }[value] || value || 'Sin estatus';
}

function labelFailure(value = '') {
  return {
    Mecanica: 'Mecanica',
    Electrica: 'Electrica',
    Carroceria: 'Carroceria',
    Documentacion: 'Documentacion',
    Reparacion: 'Reparacion'
  }[value] || value || 'Sin concepto';
}

function truncate(value, max = 70) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function groupSum(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row) || 'Sin clasificar';
    groups.set(key, (groups.get(key) || 0) + Number(row.cotizacion_total || 0));
  }
  return [...groups.entries()]
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total);
}

function drawHeader(doc, summary, user) {
  const { left, right, top } = doc.page.margins;
  const pageWidth = doc.page.width - left - right;
  const y = top - 8;

  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, left, y, { fit: [58, 58] });
  }

  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(COLORS.brown)
    .text('Ayuntamiento de Izamal', left + 70, y + 2, { width: pageWidth - 70 });
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(COLORS.ink)
    .text('Informe mensual detallado de presupuesto', left + 70, y + 24, { width: pageWidth - 70 });
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .text(`Mes: ${summary.month} | Generado: ${formatDate(new Date())} | Usuario: ${user?.nombre || 'Sistema'}`, left + 70, y + 43, { width: pageWidth - 70 });

  doc.moveTo(left, top + 62).lineTo(doc.page.width - right, top + 62).strokeColor(COLORS.line).lineWidth(1).stroke();
}

function addPage(doc, summary, user) {
  doc.addPage();
  drawHeader(doc, summary, user);
  return doc.page.margins.top + 82;
}

function drawSummaryCard(doc, x, y, width, label, value, color = COLORS.ink) {
  doc.roundedRect(x, y, width, 58, 6).fillAndStroke('#FFFDF7', COLORS.line);
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(label, x + 10, y + 10, { width: width - 20 });
  doc.font('Helvetica-Bold').fontSize(14).fillColor(color).text(value, x + 10, y + 28, { width: width - 20 });
}

function drawProgress(doc, x, y, width, percent) {
  const safePercent = Math.max(0, Math.min(100, Number(percent || 0)));
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink).text('Avance del presupuesto', x, y);
  doc.roundedRect(x, y + 20, width, 16, 8).fill('#F4EAD2');
  doc.roundedRect(x, y + 20, width * (safePercent / 100), 16, 8).fill(COLORS.gold);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.brown).text(`${safePercent}% usado`, x, y + 42, { width });
}

function drawBarChart(doc, x, y, width, title, rows, color = COLORS.gold) {
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink).text(title, x, y, { width });
  const chartRows = rows.slice(0, 6);
  const max = Math.max(1, ...chartRows.map((row) => row.total));
  let currentY = y + 22;

  if (!chartRows.length) {
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text('Sin gastos registrados.', x, currentY, { width });
    return currentY + 20;
  }

  for (const row of chartRows) {
    const labelWidth = 118;
    const barWidth = width - labelWidth - 82;
    const filled = Math.max(4, barWidth * (row.total / max));
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(truncate(row.label, 28), x, currentY, { width: labelWidth });
    doc.roundedRect(x + labelWidth, currentY + 1, barWidth, 8, 4).fill('#F4EAD2');
    doc.roundedRect(x + labelWidth, currentY + 1, filled, 8, 4).fill(color);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.ink).text(money(row.total), x + labelWidth + barWidth + 8, currentY - 1, { width: 74, align: 'right' });
    currentY += 17;
  }
  return currentY;
}

function drawTableHeader(doc, y, columns) {
  const x = doc.page.margins.left;
  doc.rect(x, y, columns.reduce((sum, column) => sum + column.width, 0), 22).fill(COLORS.gold);
  let currentX = x;
  for (const column of columns) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.ink).text(column.label, currentX + 4, y + 7, { width: column.width - 8 });
    currentX += column.width;
  }
  return y + 22;
}

function drawExpenseTable(doc, summary, user, startY) {
  const rows = summary.movimientos || [];
  const columns = [
    { label: 'Fecha', width: 58 },
    { label: 'Origen', width: 58 },
    { label: 'Vehiculo', width: 88 },
    { label: 'Departamento', width: 96 },
    { label: 'Taller', width: 92 },
    { label: 'Concepto / estatus', width: 112 },
    { label: 'Monto', width: 74 }
  ];
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const x = doc.page.margins.left;
  let y = startY;

  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text('Tabla detallada de gastos', x, y);
  y += 20;
  y = drawTableHeader(doc, y, columns);

  if (!rows.length) {
    doc.rect(x, y, tableWidth, 36).strokeColor(COLORS.line).stroke();
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text('No hay gastos registrados en este mes.', x + 8, y + 12, { width: tableWidth - 16 });
    return;
  }

  rows.forEach((item, index) => {
    const rowHeight = 44;
    const detailHeight = 32;
    const needed = rowHeight + detailHeight + 4;
    if (y + needed > doc.page.height - doc.page.margins.bottom) {
      y = addPage(doc, summary, user);
      y = drawTableHeader(doc, y, columns);
    }

    const origin = item.tipo_movimiento === 'reporte' ? `Reporte #${item.reporte_id}` : `Rep. #${item.reparacion_id}`;
    const vehicle = `${item.numero_economico || 'S/N'} ${item.vehiculo_tipo || ''}`.trim();
    const concept = `${labelFailure(item.tipo_falla)} | ${labelStatus(item.estatus || item.urgencia)}`;
    const values = [
      formatDate(item.fecha_presupuesto),
      origin,
      vehicle,
      item.departamento || 'Sin depto.',
      item.taller || 'Sin taller',
      concept,
      money(item.cotizacion_total)
    ];

    doc.rect(x, y, tableWidth, rowHeight).fill(index % 2 === 0 ? '#FFFFFF' : '#FFFDF7').strokeColor(COLORS.line).stroke();
    let currentX = x;
    values.forEach((value, columnIndex) => {
      const column = columns[columnIndex];
      const align = columnIndex === values.length - 1 ? 'right' : 'left';
      doc.font(columnIndex === values.length - 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.3).fillColor(COLORS.ink).text(String(value), currentX + 4, y + 8, { width: column.width - 8, align, height: rowHeight - 10 });
      currentX += column.width;
    });
    y += rowHeight;

    const vehicleMeta = [item.marca, item.modelo, item.placas].filter(Boolean).join(' | ');
    const detail = [
      `Descripcion: ${item.descripcion || 'Sin descripcion registrada'}`,
      item.observaciones ? `Observaciones: ${item.observaciones}` : '',
      vehicleMeta ? `Datos del vehiculo: ${vehicleMeta}` : '',
      `Ingreso: ${formatDate(item.fecha_ingreso)} | Entrega estimada: ${item.fecha_estimada_entrega ? formatDate(item.fecha_estimada_entrega) : 'Sin fecha'} | Cotizacion: ${formatDate(item.cotizacion_registrada_at || item.fecha_movimiento)}`
    ].filter(Boolean).join('  ');
    doc.rect(x, y, tableWidth, detailHeight).fillAndStroke(COLORS.paleGold, COLORS.line);
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted).text(truncate(detail, 260), x + 6, y + 6, { width: tableWidth - 12, height: detailHeight - 8 });
    y += detailHeight;
  });
}

export function streamBudgetReportPdf(summary, options, writable) {
  const user = options?.user || {};
  const rows = summary.movimientos || [];
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: {
    Title: `Informe de presupuesto ${summary.month}`,
    Author: 'Ayuntamiento de Izamal',
    Subject: 'Informe mensual detallado de presupuesto'
  } });
  doc.pipe(writable);

  drawHeader(doc, summary, user);
  const left = doc.page.margins.left;
  const top = doc.page.margins.top + 84;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.brown).text(`Presupuesto mensual ${summary.month}`, left, top, { width: pageWidth });
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text('Reporte formal con detalle de gastos, unidades, fechas, talleres, tablas y graficas de distribucion.', left, top + 24, { width: pageWidth });

  const cardY = top + 52;
  drawSummaryCard(doc, left, cardY, 170, 'Presupuesto asignado', money(summary.asignado));
  drawSummaryCard(doc, left + 184, cardY, 170, 'Gasto registrado', money(summary.gastado), COLORS.red);
  drawSummaryCard(doc, left + 368, cardY, 170, 'Disponible', money(summary.disponible), Number(summary.disponible) < 0 ? COLORS.red : COLORS.green);
  drawSummaryCard(doc, left + 552, cardY, 150, 'Movimientos', String(rows.length), COLORS.blue);

  drawProgress(doc, left, cardY + 82, 310, summary.porcentajeUsado);
  drawBarChart(doc, left + 346, cardY + 82, 330, 'Gasto por departamento', groupSum(rows, (row) => row.departamento), COLORS.gold);
  drawBarChart(doc, left, cardY + 196, 330, 'Gasto por tipo de concepto', groupSum(rows, (row) => labelFailure(row.tipo_falla)), COLORS.blue);
  drawBarChart(doc, left + 346, cardY + 196, 330, 'Gasto por taller/proveedor', groupSum(rows, (row) => row.taller), COLORS.green);

  const tableY = addPage(doc, summary, user);
  drawExpenseTable(doc, summary, user, tableY);

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted).text(`Pagina ${i + 1} de ${range.count}`, doc.page.width - 110, doc.page.height - 24, { width: 74, align: 'right' });
  }

  doc.end();
}
