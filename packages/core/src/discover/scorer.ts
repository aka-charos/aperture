/**
 * Discovery Scorer
 * 
 * Scores and ranks discovery candidates using AI similarity and other factors
 */

import { createChildLogger } from '../lib/logger.js'
import { queryOne } from '../lib/db.js'
import { getEmbeddingInvocation } from '../lib/ai-provider.js'
import type { MediaType, RawCandidate, ScoredCandidate, DiscoveryConfig } from './types.js'
import { getUserFranchisePreferences, getUserTasteClusters } from '../taste-profile/index.js'
import { detectFranchiseFromTitle } from '../taste-profile/franchise.js'
import { applyPreferenceAdjustment } from '../recommender/shared/index.js'
import { resolveEmbeddingSpace } from '../recommender/centering.js'
import type { EmbeddingSpace } from '../recommender/centering.js'
import {
  getCandidateEmbeddings,
  getLibraryEmbeddingMean,
  isCenteringReadyForRun,
  centreVector,
} from './embeddings.js'
import { getMovieGenresList, getTVGenresList } from '../tmdb/index.js'

/**
 * The space the viewer's stored taste profile was built in.
 *
 * Read here rather than inferred: a profile is built once and read later, so
 * the two sides of the comparison are resolved at different times, and
 * `resolveEmbeddingSpace` is the only thing allowed to reconcile them. An
 * absent profile row reads as 'raw', matching what buildSpaceFor produces on an
 * instance that has never centred.
 */
async function getProfileEmbeddingSpace(
  userId: string,
  mediaType: MediaType
): Promise<EmbeddingSpace> {
  const row = await queryOne<{ embedding_space: string | null }>(
    `SELECT embedding_space FROM user_taste_profiles WHERE user_id = $1 AND media_type = $2`,
    [userId, mediaType]
  )
  return row?.embedding_space === 'centered' ? 'centered' : 'raw'
}

/**
 * TMDb genre id -> name, for the candidate document.
 *
 * Discovery candidates carry `{ id, name: '' }` from list responses and only
 * gain real names after full enrichment, but the document is built at scoring
 * time. Without this the "Genres:" line -- one of the strongest classification
 * signals in the library's canonical text -- would be missing from exactly the
 * candidates that have not been enriched yet. The list is small, static and
 * cached by the TMDb client.
 */
async function buildGenreNameLookup(mediaType: MediaType): Promise<(id: number) => string | undefined> {
  try {
    const genres = mediaType === 'movie' ? await getMovieGenresList() : await getTVGenresList()
    const byId = new Map(genres.map((g) => [g.id, g.name]))
    return (id: number) => byId.get(id)
  } catch (err) {
    logger.warn({ err, mediaType }, 'Could not load TMDb genre names for candidate documents')
    return () => undefined
  }
}

const logger = createChildLogger('discover:scorer')

/**
 * The vectors a discovery candidate gets scored against: the viewer's taste
 * clusters, or nothing.
 *
 * There is no fallback, and the deletion of the one that was here is the point.
 * It read `user_preferences.taste_embedding` -- a different table from
 * `user_taste_profiles`, written only by the two RECOMMENDER pipelines -- and
 * three things are true of that column and not of the clusters:
 *
 * 1. `rebuild-taste-profiles` never writes it. Nothing in `taste-profile/`
 *    mentions the column. So for the discover-only viewers F-104's gate fix
 *    just admitted, it is STILL unmaintained -- the same fault, one artefact
 *    over.
 * 2. It carries no `embedding_model`. `getUserTasteClusters` discards a stale
 *    model explicitly; this read had no way to.
 * 3. It carries no `embedding_space`. That column exists on
 *    `user_taste_profiles` alone (migration 0154), so `getProfileEmbeddingSpace`
 *    asked one table which space to use and the answer was applied to a vector
 *    from another table maintained by another job.
 *
 * Together those let the fallback hand back a vector from a superseded model,
 * in an unknown space, labelled `centered` by a row describing something else
 * -- and then the candidates were centred to match. The width guard in
 * `maxTasteSimilarity` catches a dimension change, but a same-width model
 * change (gemini-embedding-001 to -2, both 3072) passes it and produces a
 * confident cosine between two unrelated spaces. That is precisely what
 * `resolveEmbeddingSpace` exists to refuse, reached by a path that went around
 * it.
 *
 * No clusters therefore means no taste term and a neutral 0.5 for every
 * candidate -- the state the whole feature was in before F-104, and strictly
 * safer than a confident wrong number. The remedy is `rebuild-taste-profiles`,
 * which is also the remedy the job console now names.
 *
 * The recommender's own use of that column is different in kind and stays: it
 * writes the vector itself, in the same run, so the model and space are its
 * own.
 */
