import { query, queryOne, transaction } from '../lib/db.js'
import { getActiveEmbeddingModelId, getActiveEmbeddingTableName } from '../lib/ai-provider.js'
import type { Candidate, WatchedMovie } from './types.js'

/**
 * Store recommendation candidates using bulk INSERT
 * OPTIMIZED: Uses unnest() for single query instead of N individual INSERTs
 */
/**
 * A reserved-slot pick, recorded on the candidate's score_breakdown so it's
 * possible to tell after the fact which recommendations came from a stated
 * interest rather than from the ranking. Lives in the existing JSONB column,
 * so no migration is needed.
 */
export interface StoredInterestPick {
  interestId: string
  interestText: string
  weightedSimilarity: number
}

/**
 * A pick borrowed from a taste twin, recorded the same way and for the same
 * reason. Holds the donor's *id* and never their name: the insights panel says
 * "someone with taste like yours", so resolving an identity is not something
 * the read path should be able to do by accident.
 */
export interface StoredTwinPick {
  donorId: string
  affinity: number
  sharedCount: number
  /**
   * The rarest titles the two viewers both watched, which is what the panel
   * shows as the reason. Stored as ids and resolved to titles on read, so a
   * renamed or re-matched film cannot leave a stale name frozen in JSONB.
   */
  sharedIds?: string[]
}

/** One prepared row per scored candidate, ready for the bulk INSERT. */
export interface PreparedCandidateRow {
  movieId: string
  rank: number
  isSelected: boolean
  selectedRank: number | null
  finalScore: number
  similarity: number
  novelty: number
  ratingScore: number
  /** null when the diversity selector never looked at this candidate. */
  diversityScore: number | null
  /** null unless it carries something no column already holds. */
  scoreBreakdown: string | null
}

/**
 * Diversity is measured *relative to what has already been chosen*, so it only
 * exists for candidates the selector actually walked. Two kinds of row never
 * get that far: the thousands that were scored but not picked, and the reserved
 * slot fillers, which are appended after applyDiversityAndSelect has returned.
 *
 * Both kept the 0 they were initialised with, and storing that 0 made the
 * insights panel render a confident "Variety 0%" -- a measurement-looking
 * number for something never measured, on precisely the picks whose whole point
 * is that the ranking did not choose them. selectionScore is the existing mark
 * the selector leaves on everything it ranked, so it decides here too.
 *
 * The column is nullable already; the read path renders null as "n/a".
 */
function measuredDiversity(candidate: Candidate): number | null {
  return candidate.selectionScore !== undefined ? candidate.diversityScore : null
}

/**
 * Shape every scored candidate into a storable row.
 *
 * Pure and exported so the parts a silent regression would hide can be pinned
 * by tests: that nothing is dropped, that ranks stay dense and 1-based, that a
 * selected pick can never go missing, and which rows carry a score_breakdown.
 */
export function buildCandidateRows(
  allCandidates: Candidate[],
  selected: Candidate[],
  selectedRanks?: Map<string, number>,
  interestPicks?: Map<string, StoredInterestPick>,
  twinPicks?: Map<string, StoredTwinPick>
): PreparedCandidateRow[] {
  const selectedIds = new Set(selected.map((s) => s.movieId))

  // Every scored candidate is stored, which is what the series pipeline has
  // always done. Movies kept `allCandidates.slice(0, 100)` and discarded the
  // rest, so the insights panel could only ever explain about a hundred titles
  // per user: every other film was scored and then immediately forgotten, and
  // browsing one reported it had never been considered. See
  // pruneOldRecommendationRuns for what stops this growing without bound.
  const storedIds = new Set(allCandidates.map((c) => c.movieId))

  // Defensive, and almost always empty now the list is complete. A pick
  // missing from this table vanishes from /api/recommendations, which reads
  // the picks back out of it -- worth one Set to make impossible.
  const orphanedPicks = selected.filter((s) => !storedIds.has(s.movieId))

  return [...allCandidates, ...orphanedPicks].map((c, i) => {
    const isSelected = selectedIds.has(c.movieId)
    const interestPick = interestPicks?.get(c.movieId)
    const twinPick = twinPicks?.get(c.movieId)

    // Only what no column already holds. similarity, novelty, rating and
    // diversity each have their own column, so copying them into JSONB as well
    // was harmless on a hundred rows and is not on twelve thousand. Matches
    // the series pipeline, which has always left this null for ordinary rows.
    const extras = {
      // The diversity-blended number the selector actually ranked by. Kept out
      // of final_score so that column stays one comparable scale for every
      // row; present only on selected candidates.
      ...(c.selectionScore !== undefined ? { selectionScore: c.selectionScore } : {}),
      ...(interestPick
        ? {
            interestMatch: {
              interestId: interestPick.interestId,
              interestText: interestPick.interestText,
              weightedSimilarity: interestPick.weightedSimilarity,
            },
          }
        : {}),
      ...(twinPick
        ? {
            twinMatch: {
              donorId: twinPick.donorId,
              affinity: twinPick.affinity,
              sharedCount: twinPick.sharedCount,
              ...(twinPick.sharedIds?.length ? { sharedIds: twinPick.sharedIds } : {}),
            },
          }
        : {}),
    }

    return {
      movieId: c.movieId,
      rank: i + 1,
      isSelected,
      selectedRank: isSelected ? (selectedRanks?.get(c.movieId) ?? null) : null,
      finalScore: c.finalScore,
      similarity: c.similarity,
      novelty: c.novelty,
      ratingScore: c.ratingScore,
      diversityScore: measuredDiversity(c),
      scoreBreakdown: Object.keys(extras).length > 0 ? JSON.stringify(extras) : null,
    }
  })
}

