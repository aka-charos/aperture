/**
 * Hard limits a request states about a title: genre, years, a minimum rating, a
 * maximum runtime. "An unwatched sci-fi film under 90 minutes" is a concept for
 * the embedding only in part; the rest are facts about the row, and a nearest
 * neighbour search will happily return a three-hour film as close to it.
 *
 * One rule throughout: a limit passes only what the row can prove. A title with
 * no known runtime does not fit "under 90 minutes", one with no rating does not
 * fit "rated 7 or higher". A card that breaks a stated limit is the failure the
 * limit exists to prevent, and a missing card is the safe side of it; the
 * answer says what was left out instead (`noFitNote`, `discoveryLimitsNote`).
 *
 * The one thing that is not a limit is a genre the library does not have. No
 * row could ever prove it, so holding the search to it would answer "a heist
 * film" with nothing at all over a word that is not a genre here. It is left out
 * and reported (`resolveGenreLimit`).
 *
 * Pure -- no DB access -- so the predicates can be tested without one. The reads
 * they need are in titleLimitsQuery.ts.
 */
import { z } from 'zod'
import { displayRatingAtLeastSql, WATCH_HISTORY_PLAYED_SQL } from '@aperture/core'

export type WatchStatus = 'all' | 'watched' | 'unwatched'
export type LimitMedia = 'movie' | 'series'

/** The media types a search of `type` covers, movies first. */
export function mediaTypesOf(type: 'movies' | 'series' | 'both'): LimitMedia[] {
  if (type === 'both') return ['movie', 'series']
  return [type === 'movies' ? 'movie' : 'series']
}

/**
 * SQL predicate restricting rows to titles the user has (or has not) watched.
 *
 * The exclusion half already existed in several places; the INCLUSION half is
 * what makes "which French film noir have I watched" answerable at all. Before
 * it, the only history tool was getWatchHistory — most-recent-N in play order,
 * with no filter of any kind — so the model had to infer membership by eye from
 * a sample, and reported confident false negatives when the sample missed.
 *
 * `column` is the id column of the row being filtered, always QUALIFIED
 * ('movies.id' when the table is unaliased, 'm.id'/'s.id' when it is): the
 * subquery is correlated on it, and a bare `id` would bind to `wh.id` or
 * `ep.id` inside it and match nothing. A watched SERIES means at least one of
 * its episodes was played.
 *
 * Written as a correlated [NOT] EXISTS, not [NOT] IN over the viewer's history.
 * On an ANN query the NOT IN form made the planner seq-scan movies under a
 * hashed subplan and nested-loop it against the index scan, discarding 570k
 * rows to fill LIMIT 15 for a viewer with about 3,500 played films.
 *
 * Played is the operative word, and this docstring used to claim the bare
 * version matched "every other watched check in the codebase" — it matched
 * none of them. Favoriting writes a watch_history row, so asking whether one
 * exists answered "watched" for anything the viewer had merely saved.
 */
export function watchStatusCondition(
  status: Exclude<WatchStatus, 'all'>,
  isMovie: boolean,
  column: string,
  paramIdx: number
): string {
  const subquery = isMovie
    ? `SELECT 1 FROM watch_history wh
       WHERE wh.user_id = $${paramIdx} AND wh.movie_id = ${column}
         AND ${WATCH_HISTORY_PLAYED_SQL}`
    : `SELECT 1 FROM watch_history wh
       JOIN episodes ep ON ep.id = wh.episode_id
       WHERE wh.user_id = $${paramIdx} AND ep.series_id = ${column}
         AND ${WATCH_HISTORY_PLAYED_SQL}`
  return `${status === 'watched' ? 'EXISTS' : 'NOT EXISTS'} (${subquery})`
}

/** The tool parameters, one copy for every tool that takes them. */
export const TITLE_LIMIT_PARAMS = {
  genre: z
    .string()
    .optional()
    .describe(
      'Only titles of this genre, when the request states one as a requirement: its English ' +
        'name, singular ("Science Fiction", "Thriller"). A style or mood is not a genre; ' +
        'that belongs in the search text.'
    ),
  yearMin: z.number().optional().describe('Only titles released in or after this year.'),
  yearMax: z.number().optional().describe('Only titles released in or before this year.'),
  minRating: z
    .number()
    .optional()
    .describe('Only titles rated at least this, on the 0-10 scale the cards show.'),
  maxRuntime: z
    .number()
    .optional()
    .describe(
      'Longest allowed runtime in minutes, inclusive. For a series this is its typical ' +
        'episode, not the whole show.'
    ),
}

