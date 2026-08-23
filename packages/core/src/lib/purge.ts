import { query, transaction } from './db.js'
import { createChildLogger } from './logger.js'
import { VALID_EMBEDDING_DIMENSIONS } from './ai-provider.js'

const logger = createChildLogger('purge')

type EmbeddingBaseTable = 'embeddings' | 'series_embeddings' | 'episode_embeddings'

const EMBEDDING_BASE_TABLES: EmbeddingBaseTable[] = [
  'embeddings',
  'series_embeddings',
  'episode_embeddings',
]

export interface PurgeResult {
  // Content
  moviesDeleted: number
  seriesDeleted: number
  episodesDeleted: number
  // AI Embeddings
  movieEmbeddingsDeleted: number
  seriesEmbeddingsDeleted: number
  episodeEmbeddingsDeleted: number
  // User Data
  watchHistoryDeleted: number
  userRatingsDeleted: number
  recommendationsDeleted: number
  userPreferencesCleared: number
  // Assistant
  assistantConversationsDeleted: number
  assistantMessagesDeleted: number
}

/**
 * Every table an embedding family may live in: one per supported dimension,
 * plus the pre-0078 table that migration renamed to `*_legacy`.
 *
 * The legacy one exists ONLY on instances that predate the multi-dimension
 * migration -- 0078 renames `embeddings`/`series_embeddings`/`episode_embeddings`
 * if it finds them, so an instance created after 0078 never has them.
 */
function embeddingTableNames(baseTable: EmbeddingBaseTable): string[] {
  return [
    ...VALID_EMBEDDING_DIMENSIONS.map((dim) => `${baseTable}_${dim}`),
    `${baseTable}_legacy`,
  ]
}

/**
 * Resolve which of `names` this instance actually has, in one catalog lookup.
 *
 * Probing a missing table and catching the failure is NOT equivalent: the
 * statement still reaches Postgres, which logs `ERROR: relation ... does not
 * exist` for every miss (three per Settings page load, from the stats route).
 * Worse inside a transaction -- a failed statement aborts it, so every later
 * statement fails with 25P02 whatever the JS `catch` does, which is what stopped
 * the purge completing on any instance with no legacy tables.
 */
async function getExistingTables(names: string[]): Promise<Set<string>> {
  const result = await query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [names]
  )
  return new Set(result.rows.map((row) => row.table_name))
}

/**
 * Purge all content data from the database.
 * This includes: movies, series, episodes, all embeddings, watch history,
 * ratings, recommendations, taste profiles, and assistant conversations.
 * Library configs and users are preserved.
 *
 * Use this to reset the content database and start fresh.
 */
export async function purgeMovieDatabase(): Promise<PurgeResult> {
  logger.warn('🗑️ Starting full content database purge...')

  const result: PurgeResult = {
    moviesDeleted: 0,
    seriesDeleted: 0,
    episodesDeleted: 0,
    movieEmbeddingsDeleted: 0,
    seriesEmbeddingsDeleted: 0,
    episodeEmbeddingsDeleted: 0,
    watchHistoryDeleted: 0,
    userRatingsDeleted: 0,
    recommendationsDeleted: 0,
    userPreferencesCleared: 0,
    assistantConversationsDeleted: 0,
    assistantMessagesDeleted: 0,
  }

  // Resolved before the transaction opens, so a missing table can never abort it.
  const existingTables = await getExistingTables(
    EMBEDDING_BASE_TABLES.flatMap(embeddingTableNames)
  )

  await transaction(async (client) => {
    const deleteEmbeddings = async (baseTable: EmbeddingBaseTable): Promise<number> => {
      let deleted = 0
      for (const table of embeddingTableNames(baseTable)) {
        if (!existingTables.has(table)) continue
        const res = await client.query(`DELETE FROM ${table}`)
        deleted += res.rowCount || 0
      }
      return deleted
    }

    // 1. Delete assistant messages (FK to conversations)
    const messagesResult = await client.query('DELETE FROM assistant_messages')
    result.assistantMessagesDeleted = messagesResult.rowCount || 0
    logger.info(`Deleted ${result.assistantMessagesDeleted} assistant messages`)

    // 2. Delete assistant conversations
    const conversationsResult = await client.query('DELETE FROM assistant_conversations')
    result.assistantConversationsDeleted = conversationsResult.rowCount || 0
    logger.info(`Deleted ${result.assistantConversationsDeleted} assistant conversations`)

    // 3. Delete assistant suggestions
    await client.query('DELETE FROM assistant_suggestions')
    logger.info('Deleted assistant suggestions')

    // 4. Delete recommendation evidence (FK to candidates)
    const evidenceResult = await client.query('DELETE FROM recommendation_evidence')
    logger.info(`Deleted ${evidenceResult.rowCount} recommendation evidence rows`)

    // 5. Delete recommendation candidates (FK to runs)
    const candidatesResult = await client.query('DELETE FROM recommendation_candidates')
    result.recommendationsDeleted = candidatesResult.rowCount || 0
    logger.info(`Deleted ${result.recommendationsDeleted} recommendation candidates`)

    // 6. Delete recommendation runs
    const runsResult = await client.query('DELETE FROM recommendation_runs')
    logger.info(`Deleted ${runsResult.rowCount} recommendation runs`)

    // 7. Clear user preferences (taste profiles)
    const prefsResult = await client.query('DELETE FROM user_preferences')
    result.userPreferencesCleared = prefsResult.rowCount || 0
    logger.info(`Cleared ${result.userPreferencesCleared} user preference records`)

    // 8. Delete user ratings
    const ratingsResult = await client.query('DELETE FROM user_ratings')
    result.userRatingsDeleted = ratingsResult.rowCount || 0
    logger.info(`Deleted ${result.userRatingsDeleted} user ratings`)

    // 9. Delete watch history
    const watchResult = await client.query('DELETE FROM watch_history')
    result.watchHistoryDeleted = watchResult.rowCount || 0
    logger.info(`Deleted ${result.watchHistoryDeleted} watch history records`)

    // 10. Delete episode embeddings from all dimension-specific tables (FK to episodes)
    result.episodeEmbeddingsDeleted = await deleteEmbeddings('episode_embeddings')
    logger.info(`Deleted ${result.episodeEmbeddingsDeleted} episode embeddings`)

    // 11. Delete series embeddings from all dimension-specific tables (FK to series)
    result.seriesEmbeddingsDeleted = await deleteEmbeddings('series_embeddings')
    logger.info(`Deleted ${result.seriesEmbeddingsDeleted} series embeddings`)

    // 12. Delete movie embeddings from all dimension-specific tables (FK to movies)
    result.movieEmbeddingsDeleted = await deleteEmbeddings('embeddings')
    logger.info(`Deleted ${result.movieEmbeddingsDeleted} movie embeddings`)

    // 13. Delete episodes (FK to series)
    const episodesResult = await client.query('DELETE FROM episodes')
    result.episodesDeleted = episodesResult.rowCount || 0
    logger.info(`Deleted ${result.episodesDeleted} episodes`)

    // 14. Delete series
    const seriesResult = await client.query('DELETE FROM series')
    result.seriesDeleted = seriesResult.rowCount || 0
    logger.info(`Deleted ${result.seriesDeleted} series`)

    // 15. Delete movies
    const moviesResult = await client.query('DELETE FROM movies')
    result.moviesDeleted = moviesResult.rowCount || 0
    logger.info(`Deleted ${result.moviesDeleted} movies`)
  })

  logger.warn({ ...result }, '✅ Content database purge complete')

  return result
}

