/**
 * What the Watcher Identity is written FROM, selected and laid out for the model.
 *
 * The identity used to be written from a lookup table. The analyzer counted
 * genre tags, mapped whichever genres appeared in the viewer's top ten onto
 * fixed phrases ("drama" -> "heartwarming & emotional", "thriller" ->
 * "fast-paced" and "plot-twisting"), put threshold labels on two rates
 * ("> 15% favourited" -> "emotionally engaged") and banned every title. The
 * model was left with nothing it could say about one person that it could not
 * say about everyone with a thriller in their top ten, so it wrote a horoscope.
 *
 * Measured on a live instance (F-129), the input was also wrong in kind. It
 * counted `played OR is_favorite`, and favourites there are a watchlist: one
 * viewer's "44% favourite rate" was 175 unwatched bookmarks out of 183, and
 * another held 872 unwatched favourites against 159 played films.
 *
 * Four rules, each the inverse of a defect:
 *
 * 1. A title counts when the media server marks it PLAYED. The identity is a
 *    claim made to someone's face (F-114); a bookmark is not a watch.
 * 2. A preference is a SKEW against what the library offers, never a share of
 *    volume. Drama leads almost everyone's history because drama leads almost
 *    every library -- genrePreference.ts measured a 2.5-fold gap between the two.
 * 3. Titles and names travel with every pattern, so the model can be specific
 *    and a reader can check what it says.
 * 4. Nothing about HOW someone watches is offered unless it is measured. There
 *    is no session data, and `play_count > 1` is not a rewatch: live rows show
 *    more "rewatched" titles than played ones for the same viewer.
 *
 * Pure and DB-free so the selection and the document are pinned by a test.
 */

import { DISLIKED_RATING_MAX, LIKED_RATING_MIN } from '../recommender/ratingBands.js'

export type TasteMediaType = 'movie' | 'series'

export type TasteFacet = 'genre' | 'decade' | 'country' | 'director' | 'network' | 'keyword'

/**
 * Fewer played titles than this and there is nothing true to say, so nothing is
 * written. Not a measured number: what it guards against is an identity built
 * from three films, and erring high only makes a card wait a little longer.
 */
export const MIN_TITLES_FOR_SYNOPSIS: Record<TasteMediaType, number> = {
  movie: 5,
  series: 3,
}

/**
 * A facet carried by less than this share of the library, or of the viewer's own
 * titles, is left out. Measured live, production countries were present on 27%
 * of series against 99% of films -- and which series got them is not random, so
 * a skew computed inside that subset describes the enrichment, not the viewer.
 * Every other facet measured 88% or more.
 */
export const MIN_FACET_COVERAGE = 0.5

/** Example titles shown against one pattern. */
export const EXAMPLES_PER_PATTERN = 3
/**
 * Example titles fetched per label, more than are shown. Examples are ordered by
 * the viewer's own rating, so without spare candidates one 10/10 film heads
 * every pattern it belongs to -- measured live, a single favourite led the
 * examples of every facet -- and the document spends each title only once.
 */
export const EXAMPLE_CANDIDATES = 8
/** Example titles attached to the unfinished-films line. */
export const UNFINISHED_EXAMPLES = 6
/** Movies: a partial play untouched this long reads as left, not in progress. */
export const UNFINISHED_AFTER_DAYS = 30
/** Series: nothing played for this long means the viewer is not currently in it. */
export const STALLED_AFTER_DAYS = 90
export const MOSTLY_WATCHED_SHARE = 0.75
export const SAMPLED_SHARE = 0.25
/** A rating this far from IMDb's is a disagreement worth naming. */
export const CROWD_GAP = 2
/** Fewer ratings than this and an average describes nothing. */
export const MIN_RATINGS_FOR_AVERAGE = 5

const HIGHEST_RATED = 8
const LOWEST_RATED = 6
const CROWD_DISAGREEMENTS = 5
const PROGRESS_EXAMPLES = 4

/** Facets per media type, in the order the evidence presents them. */
export const FACETS_FOR: Record<TasteMediaType, TasteFacet[]> = {
  movie: ['genre', 'decade', 'country', 'director', 'keyword'],
  series: ['genre', 'decade', 'country', 'network', 'keyword'],
}

export interface FacetCount {
  facet: TasteFacet
  label: string
  /** The viewer's played titles carrying this label. */
  watched: number
  /** Titles in the viewer's libraries carrying it, theirs included. */
  available: number
  /** Candidate example titles from the viewer's history, best first. */
  examples: string[]
}

