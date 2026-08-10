function cell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}

/** Serialise rows to CSV. Uses CRLF, which is what Excel expects. */
export function toCsv(rows, columns) {
  const header = columns.map(cell).join(',');
  const body = rows.map((r) => columns.map((c) => cell(r[c])).join(','));
  return [header, ...body].join('\r\n');
}
