// Re-organized pipeline - imports from modular files
import { createChildLogger } from '../../lib/logger.js'
import { query, queryOne } from '../../lib/db.js'
import {
  generateExplanations,
  storeExplanations,
  type MovieForExplanation,
} from './explanations.js'
import {
  createJobProgress,
  updateJobProgress,
  setJobStep,
  addLog,
  completeJob,
  failJob,
} from '../../jobs/progress.js'
import { randomUUID } from 'crypto'

// Import from modular files
import { loadConfigForUser } from '../config.js'
import { getWatchHistory, buildTasteProfile as buildLegacyTasteProfile, storeTasteProfile as storeLegacyTasteProfile, getUserMovieRatings, getDislikedMovieIds } from './taste.js'
import { getCandidates, getMultiClusterCandidates, getInterestMatchIndex } from './candidates.js'
import { scoreCandidates } from './scoring.js'
import { applyDiversityAndSelect } from './selection.js'
import {
  storeCandidates,
  storeEvidence,
  finalizeRun,
  createRecommendationRun,
  clearUserRecommendations,
  clearAllRecommendations,
  getMovieOverviews,
} from '../storage.js'
import { syncWatchHistoryForUser } from './sync.js'
import {
  shouldRegenerateRecommendations,
  pruneOldRecommendationRuns,
  RECOMMENDATION_RUNS_TO_KEEP,
} from '../activityGate.js'

// New taste profile system
import {
  getUserTasteProfile,
  storeTasteProfile as storeNewTasteProfile,
  getUserTasteClusters,
  getFranchiseAffinityMap,
  getUserGenreWeights,
  buildGenreWeightMap,
  genreAffinityFromWeights,
  getUserCustomInterests,
  detectAndUpdateFranchises,
} from '../../taste-profile/index.js'
import { getItemFranchises } from '../../taste-profile/franchise.js'
import {
  applyPreferenceAdjustment,
  buildGenreFamiliarity,
  computeReservedInterestSlots,
  pickInterestSlotFillers,
  summarizeScoreComponents,
  type InterestCandidateMatch,
  type InterestMatchIndex,
} from '../shared/index.js'
import { getWatchedGenreCounts } from '../genreFamiliarity.js'
import { getWatchedYears, summarizeEraFit } from '../eraDiagnostics.js'
import { getEffectiveAiExplanationSetting } from '../../lib/userSettings.js'

// Re-export types
export * from '../types.js'

// Re-export functions for backwards compatibility
export { loadConfig } from '../config.js'
export { getWatchHistory, buildTasteProfile as buildLegacyTasteProfile, storeTasteProfile as storeLegacyTasteProfile, getUserMovieRatings, getDislikedMovieIds } from './taste.js'
// Also export as original names for backwards compatibility
export { buildTasteProfile, storeTasteProfile } from './taste.js'
export { getCandidates } from './candidates.js'
export { scoreCandidates } from './scoring.js'
export { applyDiversityAndSelect } from './selection.js'
export {
  storeCandidates,
  storeEvidence,
  finalizeRun,
  clearUserRecommendations,
  clearAllRecommendations,
} from '../storage.js'

import type { User, Candidate, PipelineConfig } from '../types.js'

const logger = createChildLogger('recommender')

export interface GenerateRecommendationsOptions {
  /**
   * Skip the whole pipeline when no input has moved since the last completed
   * run (see recommender/activityGate.ts). Off by default so every existing
   * caller keeps today's behaviour — only the scheduled all-users job opts in,
   * since a person who pressed "regenerate" is asking for work to happen.
   */
  skipIfUnchanged?: boolean
}

/**
 * Generate recommendations for a user
 *
 * `runId` is null when the activity gate skipped the user: no run row is
 * written at all, because /api/recommendations serves the newest *completed*
 * run and an empty one would blank the page.
 */
