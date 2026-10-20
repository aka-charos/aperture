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
 * and the item gets its own row. With no comparable id a row is still taken
 * over, since that is the re-issued-id case the fallback exists for — but only
 * when the row's own id is no longer on the server (see `pickTitleYearRow`).
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
  /**
   * The row's names (title, original title), read only by the external-id
   * fallback: one agreeing id is trusted only when a name is related too.
   */
  titles?: ReadonlyArray<string | null | undefined>
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
 *
 * `isLive` answers whether a row's provider id belongs to an item the server
 * listed in this run. A re-issue means the old id is GONE, so a live row is
 * someone else's and may be taken over only when an id positively agrees —
 * the same work held twice (a 4K and an HD library), which keeps sharing one
 * row as it always has. Without this, two works where one side carries no
 * external id have nothing to conflict on and fold together again.
 */
export function pickTitleYearRow<T extends TitleYearRow>(
  candidates: readonly T[] | undefined,
  incoming: ExternalIds,
  isLive: (providerItemId: string) => boolean = () => false
): T | null {
  if (!candidates || candidates.length === 0) return null
  let best: T | null = null
  let bestScore = -1
  for (const row of candidates) {
    if (externalIdsConflict(row, incoming)) continue
    const score = agreeingIds(row, incoming)
    if (score === 0 && isLive(row.providerItemId)) continue
    if (score > bestScore) {
      best = row
      bestScore = score
    }
  }
  return best
}

/**
 * Record in the index that `row` now belongs to the incoming item. The ids are
 * REPLACED, never merged, because the sync's UPDATE writes an absent id as
 * NULL: an index remembering the old owner's id would let a later item this
 * run positively agree with a row that no longer carries it, and take it from
 * its live owner.
 */
export function takeOverRow(
  row: TitleYearRow,
  providerItemId: string,
  incoming: ExternalIds & { titles?: ReadonlyArray<string | null | undefined> }
): void {
  row.providerItemId = providerItemId
  row.tmdbId = incoming.tmdbId || null
  row.imdbId = incoming.imdbId || null
  row.tvdbId = incoming.tvdbId || null
  if (incoming.titles) row.titles = incoming.titles
}

/** A name folded for comparison: accents off, case off, letters and digits only. */
function foldTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Whether any name on one side contains a name on the other once folded:
 * "Clerks" and "Clerks (Extended)", or a title and the same title with its
 * year appended. A name folding to nothing (punctuation only) relates to
 * nothing.
 */
export function titlesRelated(
  a: ReadonlyArray<string | null | undefined> | undefined,
  b: ReadonlyArray<string | null | undefined> | undefined
): boolean {
  const fold = (names: ReadonlyArray<string | null | undefined> | undefined) =>
    (names ?? [])
      .filter((n): n is string => typeof n === 'string')
      .map(foldTitle)
      .filter((n) => n.length > 0)
  const left = fold(a)
  const right = fold(b)
  return left.some((x) => right.some((y) => x.includes(y) || y.includes(x)))
}

/**
 * The keys a row is found under by external id: `tmdb:…`, `imdb:…`, `tvdb:…`.
 * Prefixed because the three id spaces overlap (a TMDb and a TVDb id can both
 * be 1832).
 */
function externalIdKeys(ids: ExternalIds): string[] {
  const keys: string[] = []
  for (const [prefix, value] of [
    ['tmdb', ids.tmdbId],
    ['imdb', ids.imdbId],
    ['tvdb', ids.tvdbId],
  ] as const) {
    const id = normalizeId(value)
    if (id !== null) keys.push(`${prefix}:${id}`)
  }
  return keys
}

/**
 * The second fallback, for an item title+year could not place: a stored row
 * whose own item is GONE from the server and which agrees with the incoming
 * item on an external id.
 *
 * Measured: a media server rescanning a folder deleted twelve films and
 * re-added them under new ids, and the new items arrived with no year yet (and
 * one renamed, "Clerks (Extended)" → "Clerks"). Title+year had nothing to match
 * on, so the sync would insert twelve new rows and delete the old ones — and a
 * movie row's delete cascades to every rating, recommendation and Watch This
 * item that named it. The TMDb and IMDb ids were identical on both sides.
 *
 * Stricter than the title+year rule on purpose, since the title and year did
 * not vouch for it: the row's item must not be live this run (an item still on
 * the server keeps its row), no id may conflict, and either two ids agree or
 * one does AND a name is related (`titlesRelated`). One id alone is what a
 * mis-identified item carries, and a wrong match hands a gone film's ratings
 * and history to a different one. Two ids agreeing is the same work under
 * another name (a translated title), and so is a different cut of it: TMDb
 * gives an extended edition the film's own ids, the identity the title+year
 * rule already lets two libraries share one row by.
 *
 * Ties keep the FIRST candidate, so the caller decides the order: both syncs
 * read their rows oldest first, and the row with the longest history wins.
 */
export function pickExternalIdRow<T extends TitleYearRow>(
  candidates: readonly T[] | undefined,
  incoming: ExternalIds & { titles?: ReadonlyArray<string | null | undefined> },
  isLive: (providerItemId: string) => boolean
): T | null {
  if (!candidates || candidates.length === 0) return null
  let best: T | null = null
  let bestScore = 0
  for (const row of candidates) {
    if (isLive(row.providerItemId)) continue
    if (externalIdsConflict(row, incoming)) continue
    const score = agreeingIds(row, incoming)
    if (score < 2 && !titlesRelated(row.titles, incoming.titles)) continue
    if (score > bestScore) {
      best = row
      bestScore = score
    }
  }
  return best
}