export interface DatabaseStats {
  // Content
  movies: number
  series: number
  episodes: number
  // AI Embeddings
  movieEmbeddings: number
  seriesEmbeddings: number
  episodeEmbeddings: number
  // User Data
  watchHistory: number
  userRatings: number
  recommendations: number
  userPreferences: number
  // Assistant
  assistantConversations: number
  assistantMessages: number
}

/**
 * Count embeddings across all dimension-specific tables (plus the legacy one,
 * where the instance is old enough to have it).
 */
async function countAllEmbeddings(
  baseTable: EmbeddingBaseTable,
  existingTables: Set<string>
): Promise<number> {
  let total = 0
  for (const table of embeddingTableNames(baseTable)) {
    if (!existingTables.has(table)) continue
    const result = await query<{ count: string }>(`SELECT COUNT(*) FROM ${table}`)
    total += parseInt(result.rows[0]?.count || '0', 10)
  }
  return total
}

/**
 * Get current database stats for display before purge
 */
export async function getMovieDatabaseStats(): Promise<DatabaseStats> {
  const existingTables = await getExistingTables(
    EMBEDDING_BASE_TABLES.flatMap(embeddingTableNames)
  )

  const [
    movies,
    series,
    episodes,
    movieEmbeddings,
    seriesEmbeddings,
    episodeEmbeddings,
    watchHistory,
    userRatings,
    recommendations,
    userPreferences,
    assistantConversations,
    assistantMessages,
  ] = await Promise.all([
    query<{ count: string }>('SELECT COUNT(*) FROM movies'),
    query<{ count: string }>('SELECT COUNT(*) FROM series'),
    query<{ count: string }>('SELECT COUNT(*) FROM episodes'),
    countAllEmbeddings('embeddings', existingTables),
    countAllEmbeddings('series_embeddings', existingTables),
    countAllEmbeddings('episode_embeddings', existingTables),
    query<{ count: string }>('SELECT COUNT(*) FROM watch_history'),
    query<{ count: string }>('SELECT COUNT(*) FROM user_ratings'),
    query<{ count: string }>('SELECT COUNT(*) FROM recommendation_candidates'),
    query<{ count: string }>('SELECT COUNT(*) FROM user_preferences'),
    query<{ count: string }>('SELECT COUNT(*) FROM assistant_conversations'),
    query<{ count: string }>('SELECT COUNT(*) FROM assistant_messages'),
  ])

  return {
    movies: parseInt(movies.rows[0]?.count || '0', 10),
    series: parseInt(series.rows[0]?.count || '0', 10),
    episodes: parseInt(episodes.rows[0]?.count || '0', 10),
    movieEmbeddings, // Already a number from countAllEmbeddings
    seriesEmbeddings, // Already a number from countAllEmbeddings
    episodeEmbeddings, // Already a number from countAllEmbeddings
    watchHistory: parseInt(watchHistory.rows[0]?.count || '0', 10),
    userRatings: parseInt(userRatings.rows[0]?.count || '0', 10),
    recommendations: parseInt(recommendations.rows[0]?.count || '0', 10),
    userPreferences: parseInt(userPreferences.rows[0]?.count || '0', 10),
    assistantConversations: parseInt(assistantConversations.rows[0]?.count || '0', 10),
    assistantMessages: parseInt(assistantMessages.rows[0]?.count || '0', 10),
  }
}