export async function generateRecommendationsForUser(
  user: User,
  configOverrides: Partial<PipelineConfig> = {},
  options: GenerateRecommendationsOptions = {}
): Promise<{ runId: string | null; recommendations: Candidate[]; skipped?: boolean }> {
  // Load user-specific config (applies user overrides if enabled, falls back to admin defaults)
  const dbConfig = await loadConfigForUser(user.id, 'movie')
  const cfg = { ...dbConfig, ...configOverrides }
  const startTime = Date.now()

  logger.info({ userId: user.id, username: user.username }, '🎬 Starting recommendation generation')

  // 0. Sync watch history from media server to ensure we have latest data.
  // Ahead of both the activity gate and the run record: the gate reads
  // watch_history, so syncing after it would judge the user on stale data and
  // skip someone who watched something this morning.
  if (user.providerUserId) {
    logger.info({ userId: user.id }, '🔄 Syncing watch history before recommendations (full sync)...')
    try {
      // Use full sync to catch any items that may have been missed by delta syncs
      await syncWatchHistoryForUser(user.id, user.providerUserId, true)
      logger.info({ userId: user.id }, '✅ Watch history synced')
    } catch (err) {
      logger.warn({ err, userId: user.id }, '⚠️ Watch history sync failed, continuing with existing data')
    }
  }

  // 0b. Nothing changed since last time? Then the answer would be the same one
  // already stored, and generating it again costs a full retrieval pass plus an
  // LLM call per batch of explanations.
  if (options.skipIfUnchanged) {
    const decision = await shouldRegenerateRecommendations(user.id, 'movie')
    if (!decision.regenerate) {
      logger.info(
        { userId: user.id, username: user.username, lastRunAt: decision.lastRunAt },
        '⏭️ No new activity since last run, keeping existing recommendations'
      )
      return { runId: null, recommendations: [], skipped: true }
    }
    logger.info(
      { userId: user.id, reason: decision.reason, changedAt: decision.changedAt },
      `🔎 Regenerating: ${decision.reason}`
    )
  }

  // Create recommendation run record
  const runId = await createRecommendationRun(user.id)
  logger.info({ runId }, '📝 Created recommendation run record')

  try {
    // 1. Get user's recommendation preferences
    const userPrefs = await queryOne<{ include_watched: boolean; dislike_behavior: string }>(
      `SELECT include_watched, COALESCE(dislike_behavior, 'exclude') as dislike_behavior FROM user_preferences WHERE user_id = $1`,
      [user.id]
    )
    const includeWatched = userPrefs?.include_watched ?? false
    const dislikeBehavior = userPrefs?.dislike_behavior ?? 'exclude'
    logger.info(
      { userId: user.id, includeWatched, dislikeBehavior },
      `📋 User preferences: include_watched=${includeWatched}, dislike_behavior=${dislikeBehavior}`
    )

    // 2. Get user's watch history and ratings (now from synced data)
    logger.info({ userId: user.id }, '📊 Fetching watch history and ratings...')
    const [watched, userRatings, dislikedIds] = await Promise.all([
      getWatchHistory(user.id, cfg.recentWatchLimit),
      getUserMovieRatings(user.id),
      dislikeBehavior === 'exclude' ? getDislikedMovieIds(user.id) : Promise.resolve(new Set<string>()),
    ])
    logger.info(
      { userId: user.id, watchedCount: watched.length, ratingsCount: userRatings.size, dislikedCount: dislikedIds.size },
      `Found ${watched.length} watched movies, ${userRatings.size} ratings, ${dislikedIds.size} disliked`
    )

    if (watched.length === 0) {
      logger.warn(
        { userId: user.id },
        '⚠️ User has no watch history - cannot generate recommendations'
      )
      // Not 'completed': see the note on finalizeRun's status at the bottom of
      // this function. An empty run marked completed becomes the newest one the
      // API will serve and blanks whatever the user already had.
      await finalizeRun(
        runId,
        0,
        0,
        Date.now() - startTime,
        'failed',
        'No watch history for this user'
      )
      return { runId, recommendations: [] }
    }

    // 2. Get or build taste profile using the new persistent system
    logger.info({ userId: user.id }, '🧠 Getting taste profile...')
    
    // Try to get stored profile first (will rebuild if stale)
    const storedProfile = await getUserTasteProfile(user.id, 'movie')
    let tasteProfile: number[] | null = storedProfile?.embedding || null
    
    // If no stored profile or missing embedding, build using legacy method as fallback
    if (!tasteProfile) {
      logger.info({ userId: user.id }, '📊 No stored profile, building from watch history...')
      tasteProfile = await buildLegacyTasteProfile(watched, userRatings.size > 0 ? userRatings : undefined)
      
      if (tasteProfile) {
        // Get current embedding model to store with profile
        const { getActiveEmbeddingModelId } = await import('../../lib/ai-provider.js')
        const currentModelId = await getActiveEmbeddingModelId()
        
        // Store in new system with embedding model info
        await storeNewTasteProfile(user.id, 'movie', tasteProfile, currentModelId || undefined)
        // Also detect franchises
        await detectAndUpdateFranchises(user.id, 'movie')
        logger.info({ userId: user.id }, '💾 Stored new taste profile and detected franchises')
      }
    } else {
      logger.info({ userId: user.id }, '✅ Using stored taste profile')
    }

    if (!tasteProfile) {
      logger.warn(
        { userId: user.id },
        '⚠️ Could not build taste profile - movies may be missing embeddings'
      )
      await finalizeRun(
        runId,
        0,
        0,
        Date.now() - startTime,
        'failed',
        'Could not build taste profile (movies may be missing embeddings)'
      )
      return { runId, recommendations: [] }
    }

    // Also store in legacy location for backwards compatibility
    await storeLegacyTasteProfile(user.id, tasteProfile)
    logger.info({ userId: user.id }, '💾 Stored taste profile (legacy)')

    // 3. Get candidate movies (optionally including watched based on user preference)
    logger.info(
      { userId: user.id, maxCandidates: cfg.maxCandidates, includeWatched },
      `🔍 Finding candidate movies using vector similarity (${includeWatched ? 'including' : 'excluding'} watched)...`
    )

    // Get ALL watched movie IDs for filtering (not just the ones used for taste profile)
    // Also exclude disliked movies if dislike_behavior is 'exclude'
    // Includes duplicate library copies that share TMDb/IMDb IDs with watched titles
    let excludeIds: Set<string>
    if (includeWatched) {
      // Only exclude disliked movies (not watched ones)
      excludeIds = new Set(dislikedIds)
    } else {
      const { getExpandedWatchedMovieIds, getExpandedFavoritedMovieIds } = await import(
        '../watchedExclusion.js'
      )
      excludeIds = await getExpandedWatchedMovieIds(user.id)
      // Favorites stay taste input but stop being offered back as discoveries;
      // see getExpandedFavoritedMovieIds for why this isn't part of "watched".
      const favoritedIds = await getExpandedFavoritedMovieIds(user.id)
      for (const favoritedId of favoritedIds) {
        excludeIds.add(favoritedId)
      }
      for (const dislikedId of dislikedIds) {
        excludeIds.add(dislikedId)
      }
      logger.info(
        {
          userId: user.id,
          excludeTotal: excludeIds.size,
          favoritedCount: favoritedIds.size,
          dislikedCount: dislikedIds.size,
        },
        `📋 Loaded ${excludeIds.size} movies to exclude (watched duplicates + favorited + disliked)`
      )
    }

    // Multi-centroid retrieval: if the user's taste clustered into more than
    // one facet (taste-profile/clustering.ts), query each cluster's centroid
    // independently and merge by max similarity, so a candidate matching any
    // one of the user's taste facets surfaces instead of being diluted by a
    // single averaged vector. Falls open to the existing single-centroid
    // path whenever there's only one cluster, no clusters yet (pre-rebuild),
    // or the multi-cluster query itself fails for any reason.
    const tasteClusters = await getUserTasteClusters(user.id, 'movie')

    let candidates: Candidate[]
    if (tasteClusters.length > 1) {
      try {
        candidates = await getMultiClusterCandidates(
          tasteClusters.map((c) => ({ embedding: c.embedding, weight: c.weight })),
          excludeIds,
          cfg.maxCandidates,
          includeWatched,
          user.maxParentalRating ?? null
        )
        logger.info(
          { userId: user.id, clusterCount: tasteClusters.length },
          `🧩 Using ${tasteClusters.length} taste clusters for candidate retrieval`
        )
      } catch (err) {
        logger.warn(
          { err, userId: user.id },
          'Multi-cluster candidate retrieval failed, falling back to single-centroid'
        )
        candidates = await getCandidates(
          tasteProfile,
          excludeIds,
          cfg.maxCandidates,
          includeWatched,
          user.maxParentalRating ?? null
        )
      }
    } else {
      candidates = await getCandidates(
        tasteProfile,
        excludeIds,
        cfg.maxCandidates,
        includeWatched,
        user.maxParentalRating ?? null
      )
    }

    logger.info(
      { userId: user.id, candidateCount: candidates.length },
      `Found ${candidates.length} candidate movies`
    )

    if (candidates.length === 0) {
      logger.warn(
        { userId: user.id },
        '⚠️ No candidate movies found - may need to sync movies or generate embeddings'
      )
      await finalizeRun(
        runId,
        0,
        0,
        Date.now() - startTime,
        'failed',
        'No candidate movies found (library may need syncing or embedding)'
      )
      return { runId, recommendations: [] }
    }

    // 4. Score and rank candidates
    logger.info({ userId: user.id }, '📈 Scoring and ranking candidates...')
    logger.info(
      {
        weights: {
          similarity: cfg.similarityWeight,
          novelty: cfg.noveltyWeight,
          rating: cfg.ratingWeight,
          diversity: cfg.diversityWeight,
        },
      },
      'Using scoring weights'
    )
    // Genre familiarity is a per-run constant, resolved once from the user's
    // whole history rather than from the 50 favourites the novelty term used to
    // read (see genreFamiliarity.ts).
    const genreFamiliarity = buildGenreFamiliarity(
      await getWatchedGenreCounts(user.id, 'movie')
    )

    const scoredCandidates = scoreCandidates(candidates, genreFamiliarity, cfg)

    // 4.5 Apply franchise, genre, and custom interest preference adjustments
    logger.info({ userId: user.id }, '🎯 Applying preference adjustments (franchise, genre, custom interests)...')
    let franchiseSignalCount = 0
    let genreSignalCount = 0
    let interestSignalCount = 0

    // Custom interests get one indexed ANN query each rather than a
    // per-candidate embedding fetch plus affinity call. That's what lets every
    // candidate be measured instead of only the top 100 -- the old cap meant
    // the signal was simply absent for everything below it -- while cutting
    // roughly 200 DB round-trips per user per run down to one per interest.
    // Fails open: any problem here leaves every affinity neutral, exactly as
    // a user with no interests configured would score.
    let interestIndex: InterestMatchIndex | null = null
    try {
      const customInterests = await getUserCustomInterests(user.id)
      if (customInterests.length > 0) {
        interestIndex = await getInterestMatchIndex(
          customInterests.map((interest) => ({
            interestId: interest.id,
            interestText: interest.interestText,
            weight: interest.weight,
            embedding: interest.embedding,
            embeddingModel: interest.embeddingModel,
          })),
          excludeIds,
          includeWatched,
          user.maxParentalRating ?? null
        )
      }
    } catch (err) {
      logger.warn({ err, userId: user.id }, 'Custom interest matching failed, continuing without it')
    }

    // Franchise and genre preferences are resolved up front rather than inside
    // the loop. Asking per candidate meant 2-3 sequential round trips for every
    // item in the library -- ~29k per user at a 12.5k-title library, and
    // getGenreAffinity re-issued the byte-identical `WHERE user_id = $1` query
    // every single iteration to get back the same handful of rows. Three
    // queries now, and the loop below is pure CPU.
    const [candidateFranchises, franchiseAffinities, genreWeights] = await Promise.all([
      getItemFranchises(
        scoredCandidates.map((candidate) => candidate.id),
        'movie'
      ),
      getFranchiseAffinityMap(user.id, 'movie'),
      getUserGenreWeights(user.id),
    ])
    const genreWeightMap = buildGenreWeightMap(genreWeights)

    for (const candidate of scoredCandidates) {
      // Franchise affinity: 0 (avoid) - 0.5 (neutral) - 1 (loved)
      const franchiseName = candidateFranchises.get(candidate.id) ?? null
      const franchiseAffinity = franchiseName
        ? franchiseAffinities.get(franchiseName) ?? 0.5
        : 0.5

      // Genre affinity: 0 (avoid) - 0.5 (neutral) - 1 (loved)
      const genreAffinity = genreAffinityFromWeights(genreWeightMap, candidate.genres || [])

      // Custom interest affinity: 0.5 (no match) - 1 (strong match)
      const interestAffinity = interestIndex?.best.get(candidate.id)?.affinity ?? 0.5

      // Nudge the score toward 1 or 0 based on preference affinities, bounded to [0,1]
      const originalScore = candidate.finalScore
      candidate.finalScore = applyPreferenceAdjustment(originalScore, {
        franchise: franchiseAffinity,
        genre: genreAffinity,
        interest: interestAffinity,
      })

      if (franchiseAffinity !== 0.5) {
        franchiseSignalCount++
        logger.debug(
          { title: candidate.title, franchiseName, franchiseAffinity: franchiseAffinity.toFixed(2) },
          'Applied franchise preference'
        )
      }
      if (genreAffinity !== 0.5) {
        genreSignalCount++
      }
      if (interestAffinity !== 0.5) {
        interestSignalCount++
        logger.debug(
          { title: candidate.title, interestAffinity: interestAffinity.toFixed(2) },
          'Applied custom interest preference'
        )
      }
    }

    // Re-sort after applying preference adjustments
    scoredCandidates.sort((a, b) => b.finalScore - a.finalScore)

    logger.info(
      { userId: user.id, franchiseSignalCount, genreSignalCount, interestSignalCount },
      `Applied ${franchiseSignalCount} franchise, ${genreSignalCount} genre, ${interestSignalCount} interest preference adjustments`
    )

    // What each scoring term actually contributed to the ordering. A weight only
    // controls influence if the terms it weighs have comparable spread, and
    // nothing verified that -- which is how a novelty term whose entire range
    // was three discrete values came to outweigh similarity while carrying half
    // its configured weight. `influence` is the number to read.
    logger.info(
      {
        userId: user.id,
        mediaType: 'movie',
        genresKnown: genreFamiliarity.size,
        weights: {
          similarity: cfg.similarityWeight,
          novelty: cfg.noveltyWeight,
          rating: cfg.ratingWeight,
        },
        ...summarizeScoreComponents(scoredCandidates, cfg),
      },
      'SCORE-DIAG'
    )

    // Log top candidates
    const top5 = scoredCandidates.slice(0, 5)
    for (const c of top5) {
      logger.info(
        {
          title: c.title,
          year: c.year,
          similarity: c.similarity.toFixed(3),
          novelty: c.novelty.toFixed(3),
          rating: c.ratingScore.toFixed(3),
          finalScore: c.finalScore.toFixed(3),
        },
        `🎯 Top candidate: ${c.title}`
      )
    }

    // 5. Apply diversity boost and select final recommendations
    // Use smart diversity adjustment if user hasn't set custom weights
    const { getSmartDiversityWeight } = await import('../../lib/userAlgorithmSettings.js')
    const effectiveDiversityWeight = await getSmartDiversityWeight(user.id, 'movie', cfg.diversityWeight)
    
    logger.info(
      { userId: user.id, targetCount: cfg.selectedCount, diversityWeight: effectiveDiversityWeight },
      '🎲 Applying diversity and selecting final recommendations...'
    )
    // Hand a bounded few of the picks to the user's stated interests. The
    // preference multiplier alone can never surface anything -- it closes at
    // most 11.5% of a candidate's gap to 1.0 (see shared/interestSlots.ts) --
    // so the slots come out of selectedCount rather than trying to out-score
    // the ranking. Zero interests means zero slots and an unchanged pipeline.
    const reservedInterestSlots = computeReservedInterestSlots(
      cfg.selectedCount,
      interestIndex?.byInterest.length ?? 0
    )

    const { selected } = applyDiversityAndSelect(
      scoredCandidates,
      cfg.selectedCount - reservedInterestSlots,
      effectiveDiversityWeight
    )

    // Fillers carry the same finalScore as everything else: applyDiversitySelection
    // writes its diversity-blended ranking to `selectionScore` and leaves
    // finalScore alone, so slot fillers and diversity picks are directly
    // comparable. (It used to overwrite finalScore, which is what made the
    // "% Match" badge report a number that meant something different depending
    // on how the item got picked.)
    const interestFillers = interestIndex
      ? pickInterestSlotFillers(selected, scoredCandidates, interestIndex, reservedInterestSlots)
      : []

    const interestPicks = new Map<string, InterestCandidateMatch>()
    for (const filler of interestFillers) {
      interestPicks.set(filler.candidate.movieId, filler.match)
      logger.info(
        { title: filler.candidate.title, interest: filler.match.interestText },
        `⭐ Reserved slot for interest "${filler.match.interestText}": ${filler.candidate.title}`
      )
    }
    if (reservedInterestSlots > interestFillers.length) {
      logger.info(
        { reserved: reservedInterestSlots, filled: interestFillers.length },
        'Some reserved interest slots had no qualifying match and were left unused'
      )
    }

    const selectedWithInterests = [...selected, ...interestFillers.map((f) => f.candidate)]

    const finalSelected = includeWatched
      ? selectedWithInterests
      : (await import('../watchedExclusion.js')).filterByWatchedIds(
          selectedWithInterests.map((candidate) => ({ ...candidate, id: candidate.movieId })),
          excludeIds
        )

    if (!includeWatched && finalSelected.length < selectedWithInterests.length) {
      logger.info(
        {
          userId: user.id,
          removed: selectedWithInterests.length - finalSelected.length,
        },
        'Filtered watched movies from final recommendations (safety net)'
      )
    }

    const finalSelectedRanks = new Map<string, number>()
    finalSelected.forEach((candidate, index) => {
      finalSelectedRanks.set(candidate.movieId, index + 1)
    })

    // Log selected movies
    logger.info(
      { userId: user.id, selectedCount: finalSelected.length },
      `Selected ${finalSelected.length} movies for recommendation:`
    )
    for (let i = 0; i < Math.min(finalSelected.length, 10); i++) {
      const s = finalSelected[i]
      logger.info(
        {
          rank: i + 1,
          title: s.title,
          year: s.year,
          genres: s.genres.join(', '),
          finalScore: s.finalScore.toFixed(3),
        },
        `  ${i + 1}. ${s.title} (${s.year}) - Score: ${s.finalScore.toFixed(3)}`
      )
    }

    // Nothing scores or filters on release year, so whether the picks track the
    // user's era at all is an open question rather than a designed behaviour.
    // Read `unfamiliarShare` against `poolUnfamiliarShare`: the pool is
    // effectively the library's own era mix, so a much smaller share among the
    // picks means the embedding is carrying era implicitly and an explicit term
    // would be redundant. Similar shares mean there is no era signal.
    logger.info(
      {
        userId: user.id,
        mediaType: 'movie',
        ...summarizeEraFit(
          await getWatchedYears(user.id, 'movie'),
          scoredCandidates.map((c) => c.year),
          finalSelected.map((c) => c.year)
        ),
      },
      'ERA-DIAG'
    )

    // 6. Store results
    logger.info({ runId }, '💾 Storing candidates and evidence...')
    await storeCandidates(runId, scoredCandidates, finalSelected, finalSelectedRanks, interestPicks)
    await storeEvidence(runId, finalSelected, watched)

    // 7. Generate AI explanations for selected recommendations
    //
    // Gated on the same setting that decides whether anyone will ever read them.
    // Without this the run pays for a text-generation call whose only output is
    // a column nothing renders. Turning the setting back on takes effect from
    // the next run: past runs stay unexplained rather than being backfilled.
    if (!(await getEffectiveAiExplanationSetting(user.id))) {
      logger.info({ runId }, '⏭️ AI explanations disabled for this user, skipping generation')
    } else {
      logger.info({ runId }, '🤖 Generating AI explanations...')
      try {
        // Fetch overviews for selected movies
        const movieOverviews = await getMovieOverviews(finalSelected.map((s) => s.movieId))

        // Prepare data for explanation generation
        const moviesForExplanation: MovieForExplanation[] = finalSelected.map((s) => ({
          movieId: s.movieId,
          title: s.title,
          year: s.year,
          genres: s.genres,
          overview: movieOverviews.get(s.movieId) || null,
          similarity: s.similarity,
          normalizedSimilarity: s.normalizedSimilarity,
          novelty: s.novelty,
          ratingScore: s.ratingScore,
          // Non-null only for reserved interest slots, so the explanation
          // credits what actually put the film here instead of inventing a
          // watch-history justification for it.
          interestText: interestPicks.get(s.movieId)?.interestText ?? null,
        }))

        // Generate explanations using embedding-based evidence
        const explanations = await generateExplanations(runId, user.id, moviesForExplanation)
        await storeExplanations(runId, explanations)
        logger.info({ runId, count: explanations.length }, '✅ AI explanations stored')
      } catch (explanationError) {
        // Don't fail the whole run if explanations fail
        logger.warn(
          { runId, error: explanationError },
          '⚠️ Failed to generate explanations, continuing without'
        )
      }
    }

    const duration = Date.now() - startTime
    // 'completed' is reserved for a run that actually produced picks, because
    // /api/recommendations serves the newest completed run and nothing else.
    // The early returns above therefore finalize as 'failed' with a reason: a
    // transient condition like a missing embedding model would otherwise write
    // an empty completed run for every user at once and blank every page,
    // while the good picks from last week sat one row further down.
    await finalizeRun(runId, scoredCandidates.length, finalSelected.length, duration, 'completed')

    // Housekeeping, after this run is safely marked completed so the prefix we
    // keep is guaranteed to include it.
    await pruneOldRecommendationRuns(user.id, 'movie', RECOMMENDATION_RUNS_TO_KEEP)

    logger.info(
      {
        userId: user.id,
        username: user.username,
        candidates: scoredCandidates.length,
        selected: finalSelected.length,
        duration,
      },
      `🎉 Recommendations complete for ${user.username}: ${finalSelected.length} picks in ${duration}ms`
    )

    return { runId, recommendations: finalSelected }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    logger.error({ userId: user.id, err }, `❌ Recommendation generation failed: ${error}`)
    await finalizeRun(runId, 0, 0, Date.now() - startTime, 'failed', error)
    throw err
  }
}

