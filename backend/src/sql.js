const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

function assertIdentifier(identifier) {
  if (!identifierPattern.test(identifier)) {
    throw new Error(`Identificador SQL no permitido: ${identifier}`);
  }
  return identifier;
}

export function departmentScope(req, column, options = {}) {
  const scopedRoles = options.scopedRoles || ['departamento'];
  if (!scopedRoles.includes(req.user.role)) return { clause: '', params: [] };
  return {
    clause: `${assertIdentifier(column)} = ?`,
    params: [req.user.department_id]
  };
}

export function whereClause(...conditions) {
  const active = conditions.filter((condition) => condition?.clause);
  if (!active.length) return { sql: '', params: [] };
  return {
    sql: `WHERE ${active.map((condition) => condition.clause).join(' AND ')}`,
    params: active.flatMap((condition) => condition.params || [])
  };
}

export function andClause(...conditions) {
  const active = conditions.filter((condition) => condition?.clause);
  if (!active.length) return { sql: '', params: [] };
  return {
    sql: `AND ${active.map((condition) => condition.clause).join(' AND ')}`,
    params: active.flatMap((condition) => condition.params || [])
  };
}

export function inClause(column, values) {
  const safeColumn = assertIdentifier(column);
  const params = values.map((value) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new Error(`Valor no permitido para ${safeColumn}`);
    }
    return number;
  });
  if (!params.length) return { clause: '1 = 0', params: [] };
  return {
    clause: `${safeColumn} IN (${params.map(() => '?').join(',')})`,
    params
  };
}
