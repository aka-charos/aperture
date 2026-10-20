/**
 * The plot a poster card shows on hover, cut down before it leaves the server.
 *
 * The overlay clamps it to at most thirteen lines (on the largest card, about
 * 500 characters), so a rail of dozens of titles carrying full synopses ships
 * text nobody can see. The cut sits well past what the clamp shows; the
 * translated text arrives separately, by title id, and is not affected.
 */
export const POSTER_OVERVIEW_CHARS = 700

/** `column`, cut to `POSTER_OVERVIEW_CHARS`, NULL when blank. Interpolates a column name only. */
export function posterOverviewSql(column: string): string {
  return `LEFT(NULLIF(btrim(${column}), ''), ${POSTER_OVERVIEW_CHARS})`
}

/** The same cut for text that did not come through `posterOverviewSql` (Top Picks reads it in core). */
export function clipPosterOverview(text: string | null | undefined): string | null {
  const trimmed = text?.trim()
  return trimmed ? trimmed.slice(0, POSTER_OVERVIEW_CHARS) : null
}