/**
 * Generate recommendations for all enabled users
 */
export async function generateRecommendationsForAllUsers(jobId?: string): Promise<{
  success: number
  failed: number
  /** Users left alone because no input had changed since their last run */
  skipped: number
  totalRecommendations: number
  jobId: string
}> {
  const actualJobId = jobId || crypto.randomUUID()

  // Initialize job progress
  createJobProgress(actualJobId, 'generate-movie-recommendations', 2)

  try {
    setJobStep(actualJobId, 0, 'Finding enabled users')
    addLog(actualJobId, 'info', '🔍 Finding enabled users...')

    const result = await query<{
      id: string
      username: string
      provider_user_id: string
      max_parental_rating: number | null
    }>(
      `SELECT id, username, provider_user_id, max_parental_rating FROM users WHERE is_enabled = true AND movies_enabled = true AND provider_disabled = false`
    )

    const totalUsers = result.rows.length

    if (totalUsers === 0) {
      addLog(actualJobId, 'warn', '⚠️ No enabled users found')
      completeJob(actualJobId, { success: 0, failed: 0, skipped: 0, totalRecommendations: 0 })
      return { success: 0, failed: 0, skipped: 0, totalRecommendations: 0, jobId: actualJobId }
    }

    addLog(actualJobId, 'info', `👥 Found ${totalUsers} enabled user(s)`)
    setJobStep(actualJobId, 1, 'Generating recommendations', totalUsers)

    let success = 0
    let failed = 0
    let skipped = 0
    let totalRecommendations = 0

    for (let i = 0; i < result.rows.length; i++) {
      const user = result.rows[i]

      try {
        addLog(actualJobId, 'info', `🎬 Generating recommendations for ${user.username}...`)

        const recResult = await generateRecommendationsForUser(
          {
            id: user.id,
            username: user.username,
            providerUserId: user.provider_user_id,
            maxParentalRating: user.max_parental_rating,
          },
          {},
          // The scheduled sweep is the one caller that should do nothing when
          // nothing changed; every manual path is someone asking for work.
          { skipIfUnchanged: true }
        )

        if (recResult.skipped) {
          skipped++
          addLog(actualJobId, 'info', `⏭️ ${user.username}: no new activity, keeping existing picks`)
        } else {
          success++
          totalRecommendations += recResult.recommendations.length
          addLog(
            actualJobId,
            'info',
            `✅ Generated ${recResult.recommendations.length} recommendations for ${user.username}`
          )
        }
        updateJobProgress(
          actualJobId,
          i + 1,
          totalUsers,
          `${success}/${totalUsers} users (${totalRecommendations} recommendations, ${skipped} unchanged)`
        )
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        logger.error({ err, userId: user.id }, 'Failed to generate recommendations')
        addLog(actualJobId, 'error', `❌ Failed for ${user.username}: ${errorMsg}`)
        failed++
        updateJobProgress(
          actualJobId,
          i + 1,
          totalUsers,
          `${success}/${totalUsers} users (${failed} failed)`
        )
      }
    }

    const finalResult = { success, failed, skipped, totalRecommendations, jobId: actualJobId }

    if (failed > 0) {
      addLog(
        actualJobId,
        'warn',
        `⚠️ Completed with ${failed} failure(s): ${success} succeeded, ${failed} failed, ${skipped} unchanged, ${totalRecommendations} total recommendations`
      )
    } else {
      addLog(actualJobId, 'info', `🎉 All ${success + skipped} user(s) processed successfully! ${totalRecommendations} total recommendations, ${skipped} left unchanged`)
    }

    completeJob(actualJobId, finalResult)
    return finalResult
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    addLog(actualJobId, 'error', `❌ Job failed: ${error}`)
    failJob(actualJobId, error)
    throw err
  }
}

