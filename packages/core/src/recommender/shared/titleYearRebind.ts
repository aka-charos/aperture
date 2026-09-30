/**
 * Library sync: when may an item with an unknown provider id take over an
 * existing row that has the same title and year?
 *
 * Both syncs fall back to title+year so that a media server re-issuing an
 * item's id (a library rescan, a moved file) refreshes the existing row rather
 * than inserting a duplicate. On its own that key is not an identity: two
 * different films can share a title and a year (Swan Song, 2021, twice), and
 * the fallback then folded them into ONE row. Each sync rewrote that row with
 * whichever of the two was processed last — its provider id, poster, library —
 * so the library, every search and every picker showed one of them, which one
 * depending on the viewer's library access and on the last sync.
 *
 * The external ids are what tell a re-issued item from a different work: a
 * TMDb, IMDb or TVDb id present on both sides and disagreeing means two works,
 * and the item gets its own row. With no comparable id the old behaviour is
 * kept, since that is exactly the re-issued-id case the fallback exists for.
 *
 * Pure, no DB; pinned by `titleYearRebind.test.ts`.
 */

export interface ExternalIds {
  tmdbId?: string | number | null
  imdbId?: string | null
  tvdbId?: string | number | null
}

/** A stored row a title+year match could land on. */
export interface TitleYearRow extends ExternalIds {
  providerItemId: string
}

/** The title+year key, or null when either half is missing (no fallback then). */
export function titleYearKey(
  title: string | null | undefined,
  year: number | null | undefined
): string | null {
  if (!title || year == null) return null
  return `${title.toLowerCase()}|${year}`
}

function normalizeId(value: string | number | null | undefined): string | null {
  if (value == null) return null
  const text = String(value).trim().toLowerCase()
  return text.length > 0 ? text : null
}

/** True when any external id is present on both sides and differs. */
export function externalIdsConflict(a: ExternalIds, b: ExternalIds): boolean {
  const pairs: Array<[string | number | null | undefined, string | number | null | undefined]> = [
    [a.tmdbId, b.tmdbId],
    [a.imdbId, b.imdbId],
    [a.tvdbId, b.tvdbId],
  ]
  return pairs.some(([x, y]) => {
    const nx = normalizeId(x)
    const ny = normalizeId(y)
    return nx !== null && ny !== null && nx !== ny
  })
}

/** How many external ids are present on both sides and agree. */
function agreeingIds(a: ExternalIds, b: ExternalIds): number {
  let count = 0
  for (const [x, y] of [
    [a.tmdbId, b.tmdbId],
    [a.imdbId, b.imdbId],
    [a.tvdbId, b.tvdbId],
  ] as const) {
    const nx = normalizeId(x)
    if (nx !== null && nx === normalizeId(y)) count++
  }
  return count
}

/**
 * The row an incoming item may take over, or null when it needs a row of its
 * own. Rows whose ids contradict the item are never chosen; among the rest the
 * one agreeing on the most ids wins, so a real re-issue finds its own row even
 * when a same-titled different work sits beside it.
 */
export function pickTitleYearRow<T extends TitleYearRow>(
  candidates: readonly T[] | undefined,
  incoming: ExternalIds
): T | null {
  if (!candidates || candidates.length === 0) return null
  let best: T | null = null
  let bestScore = -1
  for (const row of candidates) {
    if (externalIdsConflict(row, incoming)) continue
    const score = agreeingIds(row, incoming)
    if (score > bestScore) {
      best = row
      bestScore = score
    }
  }
  return best
}

/** Index stored rows by title+year; several rows may legitimately share a key. */
export function indexByTitleYear<T extends TitleYearRow>(
  rows: ReadonlyArray<T & { title: string | null; year: number | null }>
): Map<string, T[]> {
  const index = new Map<string, T[]>()
  for (const row of rows) {
    const key = titleYearKey(row.title, row.year)
    if (!key) continue
    const list = index.get(key)
    if (list) list.push(row)
    else index.set(key, [row])
  }
  return index
}
