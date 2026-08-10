/** Parse a money input. Returns a finite number >= 0, or null if invalid.
 *  Number('') is 0, so a blank field must be rejected explicitly - otherwise
 *  a forgotten amount silently books a zero-rupee value that passes every
 *  database check. */
export function parseAmount(raw) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