/**
 * Clear and rebuild recommendations for all users (admin function)
 */
export async function clearAndRebuildAllRecommendations(existingJobId?: string): Promise<{
  cleared: number
  success: number
  failed: number
  jobId: string
}> {
  const jobId = existingJobId || randomUUID()
  createJobProgress(jobId, 'full-reset-movie-recommendations', 3)

  try {
    // Step 1: Count existing
    setJobStep(jobId, 0, 'Counting existing recommendations')
    const countResult = await queryOne<{ count: string }>(
      'SELECT COUNT(*) FROM recommendation_runs'
    )
    const existingCount = parseInt(countResult?.count || '0', 10)
    addLog(jobId, 'info', `📊 Found ${existingCount} existing recommendation runs`)

    // Step 2: Clear all
    setJobStep(jobId, 1, 'Clearing all recommendations')
    addLog(jobId, 'info', '🗑️ Clearing all recommendation data...')
    await clearAllRecommendations()
    addLog(jobId, 'info', '✅ All recommendations cleared')

    // Step 3: Regenerate for all users
    setJobStep(jobId, 2, 'Regenerating recommendations')
    const result = await query<{
      id: string
      username: string
      provider_user_id: string
      max_parental_rating: number | null
    }>(
      // movies_enabled matters here exactly as much as it does in the scheduled
      // job above: without it the reset generates movie recommendations for
      // users who have movies switched off.
      `SELECT id, username, provider_user_id, max_parental_rating FROM users WHERE is_enabled = true AND movies_enabled = true AND provider_disabled = false`
    )
    const users = result.rows
    addLog(jobId, 'info', `👥 Regenerating for ${users.length} enabled user(s)`)

    let success = 0
    let failed = 0

    for (let i = 0; i < users.length; i++) {
      const user = users[i]
      updateJobProgress(jobId, i, users.length, user.username)

      try {
        addLog(jobId, 'info', `🧠 Generating for ${user.username}...`)
        await generateRecommendationsForUser({
          id: user.id,
          username: user.username,
          providerUserId: user.provider_user_id,
          maxParentalRating: user.max_parental_rating,
        })
        success++
        addLog(jobId, 'info', `✅ Done: ${user.username}`)
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error'
        addLog(jobId, 'error', `❌ ${user.username}: ${error}`)
        failed++
      }
    }

    updateJobProgress(jobId, users.length, users.length)
    const finalResult = { cleared: existingCount, success, failed, jobId }
    completeJob(jobId, finalResult)
    return finalResult
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    addLog(jobId, 'error', `❌ Job failed: ${error}`)
    failJob(jobId, error)
    throw err
  }
}

/**
 * Regenerate recommendations for a single user (user-initiated)
 */
export async function regenerateUserRecommendations(userId: string): Promise<{
  runId: string
  count: number
}> {
  // Get user info
  const user = await queryOne<{
    id: string
    username: string
    provider_user_id: string
    max_parental_rating: number | null
  }>('SELECT id, username, provider_user_id, max_parental_rating FROM users WHERE id = $1', [
    userId,
  ])

  if (!user) {
    throw new Error('User not found')
  }

  logger.info({ userId, username: user.username }, '🔄 User-initiated recommendation regeneration')

  // Clear existing recommendations for this user
  await clearUserRecommendations(userId)

  // Generate new recommendations
  const result = await generateRecommendationsForUser({
    id: user.id,
    username: user.username,
    providerUserId: user.provider_user_id,
    maxParentalRating: user.max_parental_rating,
  })

  if (!result.runId) {
    // Unreachable: runId is only null when the activity gate skips, and this
    // path never opts into it. Asserted rather than widened so the caller's
    // contract stays a plain string.
    throw new Error('Recommendation run produced no run id')
  }

  return {
    runId: result.runId,
    count: result.recommendations.length,
  }
}