export async function storeCandidates(
  runId: string,
  allCandidates: Candidate[],
  selected: Candidate[],
  selectedRanks?: Map<string, number>,
  interestPicks?: Map<string, StoredInterestPick>,
  twinPicks?: Map<string, StoredTwinPick>
): Promise<void> {
  const data = buildCandidateRows(allCandidates, selected, selectedRanks, interestPicks, twinPicks)

  if (data.length === 0) return

  // One statement per run was fine while this stored a hundred rows. The pool
  // is now the user's whole unwatched library, so an unbounded statement would
  // serialise tens of thousands of rows across ten arrays on the wire at once.
  // Chunking keeps that bounded without giving up the unnest bulk insert.
  const CHUNK_SIZE = 5000

  for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
    const chunk = data.slice(offset, offset + CHUNK_SIZE)

    await query(
      `INSERT INTO recommendation_candidates
       (run_id, movie_id, rank, is_selected, selected_rank, final_score, similarity_score, novelty_score, rating_score, diversity_score, score_breakdown)
       SELECT $1, movie_id, rank, is_selected, selected_rank, final_score, similarity_score, novelty_score, rating_score, diversity_score,
              -- qualified: score_breakdown is also the name of the target column,
              -- and t. leaves nothing resting on scoping rules. NULL for every
              -- row that carries nothing a column doesn't already hold, which is
              -- almost all of them; the column itself is NOT NULL.
              COALESCE(t.score_breakdown, '{}'::jsonb)
       FROM unnest(
         $2::uuid[], $3::int[], $4::boolean[], $5::int[], $6::real[],
         $7::real[], $8::real[], $9::real[], $10::real[], $11::jsonb[]
       ) AS t(movie_id, rank, is_selected, selected_rank, final_score, similarity_score, novelty_score, rating_score, diversity_score, score_breakdown)`,
      [
        runId,
        chunk.map((d) => d.movieId),
        chunk.map((d) => d.rank),
        chunk.map((d) => d.isSelected),
        chunk.map((d) => d.selectedRank),
        chunk.map((d) => d.finalScore),
        chunk.map((d) => d.similarity),
        chunk.map((d) => d.novelty),
        chunk.map((d) => d.ratingScore),
        chunk.map((d) => d.diversityScore),
        chunk.map((d) => d.scoreBreakdown),
      ]
    )
  }
}

/**
 * Store recommendation evidence
 * OPTIMIZED: Uses a single query to find all evidence, then bulk INSERT
 */