async function getUserTasteVectors(userId: string, mediaType: MediaType): Promise<number[][]> {
  try {
    const clusters = await getUserTasteClusters(userId, mediaType)
    if (clusters.length > 0) {
      return clusters.map((cluster) => cluster.embedding)
    }
    logger.warn(
      { userId, mediaType },
      'No taste clusters at the active embedding model; scoring without a taste term until rebuild-taste-profiles runs'
    )
  } catch (err) {
    logger.warn({ err, userId, mediaType }, 'Failed to load taste clusters')
  }

  return []
}

/**
 * Best cosine similarity between a candidate and any of the user's taste
 * vectors, normalized from [-1,1] to [0,1]. Returns null when there is nothing
 * comparable to score against.
 *
 * MAX -- not average, and not weighted by cluster weight -- mirroring
 * mergeClusterCandidatesByMaxSimilarity and getCustomInterestAffinity: a
 * candidate that strongly matches any one facet of someone's taste is a strong
 * match, and averaging here would recreate the very dilution the clusters were
 * built to avoid. Cluster weight decides how many candidates each facet
 * contributes during retrieval; there is no allocation happening here.
 */
export function maxTasteSimilarity(
  tasteVectors: number[][],
  candidateEmbedding: number[]
): number | null {
  if (tasteVectors.length === 0 || candidateEmbedding.length === 0) return null

  let best: number | null = null
  for (const vector of tasteVectors) {
    // Skip rather than score a dimension mismatch: cosineSimilarity returns 0
    // for one, which would read as a genuine "no match" and could beat a real
    // negative similarity from a usable vector.
    if (vector.length !== candidateEmbedding.length) continue

    const similarity = cosineSimilarity(vector, candidateEmbedding)
    if (best === null || similarity > best) best = similarity
  }

  return best === null ? null : (best + 1) / 2
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  
  let dotProduct = 0
  let normA = 0
  let normB = 0
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  return magnitude === 0 ? 0 : dotProduct / magnitude
}

/**
 * Normalize a value to 0-1 range using min-max scaling
 */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5
  return Math.max(0, Math.min(1, (value - min) / (max - min)))
}

/**
 * Min and max popularity across the candidate pool, measured once.
 *
 * This used to be computed inside a per-candidate function that received the
 * whole array -- so scoring n candidates allocated n throwaway arrays of
 * length n and scanned n² values. It was also a spread into Math.max, which
 * blows the argument limit outright on a large enough pool. The pool grows
 * every run (see getPoolCandidates), so this was getting worse over time.
 */
function popularityRange(values: number[]): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 0 }
  return { min, max }
}

/**
 * Observations before a source's popularity range is taken at full strength.
 *
 * Inherited from `genrePreference.ts` rather than re-derived: it damps the same
 * thing there (a thin watch history, a thin library section) for the same
 * reason, and one number doing one job in two places beats two numbers nobody
 * can compare. At 10 a group of 3 keeps 23% of its range and a group of 100
 * keeps 91%.
 */
const POPULARITY_CONFIDENCE = 10

/**
 * The source-quality term's weight in the blend.
 *
 * Exported because it is a real claimant on the score and two places need to
 * agree on it: `scoreCandidates` divides by a total that includes it, and the
 * admin panel's shares are wrong without it -- that card divided by the three
 * slider weights alone and so reported 50/30/20 for a blend that is actually
 * 45.5/27.3/18.2/9.1. A fourth term nobody can see is still spending the
 * budget.
 *
 * Fixed rather than configurable on purpose: it encodes how much to trust each
 * SOURCE, which is a property of the sources rather than of an instance.
 */
export const SOURCE_TERM_WEIGHT = 0.1

