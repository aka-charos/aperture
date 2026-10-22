/**
 * Next from here: what to watch after a title, with reasons a viewer can
 * check (rules.ts says why it is built this way; taste.ts does the scoring).
 *
 * It reads three things it does not own: the Trails credits index (people,
 * franchises, studios and networks per title, narrowed to the viewer's scope
 * by `libraryScopeSql`), the similarity graph's embedding neighbours, and the
 * viewer's own record — what they finished (the watched tick's reading,
 * `getWatchStatusForUser`) and how they rated it.
 */

import { query } from '../lib/db.js'
import type { LibraryScope } from '../lib/libraryScope.js'
import { createChildLogger } from '../lib/logger.js'
import { WATCH_HISTORY_EXCLUDABLE_SQL, WATCH_HISTORY_PLAYED_SQL } from '../recommender/watchedExclusion.js'
import { getSimilarMovies, getSimilarSeries } from '../similarity/index.js'
import { entityView, resolve, titleView, viewFor, type TrailEntity, type TrailTitle } from '../trails/index.js'
import type { TrailView } from '../trails/graph.js'
import { formatTitleRef, rolesOf, type LinkRole, type TitleRef } from '../trails/rules.js'
import { getWatchStatusForUser } from '../watching/watchedItems.js'
import { mapLinks } from './map.js'
import { peopleRows, type PeopleRow } from './people.js'
import { LIKED_WEIGHT, MAP_PER_ROW, NEIGHBOUR_POOL, STARTS_OFFERED, titleWeight } from './rules.js'
import { pickClose, scoreCandidates, tasteContext, type Candidate, type Reason, type ViewerTitle } from './taste.js'

export {
  CLOSE_ITEMS as NEXT_CLOSE_ITEMS,
  PEOPLE_ROWS as NEXT_PEOPLE_ROWS,
  STARTS_OFFERED as NEXT_STARTS_OFFERED,
} from './rules.js'

/** The most titles a request may ask to leave out (a trail's earlier steps). */
export const NEXT_MAX_AVOID = 12

const logger = createChildLogger('next-from-here')

// ---------------------------------------------------------------------------
// What the API sends
// ---------------------------------------------------------------------------

export type NextReason =
  /** Among the closest in feel to the start; `rank` 1 is the closest. */
  | { kind: 'feel'; rank: number }
  /** Someone (or a franchise) on both. */
  | { kind: 'shared'; entity: TrailEntity; rolesThere: LinkRole[]; rolesHere: LinkRole[] }
  /** Someone on this one whose titles the viewer keeps finishing and rating well. */
  | { kind: 'favourite'; entity: TrailEntity; rolesHere: LinkRole[]; liked: number; averageRating: number | null }
  /** A studio or network the viewer finishes far more of than its library share. */
  | { kind: 'company'; entity: TrailEntity; finished: number; ratio: number }
  /** Themes on both (TMDb keywords that still link in the viewer's scope), rarest first. */
  | { kind: 'themes'; entities: TrailEntity[] }

export interface NextItem {
  title: TrailTitle
  reasons: NextReason[]
}

export interface NextRowMember {
  title: TrailTitle
  /** The roles this title gives the row's person (or franchise, or company). */
  roles: LinkRole[]
  /** Finished, started or rated: shown for context, never suggested. */
  seen: boolean
}

/** One of the people behind the start, and what else of theirs is in the library. */
export interface NextPeopleRow {
  entity: TrailEntity
  /** The roles the start gives them. */
  rolesThere: LinkRole[]
  /** Set when the viewer keeps coming back to this person (taste.ts `personAffinity`). */
  favourite: { liked: number; averageRating: number | null } | null
  /** Set for a studio or network the viewer finishes more of than its library share. */
  company: { finished: number; ratio: number } | null
  /** Unseen first, best suggestion first; then seen, newest first. */
  members: NextRowMember[]
  /** Titles past the ones sent. */
  more: number
  /** Of those, the unseen ones (what is left out once seen titles are hidden). */
  moreUnseen: number
  seenCount: number
  /** Every title of theirs in the viewer's library, the start left out. */
  total: number
}