/** Stored rows indexed both ways the sync can find a re-issued item's row. */
export interface RebindIndex<T extends TitleYearRow> {
  byTitleYear: Map<string, T[]>
  byExternalId: Map<string, T[]>
}

/**
 * Index stored rows by title+year and by external id. Both maps hold the SAME
 * row objects, so a takeover through one is seen through the other.
 */
export function buildRebindIndex<T extends TitleYearRow>(
  rows: ReadonlyArray<T & { title: string | null; year: number | null }>
): RebindIndex<T> {
  const byExternalId = new Map<string, T[]>()
  for (const row of rows) addByExternalId(byExternalId, row)
  return { byTitleYear: indexByTitleYear(rows), byExternalId }
}

function addByExternalId<T extends TitleYearRow>(index: Map<string, T[]>, row: T): void {
  for (const key of externalIdKeys(row)) {
    const list = index.get(key)
    if (list) list.push(row)
    else index.set(key, [row])
  }
}

export interface RebindMatch<T> {
  row: T
  /** The row's provider id before the takeover: what the sync's UPDATE targets. */
  previousId: string
}

/** An item with an unknown provider id, as the matcher reads it. */
export type IncomingItem = ExternalIds & {
  providerItemId: string
  title: string | null | undefined
  originalTitle?: string | null
  year: number | null | undefined
}

export interface RebindOptions {
  /**
   * Whether the external-id fallback may run. Only once `isLive` answers for
   * EVERY item the server lists this run, across all libraries: a row whose
   * item sits in a library not listed yet reads as gone, and the fallback has
   * no title+year check to stop it handing that row to another item.
   * Required, so no caller gets it by default.
   */
  byExternalId: boolean
}

/**
 * The row an item with an unknown provider id takes over, or null when it
 * needs a row of its own: title+year first (`pickTitleYearRow`), then, when
 * allowed, external ids (`pickExternalIdRow`). The chosen row is marked as the
 * item's (`takeOverRow`), so no later item this run can take it as well; the
 * id it had before is returned beside it, since that is the row the UPDATE
 * targets.
 */
export function findRebindRow<T extends TitleYearRow>(
  index: RebindIndex<T>,
  incoming: IncomingItem,
  isLive: (providerItemId: string) => boolean,
  options: RebindOptions
): RebindMatch<T> | null {
  const titles = [incoming.title, incoming.originalTitle]
  const key = titleYearKey(incoming.title, incoming.year)
  let row = key ? pickTitleYearRow(index.byTitleYear.get(key), incoming, isLive) : null
  if (!row && options.byExternalId) {
    const seen = new Set<T>()
    const candidates: T[] = []
    for (const idKey of externalIdKeys(incoming)) {
      for (const candidate of index.byExternalId.get(idKey) ?? []) {
        if (!seen.has(candidate)) {
          seen.add(candidate)
          candidates.push(candidate)
        }
      }
    }
    row = pickExternalIdRow(candidates, { ...incoming, titles }, isLive)
  }
  if (!row) return null
  const previousId = row.providerItemId
  takeOverRow(row, incoming.providerItemId, { ...incoming, titles })
  return { row, previousId }
}

/** What the sync does with one listed item (`decideIncoming`). */
export type IncomingDecision<T> =
  /** Its provider id is a stored row's: refresh that row. */
  | { kind: 'update' }
  /** It takes over the stored row `match.previousId` (a re-issued id). */
  | { kind: 'takeover'; match: RebindMatch<T> }
  /** Nothing matched yet: ask again once every library has been listed. */
  | { kind: 'defer' }
  /** Nothing matches: it gets a row of its own. */
  | { kind: 'insert' }

/**
 * The one decision both syncs make per listed item, in two phases. While the
 * libraries are still being listed (`'listing'`), an item is matched by
 * provider id or title+year exactly as before, and anything else is DEFERRED
 * rather than inserted, because the external-id fallback cannot run until
 * every library has answered. In the `'final'` phase, with liveness complete,
 * a deferred item is matched again with the fallback allowed, and inserted
 * only when nothing takes it.
 *
 * Deferring rather than fetching every library first is what keeps one
 * library's failure from costing the others: each library is still written as
 * it is listed, and only the items no row claimed wait for the end.
 */
export function decideIncoming<T extends TitleYearRow>(
  index: RebindIndex<T>,
  existingProviderIds: ReadonlySet<string>,
  incoming: IncomingItem,
  isLive: (providerItemId: string) => boolean,
  phase: 'listing' | 'final'
): IncomingDecision<T> {
  if (existingProviderIds.has(incoming.providerItemId)) return { kind: 'update' }
  const match = findRebindRow(index, incoming, isLive, { byExternalId: phase === 'final' })
  if (match) return { kind: 'takeover', match }
  return phase === 'listing' ? { kind: 'defer' } : { kind: 'insert' }
}

/** Record a row inserted this run, so a later item can match it as before. */
export function addToRebindIndex<T extends TitleYearRow>(
  index: RebindIndex<T>,
  row: T,
  title: string | null | undefined,
  year: number | null | undefined
): void {
  const key = titleYearKey(title, year)
  if (key) {
    const list = index.byTitleYear.get(key)
    if (list) list.push(row)
    else index.byTitleYear.set(key, [row])
  }
  addByExternalId(index.byExternalId, row)
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