export interface TitleLimits {
  genre?: string
  yearMin?: number
  yearMax?: number
  minRating?: number
  maxRuntime?: number
}

/**
 * Tool input as limits. Models fill optional numbers with 0 to mean "no limit",
 * and a real 0 limits nothing either (no title has a negative year or rating),
 * so a number not above 0 is dropped rather than excluding every unrated title.
 * Years and minutes are integers in the database, which refuses a fractional
 * parameter outright, so they round to the side that still honours the limit.
 */
export function readTitleLimits(input: {
  genre?: string | null
  yearMin?: number | null
  yearMax?: number | null
  minRating?: number | null
  maxRuntime?: number | null
}): TitleLimits {
  const limits: TitleLimits = {}
  const positive = (value: number | null | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0

  const genre = typeof input.genre === 'string' ? input.genre.trim() : ''
  if (genre) limits.genre = genre
  if (positive(input.yearMin)) limits.yearMin = Math.ceil(input.yearMin)
  if (positive(input.yearMax)) limits.yearMax = Math.floor(input.yearMax)
  if (positive(input.minRating)) limits.minRating = input.minRating
  if (positive(input.maxRuntime) && input.maxRuntime >= 1) {
    limits.maxRuntime = Math.floor(input.maxRuntime)
  }
  return limits
}

export function hasTitleLimits(limits: TitleLimits): boolean {
  return Object.keys(limits).length > 0
}

/**
 * Names for one thing, which the library's sources spell differently: TMDb's
 * film genre, TMDb's TV genre part, and the media server's own. Closed on
 * purpose. Anything else compares as written, and a genre that matches nothing
 * says so in the answer rather than being guessed at.
 */
const GENRE_SYNONYMS: readonly (readonly string[])[] = [['sci fi', 'scifi', 'science fiction']]

function foldGenre(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .map(singular)
    .join(' ')
}

/**
 * Enough of a plural for genre names, on both sides of the comparison, because
 * people ask for "thrillers" and "comedies". It only has to be consistent: "News"
 * folds to "new" whichever side it is on.
 */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/**
 * A genre as the names it compares under. TMDb's TV genres are compound ("Sci-Fi
 * & Fantasy", "War & Politics"), so each part counts by itself; split before
 * folding turns the separator into a space. Only "&" and "/", as in core's
 * interestEvidence.ts: "and" appears inside real names.
 */
function genreTerms(name: string): Set<string> {
  const terms = new Set<string>()
  for (const part of name.split(/\s*[&/]\s*/)) {
    const folded = foldGenre(part)
    if (!folded) continue
    terms.add(folded)
    for (const synonyms of GENRE_SYNONYMS) {
      if (synonyms.includes(folded)) for (const synonym of synonyms) terms.add(synonym)
    }
  }
  return terms
}

/**
 * The genres as stored that answer a request. Whole words of a part, never a
 * substring: "war" must not find "Star Wars" or "Western", and "drama" must not
 * find "Melodrama". Stored names go to the query as they are, so the predicate
 * is one array overlap and nothing has to fold text per row inside an ANN scan.
 */
export function matchingGenreNames(requested: string, stored: readonly string[]): string[] {
  const wanted = genreTerms(requested)
  return stored.filter((name) => [...genreTerms(name)].some((term) => wanted.has(term)))
}

/**
 * The series whose typical episode fits a maximum, read ahead of the ANN query
 * and handed to it as an id list ($1 = the maximum).
 *
 * A series has no runtime of its own, so this defines one: the median of its
 * episodes with a known length, specials (season 0) left out. The median, not
 * the mean the title page shows, because a feature-length special or pilot
 * should not move a half-hour show out of "under 30 minutes". A show with no
 * episode of known length is absent, so it does not fit.
 *
 * Read ahead rather than correlated per row: the alternative is an aggregate
 * over a show's episodes for every row an iterative scan walks, inside a query
 * whose plan this codebase has already seen go wrong over a subplan. The list is
 * bounded by the number of series, a table far smaller than the films'.
 */
export const SERIES_WITHIN_RUNTIME_SQL = `SELECT series_id FROM episodes
   WHERE season_number > 0 AND runtime_minutes > 0
   GROUP BY series_id
   HAVING percentile_cont(0.5) WITHIN GROUP (ORDER BY runtime_minutes) <= $1`

/** What the predicates need that only a read can answer. */
export interface LimitFacts {
  /** The stored genre names `limits.genre` means for this media type. */
  genreNames: string[]
  /** Series fitting `limits.maxRuntime`; unused for films, which carry their own. */
  seriesWithinRuntime: string[]
}

/** Limits with their facts read, once per tool call (titleLimitsQuery.ts). */
export interface ResolvedLimits {
  /** What will be enforced: the request's limits, less a genre the library lacks. */
  limits: TitleLimits
  facts: Record<LimitMedia, LimitFacts>
  /** Set when a genre was left out, for the model to pass on. */
  ignoredGenreNote: string | null
}

export const NO_LIMITS: ResolvedLimits = {
  limits: {},
  facts: {
    movie: { genreNames: [], seriesWithinRuntime: [] },
    series: { genreNames: [], seriesWithinRuntime: [] },
  },
  ignoredGenreNote: null,
}

/**
 * The genre limit against the genres this viewer's libraries hold, per media type.
 *
 * Unknown means no match in ANY media type searched. A genre only series carry
 * ("Reality") is a real limit on a search of both, and rightly leaves no films.
 */
export function resolveGenreLimit(
  limits: TitleLimits,
  storedByMedia: Partial<Record<LimitMedia, readonly string[]>>
): { limits: TitleLimits; genreNames: Record<LimitMedia, string[]>; ignoredGenreNote: string | null } {
  const genreNames: Record<LimitMedia, string[]> = { movie: [], series: [] }
  if (limits.genre == null) return { limits, genreNames, ignoredGenreNote: null }

  for (const media of ['movie', 'series'] as const) {
    genreNames[media] = matchingGenreNames(limits.genre, storedByMedia[media] ?? [])
  }
  if (genreNames.movie.length > 0 || genreNames.series.length > 0) {
    return { limits, genreNames, ignoredGenreNote: null }
  }

  const { genre, ...enforced } = limits
  const known = [...new Set(Object.values(storedByMedia).flat())].sort()
  return {
    limits: enforced,
    genreNames,
    ignoredGenreNote:
      `"${genre}" is not one of this library's genres, so it was not applied as a limit. ` +
      `Say so if it matters to the answer. Its genres are: ${known.join(', ') || 'none'}.`,
  }
}

/**
 * Predicates over a row of `media`, parameters taken from `bind` in the order the
 * clauses appear. No NULL gets through any of them: a comparison with NULL is not
 * true, `&&` against NULL is not true, and an empty genre list overlaps nothing.
 */
export function titleLimitClauses(
  limits: TitleLimits,
  media: LimitMedia,
  alias: string,
  bind: (value: unknown) => string,
  facts: LimitFacts
): string[] {
  const clauses: string[] = []
  if (limits.genre != null) clauses.push(`${alias}.genres && ${bind(facts.genreNames)}::text[]`)
  if (limits.yearMin != null) clauses.push(`${alias}.year >= ${bind(limits.yearMin)}`)
  if (limits.yearMax != null) clauses.push(`${alias}.year <= ${bind(limits.yearMax)}`)
  if (limits.minRating != null) {
    clauses.push(displayRatingAtLeastSql(alias, bind(limits.minRating)))
  }
  if (limits.maxRuntime != null) {
    if (media === 'movie') {
      // Above zero: a media server with no length for a file can report 0, and
      // that is not a very short film.
      clauses.push(
        `(${alias}.runtime_minutes > 0 AND ${alias}.runtime_minutes <= ${bind(limits.maxRuntime)})`
      )
    } else {
      clauses.push(`${alias}.id = ANY(${bind(facts.seriesWithinRuntime)}::uuid[])`)
    }
  }
  return clauses
}

/**
 * The limits as ` AND …` over `alias`, or '' when there are none, so a search
 * with no limits runs the query it always ran. For a query going through
 * `scopedAnnQuery`, which keeps walking the index past whatever this filters.
 */
export function titleLimitsSql(
  resolved: ResolvedLimits,
  media: LimitMedia,
  alias: string,
  bind: (value: unknown) => string
): string {
  return titleLimitClauses(resolved.limits, media, alias, bind, resolved.facts[media])
    .map((clause) => `AND ${clause}`)
    .join(' ')
}

/** The limits in words, for a note to the model. */
export function describeTitleLimits(limits: TitleLimits): string {
  const parts: string[] = []
  if (limits.genre != null) parts.push(`genre ${limits.genre}`)
  if (limits.yearMin != null && limits.yearMax != null) {
    parts.push(`released ${limits.yearMin} to ${limits.yearMax}`)
  } else if (limits.yearMin != null) {
    parts.push(`released in or after ${limits.yearMin}`)
  } else if (limits.yearMax != null) {
    parts.push(`released in or before ${limits.yearMax}`)
  }
  if (limits.minRating != null) parts.push(`rated at least ${limits.minRating}`)
  if (limits.maxRuntime != null) parts.push(`at most ${limits.maxRuntime} minutes`)
  return parts.join('; ')
}

/**
 * Why nothing came back, in words the model can pass on.
 *
 * "Found" and never "exist": an iterative scan stops at `hnsw.max_scan_tuples`,
 * so a very narrow limit can come back short of what the library holds.
 *
 * @param stated the limits in words
 */
export function noFitNote(stated: string): string {
  return (
    `No title was found that fits these limits: ${stated}. ` +
    'A title with no known value for a limit does not count as fitting it, and the search walks ' +
    'the nearest titles rather than all of them, so say none were found, not that none exist. ' +
    'Tell the user, and offer to relax a limit. Do not offer titles from a tool that was not ' +
    'given the same limits.'
  )
}

/** One section of a discovery answer, for the note below. */
export interface LimitedSection {
  label: string
  /** Titles this section had before the limits; null when it searched under them. */
  found: number | null
  shown: number
  /**
   * Whether the limits are why it is empty. The caller decides, because only it
   * knows the other reasons: no recommendation run, a failed search, a seed the
   * library does not hold, cards that all went to another section.
   */
  emptiedByLimits: boolean
}

/**
 * What a discovery turn's limits did to its sections.
 *
 * Without it a section the limits emptied looks exactly like one that was never
 * going to have anything, and the model cannot tell the user which it was. With
 * a wrong one it advises relaxing a limit that had nothing to do with it.
 */
export function discoveryLimitsNote(stated: string, sections: readonly LimitedSection[]): string {
  const lines = sections.map((section) => {
    if (section.shown === 0 && section.found == null && !section.emptiedByLimits) {
      return `${section.label}: nothing, and the limits are not why.`
    }
    return section.found != null
      ? `${section.label}: ${section.found} found in the library, ${section.shown} fit.`
      : `${section.label}: ${section.shown} fit.`
  })
  const empty = sections.every((section) => section.shown === 0)
  const emptied = sections.some((section) => section.emptiedByLimits)

  let closing: string | null = null
  if (empty && emptied) closing = noFitNote(stated)
  else if (empty) {
    closing =
      'Nothing came back, and the limits are not the reason, so do not suggest relaxing them. ' +
      'Say nothing turned up. Do not offer titles from a tool that was not given the same limits.'
  } else if (emptied) {
    closing = 'Say plainly, in one sentence, which sections came back empty because of the limits.'
  }
  return [`Every section was held to these limits: ${stated}.`, ...lines, closing]
    .filter(Boolean)
    .join(' ')
}

/** Notes that may each be absent, as one; null when all of them are. */
export function joinNotes(...notes: (string | null | undefined)[]): string | null {
  return notes.filter(Boolean).join(' ') || null
}

/**
 * Tools that take none of these limits, and so cannot be part of an answer held
 * to them. The prompt says so too, but "supplement the picks" and "fall back so
 * the user still gets something" are what the model is otherwise told these are
 * for, and an emptied answer is exactly when it reaches for them.
 */
const TOOLS_WITHOUT_LIMITS = new Set([
  'getTopRated',
  'getTopByRtScore',
  'getAwardWinners',
  'getUnwatched',
  'getMyRecommendations',
  'getContentRankings',
  'searchByKeyword',
  'findSimilarContent',
])
const TOOLS_WITH_LIMITS = new Set(['findCandidatesInLibrary', 'semanticSearch', 'searchMyRecommendations'])

/** The tools still on offer once a turn has stated limits. */
export function toolsUnderLimits<T extends string>(names: readonly T[]): T[] {
  return names.filter((name) => !TOOLS_WITHOUT_LIMITS.has(name))
}

interface StepToolRecord {
  toolCalls?: readonly { toolName: string; input?: unknown }[]
  toolResults?: readonly { output?: unknown }[]
}

/**
 * Whether any finished step of this turn stated a limit. A result's `limitsNote`
 * covers what only the discovery tool takes (film or show, unwatched) and a genre
 * left out; the input covers a library search that found plenty and has no note.
 */
export function turnStatedLimits(steps: readonly StepToolRecord[]): boolean {
  return steps.some(
    (step) =>
      (step.toolResults ?? []).some(
        (result) =>
          typeof result.output === 'object' &&
          result.output !== null &&
          typeof (result.output as { limitsNote?: unknown }).limitsNote === 'string'
      ) ||
      (step.toolCalls ?? []).some(
        (call) =>
          TOOLS_WITH_LIMITS.has(call.toolName) &&
          typeof call.input === 'object' &&
          call.input !== null &&
          hasTitleLimits(readTitleLimits(call.input))
      )
  )
}
