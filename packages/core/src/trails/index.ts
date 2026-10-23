/**
 * Trails: following library titles one to the next through the named things
 * they share (rules.ts says what counts and how much; graph.ts reads it).
 *
 * The index is built from the whole library in memory, rebuilt when it is an
 * hour old, and narrowed per viewer to the titles their library scope allows —
 * that list comes from `libraryScopeSql`, the one scope rule, so nothing here
 * re-states which titles a viewer may see. A title synced after the last build
 * is not in the index; asking for one rebuilds early (at most every few
 * minutes) rather than answering that it does not exist.
 */

import { createChildLogger } from '../lib/logger.js'
import { query } from '../lib/db.js'
import { libraryScopeSql, type LibraryScope } from '../lib/libraryScope.js'
import {
  buildTrailIndex,
  createView,
  describeIndex,
  pickWellConnected,
  sharedLinks,
  type IndexedTitle,
  type TrailIndex,
  type TrailView,
} from './graph.js'
import { movieSource, seriesSource, type MovieCreditRow, type SeriesCreditRow } from './sources.js'
import { formatTitleRef, rolesOf, type EntityKind, type LinkRole, type TitleRef } from './rules.js'

export {
  LINK_ROLES,
  parseTitleRef,
  formatTitleRef,
  type EntityKind,
  type LinkRole,
  type TitleRef,
} from './rules.js'

const logger = createChildLogger('trails')

/** How long an index is used before it is rebuilt. */
const INDEX_MAX_AGE_MS = 60 * 60 * 1000
/** How soon an unknown title may trigger an early rebuild. */
const EARLY_REBUILD_AFTER_MS = 5 * 60 * 1000
/** Distinct scopes remembered per index; most instances have a handful. */
const MAX_CACHED_VIEWS = 50

interface IndexCache {
  index: TrailIndex
  builtAt: number
  views: Map<string, Promise<TrailView>>
}

let cache: IndexCache | null = null
let building: Promise<IndexCache> | null = null

async function loadIndex(): Promise<IndexCache> {
  const started = Date.now()
  const [movies, series] = await Promise.all([
    query<MovieCreditRow>(
      `SELECT id::text AS id, title, year, poster_url, directors, writers, cinematographers,
              composers, editors, actors, keywords, studios, collection_id, collection_name
         FROM movies`
    ),
    query<SeriesCreditRow>(
      `SELECT id::text AS id, title, year, poster_url,
              COALESCE(NULLIF(directors, '{}'), tmdb_creators, '{}') AS creators,
              writers, actors, keywords, studios, network
         FROM series`
    ),
  ])
  const index = buildTrailIndex([
    ...movies.rows.map(movieSource),
    ...series.rows.map(seriesSource),
  ])
  // The measurement rules.ts's weights are provisional on, over the whole library.
  logger.info(
    { ms: Date.now() - started, entities: index.entities.length, ...describeIndex(createView(index, null)) },
    'Trails index built'
  )
  return { index, builtAt: Date.now(), views: new Map() }
}

async function currentIndex(forceRebuild = false): Promise<IndexCache> {
  const fresh = cache && !forceRebuild && Date.now() - cache.builtAt < INDEX_MAX_AGE_MS
  if (fresh && cache) return cache
  if (!building) {
    building = loadIndex()
      .then((built) => {
        cache = built
        return built
      })
      .finally(() => {
        building = null
      })
    // A stale index answers while this builds, so nothing may await it — and
    // an unawaited rejection is fatal here (the API exits on one). Handled
    // once at the source; a caller that does await still gets the error.
    building.catch((err) => logger.warn({ err }, 'Trails index rebuild failed; the previous index stays in use'))
  }
  // A stale index still answers while its replacement builds; only the first
  // build, or a forced one, is waited for.
  if (cache && !forceRebuild) return cache
  return building
}

function scopeKey(scope: LibraryScope): string {
  return JSON.stringify([scope.libraryIds ? [...scope.libraryIds].sort() : null, scope.maxParentalRating])
}

async function buildView(index: TrailIndex, scope: LibraryScope): Promise<TrailView> {
  const params: unknown[] = []
  const bind = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }
  const rows = await query<{ type: 'movie' | 'series'; id: string }>(
    `SELECT 'movie' AS type, t.id::text AS id FROM movies t WHERE ${libraryScopeSql(scope, 't', bind)}
     UNION ALL
     SELECT 'series' AS type, t.id::text AS id FROM series t WHERE ${libraryScopeSql(scope, 't', bind)}`,
    params
  )
  const allowed: number[] = []
  for (const row of rows.rows) {
    const title = index.byRef.get(formatTitleRef(row))
    if (title !== undefined) allowed.push(title)
  }
  return createView(index, allowed)
}

export async function viewFor(scope: LibraryScope, forceRebuild = false): Promise<TrailView> {
  const current = await currentIndex(forceRebuild)
  const key = scopeKey(scope)
  let view = current.views.get(key)
  if (!view) {
    if (current.views.size >= MAX_CACHED_VIEWS) current.views.clear()
    view = buildView(current.index, scope)
    current.views.set(key, view)
    view.catch(() => current.views.delete(key))
  }
  return view
}

