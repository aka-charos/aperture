/**
 * Discovery Candidate Merge
 *
 * Personalized candidates take precedence over the shared pool, and the way
 * that precedence was expressed threw away everything the pool knew.
 *
 * `mergeWithPool` pushed the personalized object whole and skipped the pool row
 * entirely. A `trakt_recommendations` candidate is constructed with
 * `voteAverage: 0`, `voteCount: 0`, no poster path and no genres, because
 * Trakt's list payload carries none of that -- so when Trakt recommended a
 * title the pool already held with a real TMDb rating, poster, genre list and
 * cached cast, that row was discarded and the bare Trakt row won. The result
 * was that the highest-scoring source in the system (`trakt_recommendations`
 * carries source score 1.0, the one the code itself calls "most personalized")
 * was the one that reliably produced cards with a missing rating, and below
 * `maxEnrichedCandidates` a missing poster too.
 *
 * The earlier ratings work does not cover this. `NULLIF` fixed what the POOL
 * stores and `enrichBasicData`'s selection fixed what the POOL enriches; both
 * are correct, and this path never touches the pool row on its way past.
 *
 * Pure and import-free (the `RawCandidate` import is type-only and erased) so
 * the fill rules can be pinned without a database or a TMDb key -- the same
 * reason `seerrMapping.ts` exists.
 */

import type { RawCandidate } from './types.js'

/**
 * A personalized candidate with its empty fields filled in from the pool row
 * for the same title.
 *
 * Everything that says WHERE the candidate came from is kept from the
 * personalized side, because that is the whole point of the precedence:
 * `source` decides `calculateSourceScore`, and `sourceMediaId` records which of
 * the viewer's own titles produced the recommendation.
 *
 * `popularity` is kept from the personalized side too, and that one is not
 * obvious. The field does not hold one quantity -- it is TMDb's unbounded
 * metric for the TMDb sources, a Trakt watcher count for `trakt_trending`, and
 * a hardcoded 0 for `trakt_popular`/`trakt_recommendations` -- and
 * `popularityScoresBySource` normalises it within the group its unit names.
 * Taking the pool's number would import a TMDb-scaled value into a candidate
 * whose own unit is something else entirely.
 *
 * `popularitySource` therefore stays untouched alongside it. Both ride the
 * spread of `candidate` and neither is overridden below, which is what keeps
 * them paired -- the pairing migration 0162 exists to enforce. If a reason ever
 * appears to take the pool's popularity here, its `popularitySource` has to
 * come with it in the same expression.
 */
export function fillFromPoolRow(candidate: RawCandidate, pool: RawCandidate): RawCandidate {
  // The pool's cached cast is only trustworthy alongside the flag: enrichFullData
  // skips a candidate whose `isEnriched` is true, so claiming it without the
  // cast actually being there ships a blank card that nothing will ever fill.
  const poolIsEnriched = pool.isEnriched === true && (pool.castMembers?.length ?? 0) > 0

  return {
    ...candidate,

    // `||` rather than `??` throughout, matching enrichBasicData: an empty
    // string is as absent as a null here, and both occur.
    imdbId: candidate.imdbId || pool.imdbId || null,
    title: candidate.title || pool.title,
    originalTitle: candidate.originalTitle || pool.originalTitle || null,
    originalLanguage: candidate.originalLanguage || pool.originalLanguage || null,
    overview: candidate.overview || pool.overview || null,
    // `||` here too, and it is not the obvious choice. There is no year 0 in
    // the calendar, so a 0 can only be bad data -- and `calculateRecencyScore`
    // already reads it as unknown, since its guard is `!candidate.releaseYear`.
    // Keeping it over the pool's real year would preserve the worse value.
    releaseYear: candidate.releaseYear || pool.releaseYear || null,
    posterPath: candidate.posterPath || pool.posterPath || null,
    backdropPath: candidate.backdropPath || pool.backdropPath || null,

    // Matching the pool upsert's own rule, which treats `[]` as "no genres
    // supplied" rather than "this title has no genres".
    genres: candidate.genres && candidate.genres.length > 0 ? candidate.genres : (pool.genres ?? []),

    // 0 stands for "no vote data" everywhere in this module -- Trakt's payloads
    // carry none -- which is why this is `||` and not `??`.
    voteAverage: candidate.voteAverage || pool.voteAverage || 0,
    voteCount: candidate.voteCount || pool.voteCount || 0,

    castMembers:
      candidate.castMembers && candidate.castMembers.length > 0
        ? candidate.castMembers
        : pool.castMembers,
    directors:
      candidate.directors && candidate.directors.length > 0 ? candidate.directors : pool.directors,
    // Same argument as releaseYear: no title runs for 0 minutes, so a 0 is
    // absence rather than a measurement.
    runtimeMinutes: candidate.runtimeMinutes || pool.runtimeMinutes || null,
    tagline: candidate.tagline || pool.tagline || null,

    isEnriched: candidate.isEnriched === true || poolIsEnriched,

    // Without this the run re-pays for cast and crew the pool already bought,
    // and updatePoolEnrichmentBatch has no row to write the result back to.
    poolId: candidate.poolId ?? pool.poolId,
  }
}

/**
 * Merge personalized candidates with the shared pool, personalized first.
 *
 * Deduplicated by TMDb id in both directions: a personalized source can repeat
 * a title, and the pool can hold one the personalized fetch also returned.
 */
export function mergeWithPool(
  personalizedCandidates: RawCandidate[],
  poolCandidates: RawCandidate[]
): RawCandidate[] {
  const poolByTmdbId = new Map<number, RawCandidate>()
  for (const candidate of poolCandidates) {
    if (!poolByTmdbId.has(candidate.tmdbId)) poolByTmdbId.set(candidate.tmdbId, candidate)
  }

  const merged: RawCandidate[] = []
  const seenIds = new Set<number>()

  // Personalized first -- they take precedence, but now that means their
  // provenance wins rather than their gaps.
  for (const candidate of personalizedCandidates) {
    if (seenIds.has(candidate.tmdbId)) continue
    seenIds.add(candidate.tmdbId)

    const poolRow = poolByTmdbId.get(candidate.tmdbId)
    merged.push(poolRow ? fillFromPoolRow(candidate, poolRow) : candidate)
  }

  for (const candidate of poolCandidates) {
    if (seenIds.has(candidate.tmdbId)) continue
    seenIds.add(candidate.tmdbId)
    merged.push(candidate)
  }

  return merged
}