/** A line on the map between two titles other than the start: the strongest thing they share. */
export interface NextMapLink {
  from: string
  to: string
  entity: TrailEntity
  rolesFrom: LinkRole[]
  rolesTo: LinkRole[]
}

export interface NextFromHere {
  /** The title the list is from; null when no start was given and none could be chosen. */
  start: TrailTitle | null
  /** Close in feel, with or without a shared credit. */
  close: NextItem[]
  /** The people (and franchise, and favoured studio or network) behind the start, strongest for this viewer first. */
  people: NextPeopleRow[]
  /**
   * The map: the refs drawn around the start (the close list, then the first
   * unseen titles of each row) and the lines between them.
   */
  map: { refs: string[]; links: NextMapLink[] }
  /** Recent titles the viewer finished and did not dislike, to start from instead. */
  starts: TrailTitle[]
}

// ---------------------------------------------------------------------------
// The viewer's record
// ---------------------------------------------------------------------------

interface ViewerRecord {
  titles: Map<number, ViewerTitle>
  /**
   * Films the viewer has started without finishing (the "have you seen it"
   * predicate, WATCH_HISTORY_EXCLUDABLE_SQL): never suggested, though they
   * say nothing about taste. Started shows are in `titles` already.
   */
  started: Set<number>
}

async function loadRecord(view: TrailView, userId: string): Promise<ViewerRecord> {
  const [status, ratings, seen] = await Promise.all([
    getWatchStatusForUser(userId),
    query<{ movie_id: string | null; series_id: string | null; rating: number }>(
      `SELECT movie_id::text AS movie_id, series_id::text AS series_id, rating
         FROM user_ratings WHERE user_id = $1`,
      [userId]
    ),
    query<{ id: string }>(
      `SELECT wh.movie_id::text AS id
         FROM watch_history wh
        WHERE wh.user_id = $1 AND wh.movie_id IS NOT NULL AND ${WATCH_HISTORY_EXCLUDABLE_SQL}`,
      [userId]
    ),
  ])
  const position = (ref: TitleRef) => view.index.byRef.get(formatTitleRef(ref))
  const finished = new Map<number, boolean>()
  for (const id of status.movieIds) {
    const title = position({ type: 'movie', id })
    if (title !== undefined) finished.set(title, true)
  }
  for (const series of status.series) {
    const title = position({ type: 'series', id: series.id })
    if (title !== undefined) finished.set(title, series.watched >= series.total)
  }
  const rated = new Map<number, number>()
  for (const row of ratings.rows) {
    const ref: TitleRef | null = row.movie_id
      ? { type: 'movie', id: row.movie_id }
      : row.series_id
        ? { type: 'series', id: row.series_id }
        : null
    const title = ref ? position(ref) : undefined
    const rating = Number(row.rating)
    if (title !== undefined && Number.isFinite(rating)) rated.set(title, rating)
  }
  const titles = new Map<number, ViewerTitle>()
  for (const title of new Set([...finished.keys(), ...rated.keys()])) {
    const rating = rated.get(title) ?? null
    const isFinished = finished.get(title) === true
    titles.set(title, { weight: titleWeight({ rating, finished: isFinished }), rating, finished: isFinished })
  }
  const started = new Set<number>()
  for (const row of seen.rows) {
    const title = position({ type: 'movie', id: row.id })
    if (title !== undefined) started.add(title)
  }
  return { titles, started }
}

/** Liked enough to go on from: a rating of 7 or more, or finished and not rated. */
function goodStart(mine: ViewerTitle | undefined): boolean {
  if (!mine) return false
  return mine.rating != null ? mine.weight >= LIKED_WEIGHT : mine.finished
}