/**
 * Whether any of these refs is a title the library holds. Asked only about refs
 * the index lacks, before rebuilding for them: a deleted title in a saved link,
 * or an id someone made up, must not cost a full rebuild.
 */
async function anyTitleExists(refs: readonly TitleRef[]): Promise<boolean> {
  const movies = refs.filter((ref) => ref.type === 'movie').map((ref) => ref.id)
  const series = refs.filter((ref) => ref.type === 'series').map((ref) => ref.id)
  const row = await query<{ found: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM movies WHERE id = ANY($1::uuid[]))
         OR EXISTS (SELECT 1 FROM series WHERE id = ANY($2::uuid[])) AS found`,
    [movies, series]
  )
  return row.rows[0]?.found === true
}

/**
 * The view and the indices of `refs` in it; a title out of scope reads as
 * missing (null), exactly like one that does not exist. A ref the index does
 * not hold may be a title synced since the last build, so when the library
 * has it the index is rebuilt early (at most every few minutes) before giving
 * up on it.
 */
export async function resolve(
  scope: LibraryScope,
  refs: readonly TitleRef[]
): Promise<{ view: TrailView; titles: (number | null)[] }> {
  let view = await viewFor(scope)
  const unknown = refs.filter((ref) => !view.index.byRef.has(formatTitleRef(ref)))
  if (
    unknown.length > 0 &&
    cache &&
    Date.now() - cache.builtAt > EARLY_REBUILD_AFTER_MS &&
    (await anyTitleExists(unknown))
  ) {
    try {
      view = await viewFor(scope, true)
    } catch {
      // Logged where it failed; the index already loaded still answers.
    }
  }
  const titles = refs.map((ref) => {
    const title = view.index.byRef.get(formatTitleRef(ref))
    return title !== undefined && view.allowed[title] ? title : null
  })
  return { view, titles }
}

// ---------------------------------------------------------------------------
// What the API sends
// ---------------------------------------------------------------------------

export interface TrailTitle {
  ref: string
  type: 'movie' | 'series'
  id: string
  title: string
  year: number | null
  posterUrl: string | null
}

export interface TrailEntity {
  /** Stable across index rebuilds; how a client asks for this thread again. */
  key: string
  kind: EntityKind
  name: string
  photo: string | null
  /** Titles in the viewer's scope carrying it. */
  titleCount: number
}

export interface TrailLink extends TrailEntity {
  /** The roles the step's first title gives it, strongest first. */
  rolesFrom: LinkRole[]
  /** The roles the step's second title gives it. */
  rolesTo: LinkRole[]
}

/** The most titles one trail holds; older ones fall off the front. */
export const MAX_TRAIL_TITLES = 12

export function titleView(title: IndexedTitle): TrailTitle {
  return {
    ref: formatTitleRef(title),
    type: title.type,
    id: title.id,
    title: title.title,
    year: title.year,
    posterUrl: title.posterUrl,
  }
}

export function entityView(view: TrailView, entity: number): TrailEntity {
  const record = view.index.entities[entity]
  return {
    key: record.key,
    kind: record.kind,
    name: record.name,
    photo: record.photo,
    titleCount: view.count(entity),
  }
}

function linkView(view: TrailView, entity: number, maskFrom: number, maskTo: number): TrailLink {
  return { ...entityView(view, entity), rolesFrom: rolesOf(maskFrom), rolesTo: rolesOf(maskTo) }
}

// ---------------------------------------------------------------------------
// The questions the page asks
// ---------------------------------------------------------------------------

/**
 * A trail read back: the titles in scope in the order given, and what links
 * each to the next — the strongest thing the two share, or null where they
 * share nothing (a title between them was dropped as out of scope).
 */
export async function getTrail(
  scope: LibraryScope,
  refs: readonly TitleRef[]
): Promise<{ titles: TrailTitle[]; links: (TrailLink | null)[] }> {
  const { view, titles } = await resolve(scope, refs.slice(-MAX_TRAIL_TITLES))
  const kept = titles.filter((title): title is number => title != null)
  const links: (TrailLink | null)[] = []
  for (let i = 1; i < kept.length; i += 1) {
    const strongest = sharedLinks(view, kept[i - 1], kept[i])[0]
    links.push(strongest ? linkView(view, strongest.entity, strongest.maskA, strongest.maskB) : null)
  }
  return { titles: kept.map((title) => titleView(view.index.titles[title])), links }
}

/**
 * A random well-connected title in scope to start from ("Surprise me" on Next
 * from here); null when none is found.
 */
export async function getTrailStart(
  scope: LibraryScope,
  random: () => number = Math.random
): Promise<TrailTitle | null> {
  const view = await viewFor(scope)
  const title = pickWellConnected(view, random)
  return title == null ? null : titleView(view.index.titles[title])
}