export interface FacetTotals {
  /** The viewer's played titles carrying at least one label of this facet. */
  watched: number
  /** Library titles carrying at least one label of this facet. */
  available: number
}

export interface RatedTitle {
  title: string
  year: number | null
  /** The viewer's own 1-10 rating. */
  rating: number
  /** IMDb (else the media server's community) rating; null when unknown, never 0. */
  crowdRating: number | null
}

export interface CrowdComparison {
  watchedMedianVotes: number | null
  libraryMedianVotes: number | null
  watchedMeanRating: number | null
  libraryMeanRating: number | null
}

export interface UnfinishedTitles {
  count: number
  examples: string[]
}

export interface SeriesProgress {
  title: string
  year: number | null
  /** Played episodes, specials excluded. */
  watched: number
  /** Episodes in the library, specials excluded. */
  total: number
  /** Whole days since an episode was last played; null when unknown. */
  daysSinceLastPlay: number | null
  /**
   * Library episodes (specials excluded) that had aired by the day of the last
   * play. Null when that cannot be known -- no last play, or any episode with no
   * air date -- because "stopped" is a claim about episodes that existed.
   */
  airedByLastPlay: number | null
  /**
   * The lowest season the viewer played part of but not all of (counting only
   * episodes aired by their last play); null when every season they started is
   * complete. Only meaningful when `airedByLastPlay` is known.
   */
  unfinishedSeason: number | null
}

export interface TasteEvidence {
  mediaType: TasteMediaType
  /** Played titles in the libraries the viewer draws from. */
  watchedTotal: number
  /** Titles in those libraries. */
  libraryTotal: number
  facets: FacetCount[]
  facetTotals: Partial<Record<TasteFacet, FacetTotals>>
  rated: RatedTitle[]
  crowd: CrowdComparison | null
  /** Movies only. */
  unfinished: UnfinishedTitles | null
  /** Series only. */
  progress: SeriesProgress[] | null
}

// ============================================================================
// Skews
// ============================================================================

interface FacetRule {
  /** Fewest of the viewer's titles that may carry an over-selection. */
  minWatched: number
  /** Shrinkage constant: a skew backed by n titles keeps n/(n+K) of its size. */
  shrinkK: number
  overLimit: number
  /** 0 means avoidance is never reported (nobody "avoids" a director). */
  underLimit: number
  /** An avoided label must be at least this share of the library to be named. */
  minUnderShare: number
}

/**
 * Per-facet selection. The shrinkage constants differ because the facets differ
 * in size: genre's 10 is genrePreference.ts's constant for the same problem,
 * while a director with four films on the shelf could never clear it.
 */
export const FACET_RULES: Record<TasteFacet, FacetRule> = {
  genre: { minWatched: 3, shrinkK: 10, overLimit: 5, underLimit: 4, minUnderShare: 0.03 },
  decade: { minWatched: 3, shrinkK: 10, overLimit: 3, underLimit: 2, minUnderShare: 0.05 },
  country: { minWatched: 3, shrinkK: 5, overLimit: 5, underLimit: 2, minUnderShare: 0.05 },
  director: { minWatched: 3, shrinkK: 3, overLimit: 8, underLimit: 0, minUnderShare: 1 },
  network: { minWatched: 2, shrinkK: 3, overLimit: 5, underLimit: 0, minUnderShare: 1 },
  keyword: { minWatched: 4, shrinkK: 5, overLimit: 10, underLimit: 0, minUnderShare: 1 },
}

/**
 * A skew smaller than 1.25x either way is not a pattern worth a sentence. The
 * failure is asymmetric toward the safe side: set too high, the model gets less
 * to say and writes less; set too low, it gets noise and presents it as taste.
 */
export const MIN_SKEW_SCORE = Math.log2(1.25)

/** Ratios are multiplicative, so the score works in log2 space, clamped at 8x. */
const LOG_CLAMP = 3
/** Keeps a never-watched label finite without inventing much evidence. */
const SMOOTHING = 0.5

export function isTasteFacet(value: string): value is TasteFacet {
  return Object.prototype.hasOwnProperty.call(FACET_RULES, value)
}

/**
 * How far one label's count sits from what the library's share predicts.
 *
 * `ratio` is the plain answer (their count over the expected count, 1 meaning
 * exactly as offered) and is what gets printed. `score` is what gets ranked: a
 * smoothed log2 ratio shrunk by the evidence behind it. The weight is the larger
 * of the count seen and the count expected, because the evidence for "never
 * watches westerns" is how many westerns they would have watched by now, which
 * is the expected count, while the evidence for "keeps watching Melville" is the
 * films actually watched.
 */
