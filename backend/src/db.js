import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

if (!config.databaseUrl) {
  throw new Error('Falta DATABASE_URL para conectar PostgreSQL/Supabase');
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false
});

function normalizeParams(params = []) {
  const values = Array.isArray(params) ? params : params && typeof params === 'object' ? Object.values(params) : [];
  if (values.some((value) => value === undefined)) {
    throw new Error('Parametro SQL indefinido');
  }
  return values;
}

function toPostgresPlaceholders(sqlText) {
  let index = 0;
  let text = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  const statementEnds = [];

  for (let i = 0; i < sqlText.length; i += 1) {
    const char = sqlText[i];
    const next = sqlText[i + 1];

    if (lineComment) {
      text += char;
      if (char === '\n') lineComment = false;
      continue;
    }

    if (blockComment) {
      text += char;
      if (char === '*' && next === '/') {
        text += next;
        i += 1;
        blockComment = false;
      }
      continue;
    }

    if (quote) {
      text += char;
      if (char === quote) {
        if (next === quote) {
          text += next;
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === '-' && next === '-') {
      text += char + next;
      i += 1;
      lineComment = true;
      continue;
    }

    if (char === '/' && next === '*') {
      text += char + next;
      i += 1;
      blockComment = true;
      continue;
    }

    if (char === "'" || char === '"') {
      text += char;
      quote = char;
      continue;
    }

    if (char === '?') {
      text += `$${++index}`;
      continue;
    }

    if (char === ';') {
      statementEnds.push(text.length);
    }

    text += char;
  }

  return { text, placeholders: index, statementEnds };
}

function assertSafeQuery(sqlText, values) {
  if (sqlText.includes('\0')) {
    throw new Error('Consulta SQL no valida');
  }
  const query = toPostgresPlaceholders(sqlText);
  const multipleStatements = query.statementEnds.some((position) => query.text.slice(position + 1).trim().length > 0);
  if (multipleStatements) {
    throw new Error('Consulta SQL multiple no permitida');
  }
  if (values.some((value) => typeof value === 'string' && value.includes('\0'))) {
    throw new Error('Parametro SQL no valido');
  }
  return query;
}

export function sql(sqlText, params = []) {
  const values = normalizeParams(params);
  const query = assertSafeQuery(sqlText, values);
  if (query.placeholders !== values.length) {
    throw new Error('Cantidad de parametros SQL no coincide con la consulta');
  }
  return { text: query.text, values };
}

function withReturningId(text) {
  if (/^\s*insert\s+/i.test(text) && !/\breturning\b/i.test(text)) {
    return `${text} RETURNING id`;
  }
  return text;
}

export async function all(sqlText, params = []) {
  const query = sql(sqlText, params);
  const result = await pool.query(query.text, query.values);
  return result.rows;
}

export async function get(sqlText, params = []) {
  const rows = await all(sqlText, params);
  return rows[0] || null;
}

export async function run(sqlText, params = []) {
  const query = sql(sqlText, params);
  const result = await pool.query(withReturningId(query.text), query.values);
  return {
    rowCount: result.rowCount,
    changes: result.rowCount,
    rows: result.rows,
    lastInsertRowid: result.rows[0]?.id
  };
}

export async function transaction(fn) {
  const client = await pool.connect();
  const tx = {
    all: async (sqlText, params = []) => {
      const query = sql(sqlText, params);
      const result = await client.query(query.text, query.values);
      return result.rows;
    },
    get: async (sqlText, params = []) => {
      const query = sql(sqlText, params);
      const result = await client.query(query.text, query.values);
      return result.rows[0] || null;
    },
    run: async (sqlText, params = []) => {
      const query = sql(sqlText, params);
      const result = await client.query(withReturningId(query.text), query.values);
      return {
        rowCount: result.rowCount,
        changes: result.rowCount,
        rows: result.rows,
        lastInsertRowid: result.rows[0]?.id
      };
    }
  };

  try {
    await client.query('BEGIN');
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
