/**
 * Library sync: a BLANK from the media server never erases what a row holds.
 *
 * Measured: a rescan re-added twelve films under new ids, and the new items
 * arrived with no production year, hours later still. The sync then writes
 * whatever the server sends over the row it matched, so a blank year, plot or
 * genre list replaced the enriched row's own; the canonical text changed, the
 * title was re-embedded from almost nothing, and the recommendations built on
 * it moved, until a later sync brought the details back (if one ever did).
 *
 * So the descriptive fields the media server only ever leaves blank while it is
 * still identifying an item keep the stored value when the server sends none:
 * a NULL, an empty or whitespace-only string, or an empty list. Deliberately
 * NOT applied to identity or bookkeeping columns (provider ids, external ids,
 * library, path, image URLs, tags): an absent external id must read as absent
 * (the rebind index mirrors the UPDATE, shared/titleYearRebind.ts), tags carry
 * Aperture's own managed tags, and a stale image URL points at a deleted item.
 *
 * `content_rating` is on the list for a second reason: the viewer's parental
 * limit shows an unrated title (lib/libraryScope.ts), so a mid-scan blank
 * would show a restricted film to a restricted viewer.
 *
 * Pure SQL builders, pinned by `keepStored.test.ts`. `table` is the UPDATE's
 * target (whose bare columns hold the row's values before the statement) and
 * `data` the incoming row alias every sync UPDATE uses.
 */

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

function checked(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Not a column name: ${name}`)
  return name
}

/** A scalar (number, date): NULL keeps the stored value. */
export function keepStoredValue(column: string, table: string): string {
  const c = checked(column)
  return `COALESCE(data.${c}, ${checked(table)}.${c})`
}

/** Text: NULL, empty or whitespace-only keeps the stored value. */
export function keepStoredText(column: string, table: string): string {
  const c = checked(column)
  return `COALESCE(NULLIF(btrim(data.${c}), ''), ${checked(table)}.${c})`
}

/**
 * A text[] column sent as a JSON array: an empty or missing array keeps the
 * stored value, which itself reads as `{}` when it was NULL.
 */
export function keepStoredTextArray(column: string, table: string): string {
  const c = checked(column)
  const t = checked(table)
  return `CASE
            WHEN jsonb_typeof(data.${c}) = 'array' AND jsonb_array_length(data.${c}) > 0
              THEN ARRAY(SELECT jsonb_array_elements_text(data.${c}))
            ELSE COALESCE(${t}.${c}, '{}')
          END`
}

/** A JSONB array column: an empty or missing array keeps the stored value. */
export function keepStoredJsonArray(column: string, table: string): string {
  const c = checked(column)
  return `CASE
            WHEN jsonb_typeof(data.${c}) = 'array' AND jsonb_array_length(data.${c}) > 0 THEN data.${c}
            ELSE ${checked(table)}.${c}
          END`
}