export function skewOf(
  watched: number,
  available: number,
  watchedTotal: number,
  availableTotal: number,
  shrinkK: number
): { ratio: number; score: number } | null {
  if (![watched, available, watchedTotal, availableTotal, shrinkK].every(Number.isFinite)) {
    return null
  }
  if (watchedTotal <= 0 || availableTotal <= 0 || available <= 0 || watched < 0) return null

  const expected = watchedTotal * (available / availableTotal)
  const log = Math.max(
    -LOG_CLAMP,
    Math.min(LOG_CLAMP, Math.log2((watched + SMOOTHING) / (expected + SMOOTHING)))
  )
  const n = Math.max(watched, expected)

  return { ratio: watched / expected, score: log * (n / (n + shrinkK)) }
}

export interface Skew {
  label: string
  watched: number
  available: number
  watchedShare: number
  availableShare: number
  ratio: number
  score: number
  examples: string[]
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** The labels this viewer picks distinctly more, and distinctly less, than offered. */
export function rankFacetSkews(
  facet: TasteFacet,
  rows: FacetCount[],
  totals: FacetTotals
): { over: Skew[]; under: Skew[] } {
  const rule = FACET_RULES[facet]
  const skews: Skew[] = []

  for (const row of rows) {
    if (row.facet !== facet) continue
    const skew = skewOf(row.watched, row.available, totals.watched, totals.available, rule.shrinkK)
    if (!skew) continue
    skews.push({
      label: row.label,
      watched: row.watched,
      available: row.available,
      watchedShare: row.watched / totals.watched,
      availableShare: row.available / totals.available,
      ratio: skew.ratio,
      score: skew.score,
      examples: row.examples,
    })
  }

  const over = skews
    .filter((s) => s.watched >= rule.minWatched && s.score >= MIN_SKEW_SCORE)
    .sort((a, b) => b.score - a.score || b.watched - a.watched || compareText(a.label, b.label))
    .slice(0, rule.overLimit)

  const under =
    rule.underLimit === 0
      ? []
      : skews
          .filter((s) => s.availableShare >= rule.minUnderShare && s.score <= -MIN_SKEW_SCORE)
          .sort(
            (a, b) => a.score - b.score || b.available - a.available || compareText(a.label, b.label)
          )
          .slice(0, rule.underLimit)

  return { over, under }
}

/**
 * Whether a facet is carried widely enough, on both sides, to compare at all.
 * Both halves matter: a facet on 90% of the library but 30% of the viewer's
 * titles is as unrepresentative as the reverse.
 */
export function facetIsCovered(
  totals: FacetTotals,
  watchedTotal: number,
  libraryTotal: number
): boolean {
  if (!(watchedTotal > 0) || !(libraryTotal > 0)) return false
  return (
    totals.watched / watchedTotal >= MIN_FACET_COVERAGE &&
    totals.available / libraryTotal >= MIN_FACET_COVERAGE
  )
}

// ============================================================================
// Ratings and progress
// ============================================================================

export interface RatingSummary {
  count: number
  /** Null below MIN_RATINGS_FOR_AVERAGE. */
  mean: number | null
  /** Their average against IMDb's on the titles IMDb also rates. */
  versusCrowd: { count: number; theirs: number; crowd: number } | null
  highest: RatedTitle[]
  lowest: RatedTitle[]
  aboveCrowd: RatedTitle[]
  belowCrowd: RatedTitle[]
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export function summariseRatings(rated: RatedTitle[]): RatingSummary {
  const valid = rated.filter((r) => Number.isFinite(r.rating))
  // A missing crowd rating is not a crowd rating of 0 -- treated as one, every
  // unrated obscurity would read as the viewer loving something the world hates.
  const paired = valid.filter(
    (r): r is RatedTitle & { crowdRating: number } =>
      r.crowdRating != null && Number.isFinite(r.crowdRating)
  )
  const gap = (r: { rating: number; crowdRating: number }) => r.rating - r.crowdRating

  return {
    count: valid.length,
    mean: valid.length >= MIN_RATINGS_FOR_AVERAGE ? mean(valid.map((r) => r.rating)) : null,
    versusCrowd:
      paired.length >= MIN_RATINGS_FOR_AVERAGE
        ? {
            count: paired.length,
            theirs: mean(paired.map((r) => r.rating)),
            crowd: mean(paired.map((r) => r.crowdRating)),
          }
        : null,
    highest: valid
      .filter((r) => r.rating >= LIKED_RATING_MIN)
      .sort((a, b) => b.rating - a.rating || compareText(a.title, b.title))
      .slice(0, HIGHEST_RATED),
    lowest: valid
      .filter((r) => r.rating <= DISLIKED_RATING_MAX)
      .sort((a, b) => a.rating - b.rating || compareText(a.title, b.title))
      .slice(0, LOWEST_RATED),
    aboveCrowd: paired
      .filter((r) => gap(r) >= CROWD_GAP)
      .sort((a, b) => gap(b) - gap(a) || compareText(a.title, b.title))
      .slice(0, CROWD_DISAGREEMENTS),
    belowCrowd: paired
      .filter((r) => gap(r) <= -CROWD_GAP)
      .sort((a, b) => gap(a) - gap(b) || compareText(a.title, b.title))
      .slice(0, CROWD_DISAGREEMENTS),
  }
}

export interface ProgressSummary {
  finished: SeriesProgress[]
  inProgress: SeriesProgress[]
  /** Watched everything that had aired by their last episode; more has arrived since. */
  caughtUp: SeriesProgress[]
  /** Completed every season they started and did not begin the next. */
  seasonsDone: SeriesProgress[]
  mostly: SeriesProgress[]
  leftPartway: SeriesProgress[]
  leftEarly: SeriesProgress[]
}

/**
 * Where a viewer stands in each show they started.
 *
 * "Stopped" is the claim this is built to get right, and it takes two tests.
 * First, against episodes that had AIRED by their last play: measured live, 9 of
 * 16 and 18 of 19 read as abandoned when the viewer had watched everything that
 * existed at the time. Second, against the seasons they STARTED: air date is not
 * the date a library acquired a season, and nothing stores that -- so 8 of 24
 * with every season aired can still be one finished season on a server that got
 * the rest later. Only a season begun and left incomplete is a stop, because a
 * library acquires seasons whole. When airing cannot be known a show is placed
 * only where its share of today's total decides it, and never called stopped.
 */
export function summariseSeriesProgress(rows: SeriesProgress[]): ProgressSummary {
  const summary: ProgressSummary = {
    finished: [],
    inProgress: [],
    caughtUp: [],
    seasonsDone: [],
    mostly: [],
    leftPartway: [],
    leftEarly: [],
  }

  for (const row of rows) {
    if (!(row.total > 0) || !(row.watched > 0)) continue
    const days = row.daysSinceLastPlay
    const aired = row.airedByLastPlay
    const share = row.watched / row.total

    if (row.watched >= row.total) summary.finished.push(row)
    else if (days != null && days < STALLED_AFTER_DAYS) summary.inProgress.push(row)
    else if (days == null || aired == null || !(aired > 0)) {
      if (share >= MOSTLY_WATCHED_SHARE) summary.mostly.push(row)
    } else if (row.watched >= aired) summary.caughtUp.push(row)
    else if (row.unfinishedSeason == null) summary.seasonsDone.push(row)
    else if (share >= MOSTLY_WATCHED_SHARE) summary.mostly.push(row)
    else if (row.watched / aired < SAMPLED_SHARE) summary.leftEarly.push(row)
    else summary.leftPartway.push(row)
  }

  const byCommitment = (a: SeriesProgress, b: SeriesProgress) =>
    b.total - a.total || compareText(a.title, b.title)
  for (const list of Object.values(summary)) list.sort(byCommitment)

  return summary
}

// ============================================================================
// The document
// ============================================================================

const NOUNS: Record<TasteMediaType, { plural: string; heading: string }> = {
  movie: { plural: 'films', heading: 'FILMS' },
  series: { plural: 'shows', heading: 'TV SERIES' },
}

const FACET_NAMES: Record<TasteFacet, string> = {
  genre: 'Genres',
  decade: 'Release decades',
  country: 'Production countries',
  director: 'Directors',
  network: 'Networks',
  keyword: 'Recurring subjects (TMDb keywords)',
}

/** Facets whose labels are too small for shares, reported as counts instead. */
const COUNT_FORM: ReadonlySet<TasteFacet> = new Set(['director', 'network'])

function formatInt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

function formatPercent(share: number): string {
  const pct = share * 100
  if (pct > 0 && pct < 1) return '<1%'
  return `${Math.round(pct)}%`
}

function formatRatio(ratio: number): string {
  if (ratio >= 10) return `${Math.round(ratio)}×`
  if (ratio >= 0.1) return `${ratio.toFixed(1)}×`
  return `${ratio.toFixed(2)}×`
}

function quote(title: string): string {
  return `"${title}"`
}

function exampleSuffix(examples: string[]): string {
  return examples.length > 0 ? ` — e.g. ${examples.map(quote).join(', ')}` : ''
}

/**
 * Up to EXAMPLES_PER_PATTERN candidates not already shown against an earlier
 * pattern, in section order. A pattern whose every candidate has been used still
 * gets one, since a skew with no title beside it is the unverifiable claim this
 * document exists to avoid.
 */
function pickExamples(candidates: string[], used: Set<string>): string[] {
  const fresh = candidates.filter((t) => !used.has(t)).slice(0, EXAMPLES_PER_PATTERN)
  const picked = fresh.length > 0 ? fresh : candidates.slice(0, 1)
  for (const title of picked) used.add(title)
  return picked
}

function shareLine(s: Skew, plural: string, examples: string[]): string {
  if (s.watched === 0) {
    return `- ${s.label}: none of their ${plural} vs ${formatPercent(s.availableShare)} of the library`
  }
  return (
    `- ${s.label}: ${formatPercent(s.watchedShare)} of their ${plural} vs ` +
    `${formatPercent(s.availableShare)} of the library (${formatRatio(s.ratio)})` +
    exampleSuffix(examples)
  )
}

function facetSection(evidence: TasteEvidence, facet: TasteFacet, used: Set<string>): string[] {
  const totals = evidence.facetTotals[facet]
  if (!totals || totals.watched <= 0 || totals.available <= 0) return []
  if (!facetIsCovered(totals, evidence.watchedTotal, evidence.libraryTotal)) return []

  const { plural } = NOUNS[evidence.mediaType]
  const name = FACET_NAMES[facet]
  const { over, under } = rankFacetSkews(facet, evidence.facets, totals)
  const lines: string[] = []

  if (over.length > 0) {
    if (COUNT_FORM.has(facet)) {
      lines.push(`${name} they return to (their ${plural} / the library's ${plural}):`)
      for (const s of over) lines.push(`- ${s.label}: ${s.watched} of ${s.available}`)
    } else {
      lines.push(
        `${name} they choose MORE often than the library offers (share of their ${plural} vs share of the library):`
      )
      for (const s of over) lines.push(shareLine(s, plural, pickExamples(s.examples, used)))
    }
  }

  if (under.length > 0) {
    lines.push(`${name} they choose LESS often than the library offers:`)
    for (const s of under) lines.push(shareLine(s, plural, []))
  }

  // Said explicitly, because genre is where a model with nothing to go on will
  // invent a pattern -- and "their mix matches the library" is itself a finding.
  if (facet === 'genre' && over.length === 0 && under.length === 0) {
    lines.push(`Genres: close to the library's own mix; no genre stands out.`)
  }

  return lines.length > 0 ? [...lines, ''] : []
}

function crowdSection(evidence: TasteEvidence): string[] {
  const crowd = evidence.crowd
  if (!crowd) return []
  const { plural } = NOUNS[evidence.mediaType]
  const lines: string[] = []

  if (crowd.watchedMedianVotes != null && crowd.libraryMedianVotes != null) {
    lines.push(
      `- Median IMDb vote count: ${formatInt(crowd.watchedMedianVotes)} for their ${plural} vs ` +
        `${formatInt(crowd.libraryMedianVotes)} across the library.`
    )
  }
  if (crowd.watchedMeanRating != null && crowd.libraryMeanRating != null) {
    lines.push(
      `- Average IMDb rating: ${crowd.watchedMeanRating.toFixed(1)} for their ${plural} vs ` +
        `${crowd.libraryMeanRating.toFixed(1)} across the library.`
    )
  }

  return lines.length > 0 ? [`How their ${plural} compare with the library:`, ...lines, ''] : []
}

function ratedTitle(r: RatedTitle, withCrowd: boolean): string {
  const base = `${quote(r.title)}${r.year != null ? ` (${r.year})` : ''} ${r.rating}/10`
  return withCrowd && r.crowdRating != null ? `${base} vs IMDb ${r.crowdRating.toFixed(1)}` : base
}

function ratingsSection(evidence: TasteEvidence): string[] {
  const summary = summariseRatings(evidence.rated)
  // Stated when absent, so "how they rate" cannot be filled in from nothing.
  if (summary.count === 0) return ['Their own ratings: none recorded.', '']

  const lines = [
    summary.mean != null
      ? `Their own ratings (1-10): ${summary.count} titles, average ${summary.mean.toFixed(1)}.`
      : `Their own ratings (1-10): ${summary.count} titles.`,
  ]
  if (summary.versusCrowd) {
    const { count, theirs, crowd } = summary.versusCrowd
    lines.push(
      `- On the ${count} of those IMDb also rates: they average ${theirs.toFixed(1)}, IMDb ${crowd.toFixed(1)}.`
    )
  }
  const list = (label: string, titles: RatedTitle[], withCrowd: boolean) => {
    if (titles.length > 0) {
      lines.push(`- ${label}: ${titles.map((t) => ratedTitle(t, withCrowd)).join('; ')}`)
    }
  }
  list('Rated highest', summary.highest, false)
  list('Rated lowest', summary.lowest, false)
  list('Rated well above IMDb', summary.aboveCrowd, true)
  list('Rated well below IMDb', summary.belowCrowd, true)

  return [...lines, '']
}

function unfinishedSection(evidence: TasteEvidence): string[] {
  const unfinished = evidence.unfinished
  if (!unfinished || unfinished.count <= 0) return []
  const { plural } = NOUNS[evidence.mediaType]
  return [
    `Started but not finished (partly played, untouched for over ${UNFINISHED_AFTER_DAYS} days): ` +
      `${formatInt(unfinished.count)} ${plural}${exampleSuffix(unfinished.examples)}`,
    '',
  ]
}

function progressSection(evidence: TasteEvidence): string[] {
  if (!evidence.progress || evidence.progress.length === 0) return []
  const p = summariseSeriesProgress(evidence.progress)

  const ofTotal = (s: SeriesProgress) => `${s.watched} of ${s.total}`
  const stoppedAt = (s: SeriesProgress) =>
    `${s.watched} of ${s.airedByLastPlay} aired by then; left season ${s.unfinishedSeason} unfinished`
  const row = (
    label: string,
    shows: SeriesProgress[],
    detail: (s: SeriesProgress) => string
  ): string | null =>
    shows.length === 0
      ? null
      : `- ${label}: ${shows.length} — e.g. ` +
        shows
          .slice(0, PROGRESS_EXAMPLES)
          .map((s) => `${quote(s.title)} (${detail(s)})`)
          .join(', ')

  const mostly = formatPercent(MOSTLY_WATCHED_SHARE)
  const sampled = formatPercent(SAMPLED_SHARE)
  const stalled = `nothing played in ${STALLED_AFTER_DAYS} days`
  const lines = [
    row('Finished every episode', p.finished, ofTotal),
    row(`In progress (played in the last ${STALLED_AFTER_DAYS} days)`, p.inProgress, ofTotal),
    row('Caught up when they last watched; more episodes have arrived since', p.caughtUp, ofTotal),
    row('Finished every season they started, and have not begun the next', p.seasonsDone, ofTotal),
    row(`Most of the way (${mostly} or more)`, p.mostly, ofTotal),
    row(`Stopped partway (${sampled}-${mostly} of what had aired, ${stalled})`, p.leftPartway, stoppedAt),
    row(`Stopped early (under ${sampled} of what had aired, ${stalled})`, p.leftEarly, stoppedAt),
  ].filter((line): line is string => line !== null)

  return lines.length > 0
    ? ['How far they get into a show (episodes in the library, specials excluded):', ...lines, '']
    : []
}

/** The document the model writes the identity from. */
export function formatTasteEvidence(evidence: TasteEvidence): string {
  const { plural, heading } = NOUNS[evidence.mediaType]
  const lines: string[] = [`=== VIEWING RECORD: ${heading} ===`]

  lines.push(
    `Watched: ${formatInt(evidence.watchedTotal)} of the ${formatInt(evidence.libraryTotal)} ${plural} ` +
      `in the libraries they draw from` +
      (evidence.mediaType === 'series' ? ' (a show counts once any episode has been played).' : '.')
  )
  lines.push(
    'Counted: only titles the media server marks as played. Favourites they have not watched are left out.'
  )
  lines.push('')

  const usedExamples = new Set<string>()
  for (const facet of FACETS_FOR[evidence.mediaType]) {
    lines.push(...facetSection(evidence, facet, usedExamples))
  }
  lines.push(...crowdSection(evidence))
  lines.push(...ratingsSection(evidence))
  lines.push(...unfinishedSection(evidence))
  lines.push(...progressSection(evidence))
  lines.push('=== END ===')

  return lines.join('\n')
}