/**
 * Popularity scores, normalised WITHIN each source rather than across the pool.
 *
 * `candidate.popularity` does not hold one quantity. It holds TMDb's unbounded
 * popularity metric for the three TMDb sources, a Trakt watcher count (an
 * integer in the tens or hundreds) for trakt_trending, and a hardcoded 0 for
 * trakt_popular and trakt_recommendations, whose payloads carry no popularity
 * at all. Normalising all of that together meant TMDb's larger numbers set the
 * range, Trakt trending collapsed to near zero, and the other two scored
 * exactly zero -- on a term carrying a large share of the ranking. So the
 * source the code itself calls "most personalized", and hands the top source
 * score of 1.0, was systematically buried by the term beside it.
 *
 * Per-source min-max fixes both halves. Within trakt_trending the watcher
 * ordering is preserved and rescaled onto the same 0-1 as TMDb's. Within
 * trakt_popular and trakt_recommendations every value is identical, so
 * `normalize` returns 0.5 for all of them -- which is the honest answer: we have
 * no popularity signal for these titles, not "these titles are unpopular".
 *
 * The group is `popularitySource` -- who supplied the NUMBER -- and only falls
 * back to `source` for a candidate straight from a fetcher, where they are the
 * same thing. They diverge on a pool row: `sources` records every source that
 * ever offered the title while `popularity` holds whichever one last supplied a
 * figure, and the array's order was not even stable. Measured live, 16 of 279
 * pooled movies listed a Trakt source first while carrying a TMDb-scaled
 * number, so they were normalised inside a 4.13-point window instead of the
 * 873-point one they belong to: a title at popularity 33.01 scored 1.00 rather
 * than 0.006, on a term carrying 27% of the blend. Migration 0162 records the
 * provenance of the number so the unit and the label cannot drift.
 *
 * A THIN GROUP DOES NOT GET FULL RANGE. Min-max makes group size irrelevant to
 * the scale: a group of 3 and a group of 128 each produce exactly one 1.0 and
 * one 0.0, so being the most-watched of three Trakt trending titles scored
 * identically to being the most popular of 128. Measured on one live run --
 * tmdb_similar 128, tmdb_discover 112, tmdb_recommendations 100,
 * trakt_trending 3 -- and the three-member group's ceiling was an obscure TV
 * movie the taste model scored 0.30, sitting alongside Forrest Gump.
 *
 * Shrunk toward neutral by `n / (n + POPULARITY_CONFIDENCE)`, which is
 * `genrePreference.ts`'s treatment of the same shape of problem: a thin
 * population and a real signal look identical from inside the function, and the
 * safe direction is the one that claims less. It also generalises the existing
 * lone-candidate case rather than sitting beside it -- a group of one already
 * resolved to 0.5 because min equals max, and now a group of three is merely
 * most of the way there instead of all the way to the edges.
 *
 * It costs a little of popularity's realised spread (the 100+ groups keep about
 * 93% of theirs), which is worth naming because popularity was already
 * UNDER-delivering against its configured weight. That is a separate argument,
 * deliberately not settled here.
 *
 * Pure and exported so the neutral case can be pinned without a database.
 */
export function popularityScoresBySource(candidates: RawCandidate[]): Map<number, number> {
  // An unlabelled figure is its own group rather than being folded in with a
  // named one. That is the honest treatment of an unknown unit, and it is what
  // a pool row written before 0162 and not since re-upserted looks like.
  const groupOf = (c: RawCandidate): string => c.popularitySource ?? c.source

  const bySource = new Map<string, number[]>()
  for (const c of candidates) {
    const group = groupOf(c)
    const list = bySource.get(group)
    if (list) list.push(c.popularity)
    else bySource.set(group, [c.popularity])
  }

  const ranges = new Map<string, { min: number; max: number }>()
  for (const [source, values] of bySource) {
    ranges.set(source, popularityRange(values))
  }

  const scores = new Map<number, number>()
  for (const c of candidates) {
    const group = groupOf(c)
    const range = ranges.get(group) ?? { min: 0, max: 0 }
    const groupSize = bySource.get(group)?.length ?? 0
    const confidence = groupSize / (groupSize + POPULARITY_CONFIDENCE)
    const raw = normalize(c.popularity, range.min, range.max)
    scores.set(c.tmdbId, 0.5 + (raw - 0.5) * confidence)
  }
  return scores
}