/** The viewer's most recently played titles, newest first (filtered by `pickStarts`). */
async function recentlyPlayed(userId: string): Promise<Array<{ type: 'movie' | 'series'; id: string }>> {
  const rows = await query<{ type: 'movie' | 'series'; id: string }>(
    `SELECT type, id FROM (
       SELECT 'movie' AS type, wh.movie_id::text AS id, MAX(wh.last_played_at) AS at
         FROM watch_history wh
        WHERE wh.user_id = $1 AND wh.movie_id IS NOT NULL AND ${WATCH_HISTORY_PLAYED_SQL}
        GROUP BY wh.movie_id
       UNION ALL
       SELECT 'series' AS type, e.series_id::text AS id, MAX(wh.last_played_at) AS at
         FROM watch_history wh
         JOIN episodes e ON e.id = wh.episode_id
        WHERE wh.user_id = $1 AND ${WATCH_HISTORY_PLAYED_SQL}
        GROUP BY e.series_id
     ) played
     ORDER BY at DESC NULLS LAST
     LIMIT 120`,
    [userId]
  )
  return rows.rows
}

/** Of the recently played, those in scope that make a good start. */
function pickStarts(
  view: TrailView,
  played: ReadonlyArray<{ type: 'movie' | 'series'; id: string }>,
  record: ViewerRecord
): number[] {
  const out: number[] = []
  for (const row of played) {
    const title = view.index.byRef.get(formatTitleRef(row))
    if (title === undefined || !view.allowed[title] || !goodStart(record.titles.get(title))) continue
    out.push(title)
    if (out.length >= STARTS_OFFERED) break
  }
  return out
}

/** The start's embedding neighbours as index positions, closest first; empty when it has no embedding. */
async function neighboursOf(view: TrailView, scope: LibraryScope, start: number): Promise<number[]> {
  const title = view.index.titles[start]
  const options = { limit: NEIGHBOUR_POOL, includeCrossMedia: true, scope }
  try {
    const result =
      title.type === 'movie' ? await getSimilarMovies(title.id, options) : await getSimilarSeries(title.id, options)
    const out: number[] = []
    for (const connection of result.connections) {
      const position = view.index.byRef.get(formatTitleRef({ type: connection.item.type, id: connection.item.id }))
      if (position !== undefined) out.push(position)
    }
    return out
  } catch (err) {
    // The credits still answer; only the "close in feel" side is lost.
    logger.warn({ err, ref: formatTitleRef(title) }, 'Next from here: no embedding neighbours')
    return []
  }
}

function reasonView(view: TrailView, reason: Reason): NextReason {
  switch (reason.kind) {
    case 'feel':
      return reason
    case 'shared':
      return {
        kind: 'shared',
        entity: entityView(view, reason.entity),
        rolesThere: rolesOf(reason.rolesStartMask),
        rolesHere: rolesOf(reason.rolesHereMask),
      }
    case 'favourite':
      return {
        kind: 'favourite',
        entity: entityView(view, reason.entity),
        rolesHere: rolesOf(reason.rolesHereMask),
        liked: reason.liked,
        averageRating: reason.averageRating,
      }
    case 'company':
      return { kind: 'company', entity: entityView(view, reason.entity), finished: reason.finished, ratio: reason.ratio }
    case 'themes':
      return { kind: 'themes', entities: reason.entities.map((entity) => entityView(view, entity)) }
  }
}

function rowView(view: TrailView, row: PeopleRow): NextPeopleRow {
  return {
    entity: entityView(view, row.entity),
    rolesThere: rolesOf(row.mask),
    favourite: row.person ? { liked: row.person.liked, averageRating: row.person.averageRating } : null,
    company: row.company ? { finished: row.company.finished, ratio: row.company.ratio } : null,
    members: row.members.map((member) => ({
      title: titleView(view.index.titles[member.title]),
      roles: rolesOf(member.mask),
      seen: member.seen,
    })),
    more: row.more,
    moreUnseen: row.moreUnseen,
    seenCount: row.seenCount,
    total: row.total,
  }
}

