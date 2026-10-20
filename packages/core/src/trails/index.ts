/**
 * Trails: how library titles are linked through the named things they
 * share (rules.ts says what counts and how much; graph.ts searches it).
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
  commonGround,
  createView,
  describeIndex,
  findPaths,
  pickDistantTitle,
  pickWellConnected,
  sharedLinks,
  titleThreads,
  type TrailIndex,
  type TrailView,
  type FoundPath,
  type IndexedTitle,
  type SharedLink,
} from './graph.js'
import { movieSource, seriesSource, type MovieCreditRow, type SeriesCreditRow } from './sources.js'
import { formatTitleRef, rolesOf, type EntityKind, type LinkRole, type TitleRef } from './rules.js'

export {
  LINK_ROLES,
  MAX_PATH_HOPS,
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

/** The most titles "In common" compares at once. */
export const MAX_COMMON_TITLES = 8

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

async function viewFor(scope: LibraryScope, forceRebuild = false): Promise<TrailView> {
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
async function resolve(scope: LibraryScope, refs: readonly TitleRef[]): Promise<{ view: TrailView; titles: (number | null)[] }> {
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

export interface TrailStep {
  from: TrailTitle
  to: TrailTitle
  via: TrailLink
  /** The other things these two share, strongest first. */
  alsoShared: TrailLink[]
}

export interface TrailRoute {
  steps: TrailStep[]
}

export type TrailResult =
  | { status: 'notFound' }
  | { status: 'same'; from: TrailTitle }
  | { status: 'found'; from: TrailTitle; to: TrailTitle; paths: TrailRoute[] }
  /** No path; `isolated` lists the ends that have no thread at all. */
  | { status: 'none'; from: TrailTitle; to: TrailTitle; isolated: string[] }

export interface ThreadMemberView {
  title: TrailTitle
  roles: LinkRole[]
}

export interface ThreadView extends TrailEntity {
  /** The roles the starting title gives it. */
  roles: LinkRole[]
  others: ThreadMemberView[]
  more: number
}

export interface CommonLinkView extends TrailEntity {
  carriers: Array<{ ref: string; roles: LinkRole[] }>
}

const ALSO_SHARED_LIMIT = 4

function titleView(title: IndexedTitle): TrailTitle {
  return {
    ref: formatTitleRef(title),
    type: title.type,
    id: title.id,
    title: title.title,
    year: title.year,
    posterUrl: title.posterUrl,
  }
}

function entityView(view: TrailView, entity: number): TrailEntity {
  const record = view.index.entities[entity]
  return { kind: record.kind, name: record.name, photo: record.photo, titleCount: view.count(entity) }
}

function linkView(view: TrailView, shared: SharedLink): TrailLink {
  return { ...entityView(view, shared.entity), rolesFrom: rolesOf(shared.maskA), rolesTo: rolesOf(shared.maskB) }
}

function pathView(view: TrailView, path: FoundPath): TrailRoute {
  const steps: TrailStep[] = []
  for (let i = 0; i < path.entities.length; i += 1) {
    const a = path.titles[i]
    const b = path.titles[i + 1]
    const shared = sharedLinks(view, a, b)
    const via = shared.find((link) => link.entity === path.entities[i])
    if (!via) continue // cannot happen: the path stepped through it
    steps.push({
      from: titleView(view.index.titles[a]),
      to: titleView(view.index.titles[b]),
      via: linkView(view, via),
      alsoShared: shared
        .filter((link) => link.entity !== via.entity)
        .slice(0, ALSO_SHARED_LIMIT)
        .map((link) => linkView(view, link)),
    })
  }
  return { steps }
}

function hasThreads(view: TrailView, title: number): boolean {
  for (const entity of view.index.titleEntities[title]) if (view.links(entity)) return true
  return false
}

function trailsWithin(view: TrailView, from: number, to: number): TrailResult {
  const fromTitle = titleView(view.index.titles[from])
  if (from === to) return { status: 'same', from: fromTitle }
  const toTitle = titleView(view.index.titles[to])
  const paths = findPaths(view, from, to)
  if (paths.length > 0) {
    return { status: 'found', from: fromTitle, to: toTitle, paths: paths.map((path) => pathView(view, path)) }
  }
  const isolated = [from, to].filter((title) => !hasThreads(view, title))
  return {
    status: 'none',
    from: fromTitle,
    to: toTitle,
    isolated: isolated.map((title) => formatTitleRef(view.index.titles[title])),
  }
}

// ---------------------------------------------------------------------------
// The four questions
// ---------------------------------------------------------------------------

/** How two titles are connected, by up to three routes through different titles. */
export async function findTrails(scope: LibraryScope, from: TitleRef, to: TitleRef): Promise<TrailResult> {
  const { view, titles } = await resolve(scope, [from, to])
  const [a, b] = titles
  if (a == null || b == null) return { status: 'notFound' }
  return trailsWithin(view, a, b)
}

/** Two well-connected titles a few steps apart, and how they connect. */
export async function surpriseTrail(scope: LibraryScope, random: () => number = Math.random): Promise<TrailResult> {
  const view = await viewFor(scope)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const from = pickWellConnected(view, random)
    if (from == null) break
    const to = pickDistantTitle(view, from, random)
    if (to == null) continue
    const result = trailsWithin(view, from, to)
    if (result.status === 'found') return result
  }
  return { status: 'notFound' }
}

/** Every thread leading out of one title, strongest first. */
export async function getTitleThreads(
  scope: LibraryScope,
  ref: TitleRef
): Promise<{ title: TrailTitle; threads: ThreadView[] } | null> {
  const { view, titles } = await resolve(scope, [ref])
  const title = titles[0]
  if (title == null) return null
  return {
    title: titleView(view.index.titles[title]),
    threads: titleThreads(view, title).map((thread) => ({
      ...entityView(view, thread.entity),
      roles: rolesOf(thread.mask),
      others: thread.others.map((member) => ({
        title: titleView(view.index.titles[member.title]),
        roles: rolesOf(member.mask),
      })),
      more: thread.more,
    })),
  }
}

/**
 * What several titles have in common. A title out of scope is dropped rather
 * than failing the request; `titles` lists the ones compared, in the order given.
 */
export async function getCommonGround(
  scope: LibraryScope,
  refs: readonly TitleRef[]
): Promise<{ titles: TrailTitle[]; links: CommonLinkView[] }> {
  const { view, titles } = await resolve(scope, refs.slice(0, MAX_COMMON_TITLES))
  const chosen = [...new Set(titles.filter((title): title is number => title != null))]
  return {
    titles: chosen.map((title) => titleView(view.index.titles[title])),
    links: commonGround(view, chosen).map((link) => ({
      ...entityView(view, link.entity),
      carriers: link.carriers.map((member) => ({
        ref: formatTitleRef(view.index.titles[member.title]),
        roles: rolesOf(member.mask),
      })),
    })),
  }
}

/** Title cards for refs, in the order given, skipping any out of scope. */
export async function getTrailTitles(scope: LibraryScope, refs: readonly TitleRef[]): Promise<TrailTitle[]> {
  const { view, titles } = await resolve(scope, refs)
  return titles.filter((title): title is number => title != null).map((title) => titleView(view.index.titles[title]))
}