/**
 * Every name one franchise can be known by here, lowercased.
 *
 * The two sides of the franchise comparison were built from different
 * vocabularies and so could never meet for movies. Stored preferences come from
 * detectMovieFranchises, which keys on `movies.collection_name` first -- TMDb
 * collection names like "The Avengers Collection" -- while this scorer
 * identifies a candidate with detectFranchiseFromTitle, which returns canonical
 * names like "Marvel Cinematic Universe". The lookup therefore missed on every
 * enriched library, and the nudge silently never fired for movies. Series were
 * unaffected, because detectSeriesFranchises uses the detector for both sides.
 *
 * Running BOTH sides through the same expansion bridges them: the detector maps
 * "The Avengers Collection" to the canonical name, and stripping the trailing
 * "Collection" covers franchises the regex table has no pattern for (a stored
 * "Alien Collection" then meets a candidate titled "Alien").
 *
 * Exported for the test that pins the bridge.
 */
export function franchiseKeys(name: string): string[] {
  const keys = new Set<string>()
  const lower = name.trim().toLowerCase()
  if (!lower) return []

  keys.add(lower)

  const stripped = lower.replace(/\s+collection$/, '').trim()
  if (stripped) keys.add(stripped)

  for (const candidate of [name, stripped]) {
    const canonical = candidate ? detectFranchiseFromTitle(candidate) : null
    if (canonical) keys.add(canonical.toLowerCase())
  }

  return [...keys]
}

/**
 * Rank each candidate by taste similarity, strongest first, 1-based.
 *
 * Pure and exported because both of its ways of being wrong are silent and
 * reach the user's screen: a rank starting at 0 renders "#0 of 245", and a sort
 * in the wrong direction confidently presents the WEAKEST match as the best
 * one. Neither is a type error and neither shows up in a log.
 *
 * Ties keep the input Map's order, which is the candidate array's, so the
 * result is deterministic between runs rather than depending on sort internals.
 */
export function tasteSimilarityRanks(rawSimilarities: Map<number, number>): Map<number, number> {
  const ranks = new Map<number, number>()
  const ordered = [...rawSimilarities.entries()].sort((a, b) => b[1] - a[1])
  ordered.forEach(([tmdbId], index) => ranks.set(tmdbId, index + 1))
  return ranks
}

/**
 * Half-life in years for the recency term. At 12 years a title scores 0.5, at
 * 24 years 0.25, and so on -- it keeps approaching zero without ever reaching
 * it, so older titles stay ordered relative to each other.
 */
const RECENCY_HALF_LIFE_YEARS = 12

/**
 * Recency score in (0, 1] -- newer content scores higher.
 *
 * Exponential decay rather than the previous `1 - age/10` clamped to zero. That
 * form had a hard cliff: every title ten years old or older scored exactly 0,
 * so a 1954 classic and a 2015 flop were indistinguishable on a term that
 * carries a meaningful share of the ranking, and no amount of quality could
 * separate them. Decay keeps a recency preference (which is defensible for a
 * "what should I add" feature) while leaving the back catalogue ranked.
 *
 * An unknown year scores as OLD, not as average. It previously returned 0.5,
 * which put missing metadata ahead of every real title released more than five
 * years ago -- absence of data was outranking known films.
 *
 * A future-dated release (an announced title) is clamped to the present rather
 * than scoring above 1.
 */
function calculateRecencyScore(candidate: RawCandidate): number {
  if (!candidate.releaseYear) return 0

  const currentYear = new Date().getFullYear()
  const age = Math.max(0, currentYear - candidate.releaseYear)

  return Math.pow(0.5, age / RECENCY_HALF_LIFE_YEARS)
}

/**
 * Calculate source score (0-1) based on source reliability/relevance
 */
function calculateSourceScore(candidate: RawCandidate): number {
  // Prioritize personalized sources over general ones
  const sourceScores: Record<string, number> = {
    'trakt_recommendations': 1.0, // Most personalized
    'tmdb_recommendations': 0.9, // Based on user's watched
    'tmdb_similar': 0.85, // Based on user's ratings
    'trakt_trending': 0.7, // Current popularity
    'trakt_popular': 0.6, // All-time popularity
    'tmdb_discover': 0.5, // General popularity
    'mdblist': 0.6, // Curated lists
  }
  
  return sourceScores[candidate.source] ?? 0.5
}