/** The titles drawn around the start: the close list, then each row's first unseen titles. */
function mapTitles(close: readonly Candidate[], rows: readonly PeopleRow[]): number[] {
  const out = close.map((candidate) => candidate.title)
  const taken = new Set(out)
  for (const row of rows) {
    let added = 0
    for (const member of row.members) {
      if (added >= MAP_PER_ROW) break
      if (member.seen) continue
      if (!taken.has(member.title)) {
        taken.add(member.title)
        out.push(member.title)
      }
      added += 1
    }
  }
  return out
}

function itemView(view: TrailView, candidate: Candidate): NextItem {
  return {
    title: titleView(view.index.titles[candidate.title]),
    reasons: candidate.reasons.map((reason) => reasonView(view, reason)),
  }
}

/**
 * What to watch after `ref` (or, with none, after the viewer's most recent
 * title they finished and did not dislike). Null when `ref` is given and is
 * not a title in the viewer's scope — it answers exactly like a missing one.
 * Titles the viewer has finished, started or rated are never suggested, and
 * neither are those in `avoid` (the earlier steps of the viewer's trail, so
 * stepping on never leads back).
 */
export async function getNextFromHere(
  scope: LibraryScope,
  userId: string,
  ref: TitleRef | null,
  avoid: readonly TitleRef[] = []
): Promise<NextFromHere | null> {
  let view: TrailView
  let start: number | null = null
  if (ref) {
    const resolved = await resolve(scope, [ref])
    view = resolved.view
    start = resolved.titles[0]
    if (start == null) return null
  } else {
    view = await viewFor(scope)
  }

  // With the start known, the neighbours do not wait on the viewer's record.
  // neighboursOf never rejects, so the early promise cannot go unhandled.
  const early = start != null ? neighboursOf(view, scope, start) : null
  const [record, played] = await Promise.all([loadRecord(view, userId), recentlyPlayed(userId)])
  const starts = pickStarts(view, played, record)
  if (start == null) start = starts[0] ?? null
  const startsView = starts.map((title) => titleView(view.index.titles[title]))
  if (start == null) return { start: null, close: [], people: [], map: { refs: [], links: [] }, starts: startsView }

  const avoided = new Set<number>()
  for (const step of avoid.slice(0, NEXT_MAX_AVOID)) {
    const title = view.index.byRef.get(formatTitleRef(step))
    if (title !== undefined && title !== start) avoided.add(title)
  }
  const seen = (title: number) => record.titles.has(title) || record.started.has(title)
  const neighbours = await (early ?? neighboursOf(view, scope, start))
  const context = tasteContext(view, record.titles)
  const candidates = scoreCandidates({
    view,
    start,
    neighbours,
    record: record.titles,
    exclude: (title) => seen(title) || avoided.has(title),
    context,
  })
  const close = pickClose(candidates)
  const rows = peopleRows({
    view,
    start,
    record: record.titles,
    seen,
    scores: new Map(candidates.map((candidate) => [candidate.title, candidate.score])),
    exclude: (title) => avoided.has(title),
    context,
  })
  const drawn = mapTitles(close, rows)
  const refOf = (title: number) => formatTitleRef(view.index.titles[title])
  return {
    start: titleView(view.index.titles[start]),
    close: close.map((candidate) => itemView(view, candidate)),
    people: rows.map((row) => rowView(view, row)),
    map: {
      refs: drawn.map(refOf),
      links: mapLinks(view, drawn).map((link) => ({
        from: refOf(link.a),
        to: refOf(link.b),
        entity: entityView(view, link.entity),
        rolesFrom: rolesOf(link.maskA),
        rolesTo: rolesOf(link.maskB),
      })),
    },
    starts: startsView,
  }
}
