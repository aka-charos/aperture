/**
 * A database number as a JavaScript number. Pure.
 *
 * `pg` hands NUMERIC (and BIGINT) columns over as text, so `'0.0000'` is
 * truthy and `Number(null)` is 0. NULL must stay null, never become 0, and
 * text that is not a number is null too.
 */
export function numericOrNull(value: unknown): number | null {
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(n) ? n : null
}