export async function storeEvidence(
  runId: string,
  selected: Candidate[],
  watched: WatchedMovie[]
): Promise<void> {
  if (selected.length === 0 || watched.length === 0) return

  // Get candidate IDs
  const candidateResult = await query<{ id: string; movie_id: string }>(
    `SELECT id, movie_id FROM recommendation_candidates WHERE run_id = $1 AND is_selected = true`,
    [runId]
  )

  const candidateMap = new Map(candidateResult.rows.map((r) => [r.movie_id, r.id]))

  // Create a map of watched movies for fast lookup
  const watchedMap = new Map(watched.map((w) => [w.movieId, w]))
  const watchedIds = watched.map((w) => w.movieId)

  // Get active embedding model
  const modelId = await getActiveEmbeddingModelId()
  if (!modelId) {
    // Skip evidence storage if no embedding model configured
    return
  }

  // Get the embedding table name
  const tableName = await getActiveEmbeddingTableName('embeddings')

  // Get all evidence in a single query using LATERAL join
  // This finds the top 3 similar watched movies for each selected movie in one query
  //
  // The self-match exclusion is load-bearing: a title can sit in both sets at
  // once (favorites are taste input), and without it the pick matched itself at
  // cosine 1.0, took the top slot of only three, and told the explanation model
  // -- which is instructed to use this data and not invent connections -- that
  // the film's closest relative in the user's history was itself.
  const selectedIds = selected.map((s) => s.movieId)
  const evidenceResult = await query<{
    selected_movie_id: string
    similar_movie_id: string
    similarity: number
  }>(
    `SELECT selected_movie_id, similar_movie_id, similarity
     FROM unnest($1::uuid[]) AS sel(selected_movie_id)
     CROSS JOIN LATERAL (
       SELECT e2.movie_id as similar_movie_id, 
              1 - (e2.embedding <=> e1.embedding) as similarity
       FROM ${tableName} e1
       JOIN ${tableName} e2 ON e2.movie_id = ANY($2) AND e2.model = $3
         AND e2.movie_id <> sel.selected_movie_id
       WHERE e1.movie_id = sel.selected_movie_id AND e1.model = $3
       ORDER BY e2.embedding <=> e1.embedding
       LIMIT 3
     ) AS evidence`,
    [selectedIds, watchedIds, modelId]
  )

  if (evidenceResult.rows.length === 0) return

  // Prepare bulk insert data
  const evidenceToInsert: {
    candidateId: string
    similarMovieId: string
    similarity: number
    evidenceType: string
  }[] = []

  for (const ev of evidenceResult.rows) {
    const candidateId = candidateMap.get(ev.selected_movie_id)
    if (!candidateId) continue

    const watchedItem = watchedMap.get(ev.similar_movie_id)
    const evidenceType = watchedItem?.isFavorite
      ? 'favorite'
      : watchedItem?.playCount && watchedItem.playCount > 1
        ? 'highly_rated'
        : 'watched'

    evidenceToInsert.push({
      candidateId,
      similarMovieId: ev.similar_movie_id,
      similarity: ev.similarity,
      evidenceType,
    })
  }

  // Bulk INSERT all evidence records
  if (evidenceToInsert.length > 0) {
    await query(
      `INSERT INTO recommendation_evidence (candidate_id, similar_movie_id, similarity, evidence_type)
       SELECT candidate_id, similar_movie_id, similarity, evidence_type
       FROM unnest($1::uuid[], $2::uuid[], $3::real[], $4::text[])
         AS t(candidate_id, similar_movie_id, similarity, evidence_type)`,
      [
        evidenceToInsert.map((e) => e.candidateId),
        evidenceToInsert.map((e) => e.similarMovieId),
        evidenceToInsert.map((e) => e.similarity),
        evidenceToInsert.map((e) => e.evidenceType),
      ]
    )
  }
}

export async function finalizeRun(
  runId: string,
  candidateCount: number,
  selectedCount: number,
  durationMs: number,
  status: 'completed' | 'failed',
  errorMessage?: string
): Promise<void> {
  await query(
    `UPDATE recommendation_runs
     SET candidate_count = $2, selected_count = $3, duration_ms = $4, status = $5, error_message = $6
     WHERE id = $1`,
    [runId, candidateCount, selectedCount, durationMs, status, errorMessage || null]
  )
}

export async function createRecommendationRun(userId: string): Promise<string> {
  const run = await queryOne<{ id: string }>(
    `INSERT INTO recommendation_runs (user_id, run_type, status)
     VALUES ($1, 'scheduled', 'running')
     RETURNING id`,
    [userId]
  )

  if (!run) {
    throw new Error('Failed to create recommendation run')
  }

  return run.id
}

export async function clearUserRecommendations(userId: string): Promise<void> {
  await transaction(async (client) => {
    // Delete evidence first (FK constraint)
    await client.query(
      `DELETE FROM recommendation_evidence 
       WHERE candidate_id IN (
         SELECT rc.id FROM recommendation_candidates rc
         JOIN recommendation_runs rr ON rc.run_id = rr.id
         WHERE rr.user_id = $1
       )`,
      [userId]
    )

    // Delete candidates
    await client.query(
      `DELETE FROM recommendation_candidates 
       WHERE run_id IN (SELECT id FROM recommendation_runs WHERE user_id = $1)`,
      [userId]
    )

    // Delete runs
    await client.query(`DELETE FROM recommendation_runs WHERE user_id = $1`, [userId])

    // Clear taste profile
    await client.query(`DELETE FROM user_preferences WHERE user_id = $1`, [userId])
  })
}

export async function clearAllRecommendations(): Promise<void> {
  await transaction(async (client) => {
    await client.query('DELETE FROM recommendation_evidence')
    await client.query('DELETE FROM recommendation_candidates')
    await client.query('DELETE FROM recommendation_runs')
    await client.query('DELETE FROM user_preferences')
  })
}

export async function getMovieOverviews(movieIds: string[]): Promise<Map<string, string>> {
  if (movieIds.length === 0) return new Map()

  const result = await query<{ id: string; overview: string | null }>(
    `SELECT id, overview FROM movies WHERE id = ANY($1)`,
    [movieIds]
  )

  const map = new Map<string, string>()
  for (const row of result.rows) {
    if (row.overview) {
      map.set(row.id, row.overview)
    }
  }
  return map
}