/**
 * What the taste term actually did on this run, in RAW units.
 *
 * Reported alongside the candidates rather than recovered from them, because
 * `ScoredCandidate.similarityScore` is the value AFTER min-max normalisation
 * across the pool -- so its minimum is 0 and its maximum is 1 by construction
 * whenever any two candidates differ at all. An operator-facing line built from
 * it reads `0.00-1.00` on every healthy run and cannot show the one failure it
 * exists to catch: the four-fault chain that made this term dead produced a raw
 * band 0.037 wide, which normalises to exactly the same confident full range.
 *
 * `compared` against `candidateCount` separates the two ways the term dies, and
 * that distinction cost five round trips to make by hand: well below the count
 * means the taste vectors could not be compared at all (a width mismatch, or an
 * unparsed halfvec), while equal to the count with `rawMin === rawMax` means
 * they compared and agreed, which is a different fault entirely.
 */
export interface TasteScoringDiagnostics {
  candidateCount: number
  compared: number
  /** Null when nothing was comparable. */
  rawMin: number | null
  rawMax: number | null
}

export interface DiscoveryScoringResult {
  candidates: ScoredCandidate[]
  taste: TasteScoringDiagnostics
}

/**
 * Score candidates based on similarity to user's taste and other factors
 */
export async function scoreCandidates(
  userId: string,
  mediaType: MediaType,
  candidates: RawCandidate[],
  config: DiscoveryConfig
): Promise<DiscoveryScoringResult> {
  if (candidates.length === 0) {
    return {
      candidates: [],
      taste: { candidateCount: 0, compared: 0, rawMin: null, rawMax: null },
    }
  }

  logger.info({ userId, mediaType, candidateCount: candidates.length }, 'Scoring candidates')

  // Get the user's taste vectors (one per cluster, or the legacy average)
  const tasteVectors = await getUserTasteVectors(userId, mediaType)

  // ---------------------------------------------------------------------
  // Candidate vectors
  //
  // This used to join `movies`/`series` on tmdb_id against the library
  // embedding table -- for candidates that filterCandidates had ALREADY removed
  // precisely because they have a row there. The match set was a strict subset
  // of the exclusion set, so the map was empty on every run and similarityScore
  // was the constant 0.5: 45.5% of the configured blend contributing zero
  // ranking variance, with popularity silently deciding half the order.
  //
  // A candidate is not in the library, so its vector has to be made rather than
  // found. getCandidateEmbeddings embeds from TMDb metadata and caches the
  // result per (media_type, tmdb_id, set id), shared across every user.
  // ---------------------------------------------------------------------
  const embeddingMap = new Map<number, number[]>()

  if (tasteVectors.length > 0) {
    try {
      const genreNameFor = await buildGenreNameLookup(mediaType)
      const raw = await getCandidateEmbeddings(mediaType, candidates, genreNameFor)

      // Which space the comparison happens in is the viewer's profile's
      // decision, not this function's. resolveEmbeddingSpace refuses rather
      // than mixing: a centred centroid against a raw candidate is a confident
      // cosine between two different spaces.
      const profileSpace = await getProfileEmbeddingSpace(userId, mediaType)
      const space = resolveEmbeddingSpace(profileSpace, await isCenteringReadyForRun(mediaType))

      if (space === null) {
        logger.warn(
          { userId, mediaType },
          'Taste profile is centred but the centred column is not ready; scoring without a taste term until it is rebuilt'
        )
      } else if (space === 'raw') {
        for (const [id, vector] of raw) embeddingMap.set(id, vector)
      } else {
        // Centred: a candidate has never been through refreshCenteredEmbeddings,
        // so this is the one place the library mean genuinely has to be
        // recomputed. Once per run, not once per candidate.
        const { setId } = await getEmbeddingInvocation()
        const mean = await getLibraryEmbeddingMean(mediaType, setId)
        if (!mean) {
          logger.warn({ mediaType }, 'No library mean available; skipping the taste term')
        } else {
          for (const [id, vector] of raw) {
            const centred = centreVector(vector, mean)
            if (centred) embeddingMap.set(id, centred)
          }
        }
      }

      logger.info(
        {
          userId,
          mediaType,
          candidateCount: candidates.length,
          embeddingsUsable: embeddingMap.size,
          tasteVectors: tasteVectors.length,
          space,
        },
        'Resolved candidate embeddings for taste scoring'
      )
    } catch (err) {
      // No taste term rather than no run. This is the state the feature was
      // permanently in before, so degrading to it is safe.
      logger.warn({ err, userId, mediaType }, 'Failed to build candidate embeddings')
    }
  }

  // Raw cosines crowd into a narrow band, so a candidate's absolute similarity
  // says little while its position says a lot. Normalising across the pool --
  // the same treatment popularity already gets -- is what makes the configured
  // weight buy the influence it claims. Measured only among candidates that HAVE
  // a vector, so titles we could not embed do not drag the floor down and
  // inflate everyone else.
  const rawSimilarities = new Map<number, number>()
  for (const candidate of candidates) {
    const vector = embeddingMap.get(candidate.tmdbId)
    if (!vector) continue
    const similarity = maxTasteSimilarity(tasteVectors, vector)
    if (similarity !== null) rawSimilarities.set(candidate.tmdbId, similarity)
  }
  // A loop rather than a spread into Math.min/Math.max. maxTotalCandidates is
  // an admin slider reaching 5000, and spreading an array that large throws
  // RangeError. Same pattern removed from popularityRange in this module.
  let similarityMin = Number.POSITIVE_INFINITY
  let similarityMax = Number.NEGATIVE_INFINITY
  for (const value of rawSimilarities.values()) {
    if (value < similarityMin) similarityMin = value
    if (value > similarityMax) similarityMax = value
  }
  if (!Number.isFinite(similarityMin) || !Number.isFinite(similarityMax)) {
    similarityMin = 0
    similarityMax = 0
  }

  // The raw figures, before normalisation flattens them into 0-1. Returned as
  // well as logged: the container log is not where an operator looks after a
  // deploy, which is the whole reason the job console needs these rather than
  // the normalised spread (see TasteScoringDiagnostics).
  const taste: TasteScoringDiagnostics = {
    candidateCount: candidates.length,
    compared: rawSimilarities.size,
    rawMin: rawSimilarities.size > 0 ? similarityMin : null,
    rawMax: rawSimilarities.size > 0 ? similarityMax : null,
  }

  logger.info({ userId, mediaType, ...taste }, 'Taste similarity measured')

  // Get user's franchise preferences for boosting
  // Note: Genre weights are not applied here since discovery uses TMDb genre IDs, not names
  const franchisePrefs = await getUserFranchisePreferences(userId, mediaType)

  // Build the lookup under every name a franchise can go by, because the two
  // sides of this comparison speak different vocabularies (see franchiseKeys).
  const franchiseScoreMap = new Map<string, number>()
  for (const pref of franchisePrefs) {
    for (const key of franchiseKeys(pref.franchiseName)) {
      // First writer wins, so a preference's own name beats a name it only
      // shares by derivation.
      if (!franchiseScoreMap.has(key)) franchiseScoreMap.set(key, pref.preferenceScore)
    }
  }

  // Both measured once over the pool, not per candidate.
  const popularityScores = popularityScoresBySource(candidates)

  // Where each candidate's taste similarity places among the candidates that
  // HAVE one, strongest first.
  //
  // The stored `similarityScore` is min-max normalised, so its top is 1.0 and
  // its bottom 0.0 by construction, and the detail card rendered that as a
  // percentage: the best candidate in every batch read "100% similarity" and
  // the worst "0%", whatever the real spread. Measured live that spread runs
  // 0.43-0.66 in raw terms -- cosines of about -0.15 to +0.32 -- so a card
  // claiming 0% was a hair behind one claiming 90%, and the same title read
  // differently in a different batch.
  //
  // A rank needs no calibration to be true, survives a model change, and is
  // what the number actually is. Carried in scoreBreakdown, which is JSONB with
  // additionalProperties through the API, so this costs no migration.
  // `similarityRaw` rides along for a future calibrated display; nothing shows
  // it yet, because a raw band that never leaves 0.43-0.66 has a false FLOOR in
  // exactly the way the normalised one has a false spread (see the cosine-band
  // invariant -- the distribution has to be measured before it can be scaled).
  const similarityRankOf = rawSimilarities.size
  const similarityRanks = tasteSimilarityRanks(rawSimilarities)

  const scoredCandidates: ScoredCandidate[] = candidates.map(candidate => {
    // Taste match against the user's best-matching facet, rescaled across the
    // pool. A candidate we could not embed scores 0.5 -- neutral, so a missing
    // vector neither promotes nor buries a title, which is what the whole pool
    // silently got before candidate embeddings existed.
    const rawSimilarity = rawSimilarities.get(candidate.tmdbId)
    const similarityScore =
      rawSimilarity === undefined
        ? 0.5
        : normalize(rawSimilarity, similarityMin, similarityMax)

    const popularityScore = popularityScores.get(candidate.tmdbId) ?? 0.5
    const recencyScore = calculateRecencyScore(candidate)
    const sourceScore = calculateSourceScore(candidate)

    // Calculate base score as a true weighted average (normalized by total
    // weight, including the flat 0.1 source-quality term) so it's always
    // bounded to [0,1] rather than able to run past 1.0 (0.5+0.3+0.2+0.1=1.1
    // if taken as a raw weighted sum).
    const sourceTermWeight = SOURCE_TERM_WEIGHT
    const totalWeight =
      config.similarityWeight + config.popularityWeight + config.recencyWeight + sourceTermWeight
    // DiscoveryConfig weights are currently fixed defaults (never exposed
    // through a settings API), so totalWeight <= 0 can't happen today — but
    // guard it anyway rather than assume that stays true.
    const baseScore =
      totalWeight <= 0
        ? (similarityScore + popularityScore + recencyScore + sourceScore) / 4
        : (similarityScore * config.similarityWeight +
            popularityScore * config.popularityWeight +
            recencyScore * config.recencyWeight +
            sourceScore * sourceTermWeight) /
          totalWeight

    // Apply franchise preference as a bounded nudge (not a raw multiplier —
    // see applyPreferenceAdjustment) so a loved franchise can't push the
    // score past 100%. Genre/interest dimensions aren't tracked here
    // (discovery candidates carry TMDb genre IDs, not names), so they're
    // passed as neutral no-ops.
    let franchiseAffinity = 0.5
    // Expanded the same way the stored names were, so the canonical name the
    // detector produces and the collection name the library recorded resolve to
    // a common key. Ordered, so the match is deterministic.
    for (const key of franchiseKeys(candidate.title)) {
      const prefScore = franchiseScoreMap.get(key)
      if (prefScore !== undefined) {
        // preference_score is stored clamped to -1..1 (see setFranchisePreference)
        franchiseAffinity = 0.5 + prefScore * 0.5
        break
      }
    }

    // No strength argument on purpose: this is the discovery pipeline, which
    // has its own configuration and does not read recommendation_config. It
    // keeps DEFAULT_PREFERENCE_STRENGTH so an admin tuning recommendations
    // cannot silently change what gets requested from Seerr.
    // Era is neutral here for the same reason genre and interest are: this is
    // the discovery pipeline, scoring titles the library does NOT hold. An era
    // affinity is built from what a viewer watched against what they were
    // offered, and neither half of that comparison exists for a title nobody
    // can watch yet.
    const finalScore = applyPreferenceAdjustment(baseScore, {
      franchise: franchiseAffinity,
      genre: 0.5,
      interest: 0.5,
      era: 0.5,
    })

    return {
      ...candidate,
      finalScore,
      similarityScore,
      popularityScore,
      recencyScore,
      sourceScore,
      scoreBreakdown: {
        similarity: similarityScore,
        popularity: popularityScore,
        recency: recencyScore,
        source: sourceScore,
        // Absent -- not zero -- for a candidate with no vector, which has no
        // place in a taste ranking at all. The card falls back to its old
        // display when these are missing, which is also what every row stored
        // before this change looks like.
        ...(rawSimilarity !== undefined && similarityRanks.has(candidate.tmdbId)
          ? {
              similarityRaw: rawSimilarity,
              similarityRank: similarityRanks.get(candidate.tmdbId)!,
              similarityRankOf,
            }
          : {}),
      },
      // isEnriched will be set by the pipeline after lazy enrichment
      isEnriched: false,
    }
  })

  // Sort by final score descending
  scoredCandidates.sort((a, b) => b.finalScore - a.finalScore)

  // No rank is assigned here on purpose. This used to write `rank` onto each
  // candidate through a cast, on a type that declares no such field and that
  // nobody reads: storeDiscoveryCandidates numbers the rows from its own loop
  // index, which is the only rank that reaches the database or the UI. Sorted
  // order is the contract of this function; position is the storage layer's.

  logger.info({
    userId,
    mediaType,
    inputCount: candidates.length,
    outputCount: scoredCandidates.length,
    topScore: scoredCandidates[0]?.finalScore.toFixed(3),
    bottomScore: scoredCandidates[scoredCandidates.length - 1]?.finalScore.toFixed(3),
  }, 'Scored and ranked candidates')

  // Return all scored candidates - limiting is done in the pipeline
  return { candidates: scoredCandidates, taste }
}

