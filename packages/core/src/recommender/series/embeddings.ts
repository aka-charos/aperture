import { createChildLogger } from '../../lib/logger.js'
import { query, queryOne } from '../../lib/db.js'
import {
  createJobProgress,
  setJobStep,
  updateJobProgress,
  addLog,
  completeJob,
  failJob,
} from '../../jobs/progress.js'
import {
  getEmbeddingModelInstance,
  isAIFunctionConfigured,
  getFunctionConfig,
  getActiveEmbeddingTableName,
} from '../../lib/ai-provider.js'
import { embedMany } from 'ai'
import { randomUUID } from 'crypto'
import { getEpisodeEmbeddingsEnabled } from '../../settings/systemSettings.js'
// One version for both media types: a builder change invalidates whichever
// texts it touched, and two counters would drift.
import { CANONICAL_TEXT_VERSION, PLOT_CHARS } from '../movies/embeddings.js'

const logger = createChildLogger('embeddings-series')

interface SeriesForEmbedding {
  id: string
  title: string
  year: number | null
  endYear: number | null
  genres: string[]
  overview: string | null
  tagline: string | null
  status: string | null
  network: string | null
  directors: string[] | null // Showrunners/Creators
  actors: Array<{ name: string; role?: string }> | null
  studios: Array<{ id?: string; name: string }> | null
  contentRating: string | null
  tags: string[] | null
  productionCountries: string[] | null
  awards: string | null
  totalSeasons: number | null
  totalEpisodes: number | null
  // Enrichment output — see the movie builder for why these were missing
  keywords: string[] | null
  languages: string[] | null
  awardsSummary: string | null
  plotFull: string | null
}

/**
 * A series whose vector is missing or out of date, carrying the text that was
 * embedded last time so the caller can skip an unchanged one.
 */
export interface SeriesNeedingEmbedding extends SeriesForEmbedding {
  storedCanonicalText: string | null
}

/** Mirrors the movie builder's cap. */
const MAX_KEYWORDS = 18

/**
 * Missing, built by an older builder, or enriched since it was embedded.
 * Mirrors MOVIE_STALE_SQL — the two pipelines must agree or one media type
 * silently keeps stale vectors. `updated_at` rather than `created_at` for the
 * same reason: the upsert preserves created_at, so it would never clear.
 */
export const SERIES_STALE_SQL = `(
        e.id IS NULL
        OR COALESCE(e.text_version, 0) < ${CANONICAL_TEXT_VERSION}
        OR (s.enriched_at IS NOT NULL AND e.updated_at < s.enriched_at)
      )`

interface EpisodeForEmbedding {
  id: string
  seriesId: string
  seriesTitle: string
  seasonNumber: number
  episodeNumber: number
  title: string
  overview: string | null
  year: number | null
  directors: string[] | null
  writers: string[] | null
  guestStars: Array<{ name: string; role?: string }> | null
}

interface SeriesEmbeddingResult {
  seriesId: string
  embedding: number[]
  canonicalText: string
}

interface EpisodeEmbeddingResult {
  episodeId: string
  embedding: number[]
  canonicalText: string
}

/**
 * Build canonical text for embedding a TV series
 *
 * This creates a rich semantic representation that captures:
 * - Core identity (title, year range, genres)
 * - Creative DNA (showrunners, network, lead actors)
 * - Thematic content (overview, tagline, tags)
 * - Context (rating, country, awards, status)
 */
export function buildSeriesCanonicalText(series: SeriesForEmbedding): string {
  const sections: string[] = []

  // === SECTION 1: Core Identity ===
  //
  // No year range, mirroring the movie builder -- see the long note there for
  // the measurement that prompted it and the prediction it is testing.
  //
  // Nothing is lost but the numbers: whether a show is still running was never
  // carried by "(2010-present)" alone, because `status` is pushed as its own
  // section immediately below ("Continuing TV Series").
  sections.push(series.title)

  // Series type indicator
  if (series.status) {
    sections.push(`${series.status} TV Series`)
  } else {
    sections.push('TV Series')
  }

  // Tagline often captures the tone/theme
  if (series.tagline) {
    sections.push(`"${series.tagline}"`)
  }

  // === SECTION 2: Classification ===
  // Genres are primary classification
  if (series.genres && series.genres.length > 0) {
    sections.push(`Genres: ${series.genres.join(', ')}`)
  }

  // Content rating is deliberately absent — see the movie builder.

  // === SECTION 3: Creative DNA ===
  // Network influences style (HBO vs Netflix vs Network TV)
  if (series.network) {
    sections.push(`Network: ${series.network}`)
  }

  // Showrunners/Creators (stored as directors)
  if (series.directors && series.directors.length > 0) {
    sections.push(`Created by ${series.directors.join(', ')}`)
  }

  // Studios
  if (series.studios && series.studios.length > 0) {
    const topStudios = series.studios.slice(0, 2).map((s) => s.name)
    sections.push(`Studio: ${topStudios.join(', ')}`)
  }

  // Lead actors (top 4 for series)
  if (series.actors && series.actors.length > 0) {
    const leadActors = series.actors.slice(0, 4).map((a) => {
      if (a.role) {
        return `${a.name} as ${a.role}`
      }
      return a.name
    })
    sections.push(`Starring ${leadActors.join(', ')}`)
  }

  // === SECTION 4: Thematic Content ===
  // Primary semantic content — IMDb's long synopsis where it beats the media
  // server's blurb. Instead of, never alongside: both tell the same story, and
  // including both would weight plot twice against genre, creator and
  // keywords. See the movie builder for the cap's reasoning.
  const synopsis =
    series.plotFull && (!series.overview || series.plotFull.length > series.overview.length)
      ? series.plotFull
      : series.overview
  if (synopsis) {
    const maxOverviewLength = PLOT_CHARS
    const text =
      synopsis.length > maxOverviewLength
        ? synopsis.substring(0, maxOverviewLength) + '...'
        : synopsis
    sections.push(text)
  }

  // Tags capture thematic elements
  if (series.tags && series.tags.length > 0) {
    sections.push(`Themes: ${series.tags.join(', ')}`)
  }

  // TMDb keywords — the concept vocabulary. Same reasoning as the movie
  // builder: a style or subject almost never appears in a synopsis.
  if (series.keywords && series.keywords.length > 0) {
    sections.push(`Keywords: ${series.keywords.slice(0, MAX_KEYWORDS).join(', ')}`)
  }

  // === SECTION 5: Context ===
  // Series scope (seasons/episodes)
  if (series.totalSeasons && series.totalEpisodes) {
    sections.push(`${series.totalSeasons} seasons, ${series.totalEpisodes} episodes`)
  } else if (series.totalSeasons) {
    sections.push(`${series.totalSeasons} seasons`)
  }

  // Production country affects style
  if (series.productionCountries && series.productionCountries.length > 0) {
    const countries = series.productionCountries.slice(0, 2)
    sections.push(`From ${countries.join(', ')}`)
  }

  // Spoken language, which the country does not imply
  if (series.languages && series.languages.length > 0) {
    sections.push(`In ${series.languages.slice(0, 3).join(', ')}`)
  }

  // Awards are deliberately absent — see the movie builder.

  return sections.join('. ')
}

/**
 * Build canonical text for embedding an episode
 *
 * This creates a focused representation that captures:
 * - Episode identity (series, season, episode number, title)
 * - Episode-specific content (overview, guest stars)
 * - Creative credits (director, writers)
 *
 * Episode embeddings complement series embeddings by capturing
 * individual storylines and guest appearances.
 */
export function buildEpisodeCanonicalText(episode: EpisodeForEmbedding): string {
  const sections: string[] = []

  // === SECTION 1: Episode Identity ===
  sections.push(
    `${episode.seriesTitle} - Season ${episode.seasonNumber}, Episode ${episode.episodeNumber}`
  )
  sections.push(`"${episode.title}"`)

  if (episode.year) {
    sections.push(`(${episode.year})`)
  }

  // === SECTION 2: Episode Content ===
  if (episode.overview) {
    // Episodes need more compact overviews since there are many
    const maxOverviewLength = 500
    const overview =
      episode.overview.length > maxOverviewLength
        ? episode.overview.substring(0, maxOverviewLength) + '...'
        : episode.overview
    sections.push(overview)
  }

  // === SECTION 3: Creative Credits ===
  if (episode.directors && episode.directors.length > 0) {
    sections.push(`Directed by ${episode.directors.join(', ')}`)
  }

  if (episode.writers && episode.writers.length > 0) {
    sections.push(`Written by ${episode.writers.join(', ')}`)
  }

  // === SECTION 4: Guest Stars ===
  if (episode.guestStars && episode.guestStars.length > 0) {
    const guests = episode.guestStars.slice(0, 5).map((g) => g.name)
    sections.push(`Guest starring ${guests.join(', ')}`)
  }

  return sections.join('. ')
}

/**
 * Generate embeddings for a batch of series
 */
export async function embedSeries(series: SeriesForEmbedding[]): Promise<SeriesEmbeddingResult[]> {
  if (series.length === 0) {
    return []
  }

  const embeddingModel = await getEmbeddingModelInstance()
  const config = await getFunctionConfig('embeddings')

  // Build canonical texts
  const textsWithIds = series.map((s) => ({
    seriesId: s.id,
    text: buildSeriesCanonicalText(s),
  }))

  logger.info(
    { count: textsWithIds.length, provider: config?.provider, model: config?.model },
    'Generating series embeddings'
  )

  const batchSize = 100
  const results: SeriesEmbeddingResult[] = []

  for (let i = 0; i < textsWithIds.length; i += batchSize) {
    const batch = textsWithIds.slice(i, i + batchSize)
    const texts = batch.map((t) => t.text)

    // Use AI SDK embedMany for batch embedding
    const { embeddings } = await embedMany({
      model: embeddingModel,
      values: texts,
    })

    for (let j = 0; j < batch.length; j++) {
      results.push({
        seriesId: batch[j].seriesId,
        embedding: embeddings[j],
        canonicalText: batch[j].text,
      })
    }

    logger.debug(
      { batch: Math.floor(i / batchSize) + 1, total: Math.ceil(textsWithIds.length / batchSize) },
      'Series batch completed'
    )
  }

  return results
}

/**
 * Generate embeddings for a batch of episodes
 */
export async function embedEpisodes(
  episodes: EpisodeForEmbedding[]
): Promise<EpisodeEmbeddingResult[]> {
  if (episodes.length === 0) {
    return []
  }

  const embeddingModel = await getEmbeddingModelInstance()
  const config = await getFunctionConfig('embeddings')

  // Build canonical texts
  const textsWithIds = episodes.map((e) => ({
    episodeId: e.id,
    text: buildEpisodeCanonicalText(e),
  }))

  logger.info(
    { count: textsWithIds.length, provider: config?.provider, model: config?.model },
    'Generating episode embeddings'
  )

  const batchSize = 100
  const results: EpisodeEmbeddingResult[] = []

  for (let i = 0; i < textsWithIds.length; i += batchSize) {
    const batch = textsWithIds.slice(i, i + batchSize)
    const texts = batch.map((t) => t.text)

    // Use AI SDK embedMany for batch embedding
    const { embeddings } = await embedMany({
      model: embeddingModel,
      values: texts,
    })

    for (let j = 0; j < batch.length; j++) {
      results.push({
        episodeId: batch[j].episodeId,
        embedding: embeddings[j],
        canonicalText: batch[j].text,
      })
    }

    logger.debug(
      { batch: Math.floor(i / batchSize) + 1, total: Math.ceil(textsWithIds.length / batchSize) },
      'Episode batch completed'
    )
  }

  return results
}

/**
 * Store series embeddings in the database
 */
export async function storeSeriesEmbeddings(embeddings: SeriesEmbeddingResult[]): Promise<void> {
  const config = await getFunctionConfig('embeddings')
  const modelName = config ? `${config.provider}:${config.model}` : 'unknown'
  const tableName = await getActiveEmbeddingTableName('series_embeddings')

  await query(
    `INSERT INTO ${tableName} (series_id, model, embedding, canonical_text, text_version, updated_at)
     SELECT t.series_id, t.model, t.embedding, t.canonical_text, $5, NOW()
     FROM unnest($1::uuid[], $2::text[], $3::halfvec[], $4::text[])
     AS t(series_id, model, embedding, canonical_text)
     ON CONFLICT (series_id, model) DO UPDATE SET
       embedding = EXCLUDED.embedding,
       canonical_text = EXCLUDED.canonical_text,
       text_version = EXCLUDED.text_version,
       -- created_at survives the upsert, so staleness reads updated_at.
       updated_at = NOW()`,
    [
      embeddings.map((emb) => emb.seriesId),
      Array(embeddings.length).fill(modelName),
      embeddings.map((emb) => `[${emb.embedding.join(',')}]`),
      embeddings.map((emb) => emb.canonicalText),
      CANONICAL_TEXT_VERSION,
    ]
  )

  logger.info({ count: embeddings.length, table: tableName }, 'Series embeddings stored')
}

/**
 * Mark stored series embeddings as current without re-embedding them.
 * Mirrors markEmbeddingsCurrent on the movie side.
 */
export async function markSeriesEmbeddingsCurrent(seriesIds: string[]): Promise<void> {
  if (seriesIds.length === 0) return

  const config = await getFunctionConfig('embeddings')
  const modelName = config ? `${config.provider}:${config.model}` : 'unknown'
  const tableName = await getActiveEmbeddingTableName('series_embeddings')

  await query(
    `UPDATE ${tableName}
        SET text_version = $3, updated_at = NOW()
      WHERE model = $2 AND series_id = ANY($1::uuid[])`,
    [seriesIds, modelName, CANONICAL_TEXT_VERSION]
  )
}

/**
 * Store episode embeddings in the database
 */
export async function storeEpisodeEmbeddings(embeddings: EpisodeEmbeddingResult[]): Promise<void> {
  const config = await getFunctionConfig('embeddings')
  const modelName = config ? `${config.provider}:${config.model}` : 'unknown'
  const tableName = await getActiveEmbeddingTableName('episode_embeddings')

  await query(
    `INSERT INTO ${tableName} (episode_id, model, embedding, canonical_text)
     SELECT t.episode_id, t.model, t.embedding, t.canonical_text
     FROM unnest($1::uuid[], $2::text[], $3::halfvec[], $4::text[])
     AS t(episode_id, model, embedding, canonical_text)
     ON CONFLICT (episode_id, model) DO UPDATE SET
       embedding = EXCLUDED.embedding,
       canonical_text = EXCLUDED.canonical_text`,
    [
      embeddings.map((emb) => emb.episodeId),
      Array(embeddings.length).fill(modelName),
      embeddings.map((emb) => `[${emb.embedding.join(',')}]`),
      embeddings.map((emb) => emb.canonicalText),
    ]
  )

  logger.info({ count: embeddings.length, table: tableName }, 'Episode embeddings stored')
}

/**
 * Get series that don't have embeddings yet (with full metadata)
 */
export async function getSeriesNeedingEmbeddings(limit = 100): Promise<SeriesNeedingEmbedding[]> {
  const config = await getFunctionConfig('embeddings')
  const modelName = config ? `${config.provider}:${config.model}` : 'unknown'
  const tableName = await getActiveEmbeddingTableName('series_embeddings')

  // Check if any TV library configs exist
  const configCheck = await queryOne<{ count: string }>(
    "SELECT COUNT(*) FROM library_config WHERE collection_type = 'tvshows'"
  )
  const hasTvLibraryConfigs = configCheck && parseInt(configCheck.count, 10) > 0

  const result = await query<{
    id: string
    title: string
    year: number | null
    end_year: number | null
    genres: string[]
    overview: string | null
    tagline: string | null
    status: string | null
    network: string | null
    directors: string[] | null
    actors: string | null
    studios: string | null
    content_rating: string | null
    tags: string[] | null
    production_countries: string[] | null
    awards: string | null
    total_seasons: number | null
    total_episodes: number | null
    keywords: string[] | null
    languages: string[] | null
    awards_summary: string | null
    plot_full: string | null
    stored_canonical_text: string | null
  }>(
    hasTvLibraryConfigs
      ? `SELECT s.id, s.title, s.year, s.end_year, s.genres, s.overview,
                s.tagline, s.status, s.network, s.directors, s.actors::text, s.studios::text,
                s.content_rating, s.tags, s.production_countries, s.awards,
                s.total_seasons, s.total_episodes,
                s.keywords, s.languages, s.awards_summary, s.plot_full,
                e.canonical_text AS stored_canonical_text
         FROM series s
         LEFT JOIN ${tableName} e ON e.series_id = s.id AND e.model = $1
         WHERE ${SERIES_STALE_SQL}
           AND EXISTS (
             SELECT 1 FROM library_config lc
             WHERE lc.provider_library_id = s.provider_library_id
               AND lc.is_enabled = true
           )
         LIMIT $2`
      : `SELECT s.id, s.title, s.year, s.end_year, s.genres, s.overview,
                s.tagline, s.status, s.network, s.directors, s.actors::text, s.studios::text,
                s.content_rating, s.tags, s.production_countries, s.awards,
                s.total_seasons, s.total_episodes,
                s.keywords, s.languages, s.awards_summary, s.plot_full,
                e.canonical_text AS stored_canonical_text
         FROM series s
         LEFT JOIN ${tableName} e ON e.series_id = s.id AND e.model = $1
         WHERE ${SERIES_STALE_SQL}
         LIMIT $2`,
    [modelName, limit]
  )

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    year: row.year,
    endYear: row.end_year,
    genres: row.genres,
    overview: row.overview,
    tagline: row.tagline,
    status: row.status,
    network: row.network,
    directors: row.directors,
    actors: row.actors ? JSON.parse(row.actors) : null,
    studios: row.studios ? JSON.parse(row.studios) : null,
    contentRating: row.content_rating,
    tags: row.tags,
    productionCountries: row.production_countries,
    awards: row.awards,
    totalSeasons: row.total_seasons,
    totalEpisodes: row.total_episodes,
    keywords: row.keywords,
    languages: row.languages,
    awardsSummary: row.awards_summary,
    plotFull: row.plot_full,
    storedCanonicalText: row.stored_canonical_text,
  }))
}

/**
 * Get episodes that don't have embeddings yet
 */
export async function getEpisodesWithoutEmbeddings(limit = 100): Promise<EpisodeForEmbedding[]> {
  const config = await getFunctionConfig('embeddings')
  const modelName = config ? `${config.provider}:${config.model}` : 'unknown'
  const tableName = await getActiveEmbeddingTableName('episode_embeddings')

  const result = await query<{
    id: string
    series_id: string
    series_title: string
    season_number: number
    episode_number: number
    title: string
    overview: string | null
    year: number | null
    directors: string[] | null
    writers: string[] | null
    guest_stars: string | null
  }>(
    `SELECT e.id, e.series_id, s.title as series_title,
            e.season_number, e.episode_number, e.title,
            e.overview, e.year, e.directors, e.writers, e.guest_stars::text
     FROM episodes e
     JOIN series s ON s.id = e.series_id
     LEFT JOIN ${tableName} ee ON ee.episode_id = e.id AND ee.model = $1
     WHERE ee.id IS NULL
     LIMIT $2`,
    [modelName, limit]
  )

  return result.rows.map((row) => ({
    id: row.id,
    seriesId: row.series_id,
    seriesTitle: row.series_title,
    seasonNumber: row.season_number,
    episodeNumber: row.episode_number,
    title: row.title,
    overview: row.overview,
    year: row.year,
    directors: row.directors,
    writers: row.writers,
    guestStars: row.guest_stars ? JSON.parse(row.guest_stars) : null,
  }))
}

export interface GenerateSeriesEmbeddingsResult {
  seriesGenerated: number
  episodesGenerated: number
  failed: number
  jobId: string
}

/**
 * Generate and store embeddings for all series and episodes missing them
 *
 * `includeEpisodes` used to be a default-true parameter no caller ever passed,
 * which made episode vectors unconditional — and for a long time nothing read
 * them, so every new episode bought an embedding call for a table with no
 * consumer. It is now an admin setting, and an explicit argument still wins so
 * a caller that has already decided is not second-guessed by config.
 */
export async function generateMissingSeriesEmbeddings(
  existingJobId?: string,
  includeEpisodes?: boolean
): Promise<GenerateSeriesEmbeddingsResult> {
  // Resolved before createJobProgress: the step count, and therefore the whole
  // progress bar, depends on whether episodes are in scope.
  const shouldEmbedEpisodes = includeEpisodes ?? (await getEpisodeEmbeddingsEnabled())
  const jobId = existingJobId || randomUUID()
  createJobProgress(jobId, 'generate-series-embeddings', shouldEmbedEpisodes ? 4 : 3)

  try {
    // Step 1: Check AI provider configuration
    setJobStep(jobId, 0, 'Checking AI configuration')

    const isConfigured = await isAIFunctionConfigured('embeddings')
    const config = await getFunctionConfig('embeddings')

    if (!isConfigured || !config) {
      addLog(jobId, 'error', '❌ Embedding provider is not configured!')
      addLog(jobId, 'info', '💡 Go to Settings > AI to configure your embedding provider')
      completeJob(jobId, { seriesGenerated: 0, episodesGenerated: 0, failed: 0 })
      return { seriesGenerated: 0, episodesGenerated: 0, failed: 0, jobId }
    }

    const modelName = `${config.provider}:${config.model}`
    addLog(jobId, 'info', `🤖 Using embedding provider: ${config.provider}, model: ${config.model}`)

    // Step 2: Count series needing embeddings
    setJobStep(jobId, 1, 'Counting series without embeddings')
    const seriesTableName = await getActiveEmbeddingTableName('series_embeddings')

    // Same predicate as the selection, or the counter and the loop disagree.
    const seriesCountResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM series s
       LEFT JOIN ${seriesTableName} e ON e.series_id = s.id AND e.model = $1
       WHERE ${SERIES_STALE_SQL}`,
      [modelName]
    )

    const totalSeriesNeeded = parseInt(seriesCountResult.rows[0]?.count || '0', 10)
    addLog(jobId, 'info', `📺 Found ${totalSeriesNeeded} series needing embeddings`)

    // Step 3: Generate series embeddings
    setJobStep(jobId, 2, 'Generating series embeddings', totalSeriesNeeded)

    let seriesGenerated = 0
    let seriesUnchanged = 0
    let totalFailed = 0
    const batchSize = 25

    if (totalSeriesNeeded > 0) {
      // One attempt per row per run — see the movie job. The loop reads until
      // the selection empties, so a row that survives being handled hangs it.
      const attempted = new Set<string>()

      for (;;) {
        const fetched = await getSeriesNeedingEmbeddings(batchSize)
        const batch = fetched.filter((s) => !attempted.has(s.id))
        if (batch.length === 0) break
        for (const series of batch) attempted.add(series.id)

        // Stale but unchanged: restamp, don't re-embed.
        const changed: SeriesNeedingEmbedding[] = []
        const unchanged: string[] = []
        for (const series of batch) {
          if (
            series.storedCanonicalText !== null &&
            series.storedCanonicalText === buildSeriesCanonicalText(series)
          ) {
            unchanged.push(series.id)
          } else {
            changed.push(series)
          }
        }

        if (unchanged.length > 0) {
          await markSeriesEmbeddingsCurrent(unchanged)
          seriesUnchanged += unchanged.length
        }

        if (changed.length > 0) {
          addLog(jobId, 'info', `🧠 Processing batch of ${changed.length} series...`)

          try {
            const embeddings = await embedSeries(changed)
            await storeSeriesEmbeddings(embeddings)

            seriesGenerated += embeddings.length

            addLog(
              jobId,
              'info',
              `✅ Batch complete: ${embeddings.length} series embeddings generated`
            )
          } catch (err) {
            const error = err instanceof Error ? err.message : 'Unknown error'
            addLog(jobId, 'error', `❌ Series batch failed: ${error}`)
            totalFailed += changed.length

            if (error.includes('rate_limit') || error.includes('429')) {
              addLog(jobId, 'warn', '⏳ Rate limited - waiting 60 seconds...')
              await new Promise((resolve) => setTimeout(resolve, 60000))
            } else if (error.includes('insufficient_quota') || error.includes('402')) {
              addLog(jobId, 'error', '💳 API quota exceeded - stopping job')
              break
            }
          }
        }

        const handled = seriesGenerated + seriesUnchanged + totalFailed
        updateJobProgress(jobId, handled, totalSeriesNeeded, `Processed ${handled}/${totalSeriesNeeded}`)
      }
    }

    // Step 4: Generate episode embeddings (if enabled)
    let episodesGenerated = 0

    if (shouldEmbedEpisodes) {
      setJobStep(jobId, 3, 'Counting episodes without embeddings')
      const episodeTableName = await getActiveEmbeddingTableName('episode_embeddings')

      const episodeCountResult = await query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM episodes e
         LEFT JOIN ${episodeTableName} ee ON ee.episode_id = e.id AND ee.model = $1
         WHERE ee.id IS NULL`,
        [modelName]
      )

      const totalEpisodesNeeded = parseInt(episodeCountResult.rows[0]?.count || '0', 10)
      addLog(jobId, 'info', `📺 Found ${totalEpisodesNeeded} episodes needing embeddings`)

      if (totalEpisodesNeeded > 0) {
        let batch: EpisodeForEmbedding[]
        const episodeBatchSize = 50 // Larger batches for episodes since they're simpler

        do {
          batch = await getEpisodesWithoutEmbeddings(episodeBatchSize)

          if (batch.length > 0) {
            if (episodesGenerated % 500 === 0) {
              addLog(jobId, 'info', `🧠 Processing batch of ${batch.length} episodes...`)
            }

            try {
              const embeddings = await embedEpisodes(batch)
              await storeEpisodeEmbeddings(embeddings)

              episodesGenerated += embeddings.length

              if (episodesGenerated % 500 === 0) {
                updateJobProgress(
                  jobId,
                  episodesGenerated,
                  totalEpisodesNeeded,
                  `Generated ${episodesGenerated}/${totalEpisodesNeeded} episodes`
                )
                addLog(
                  jobId,
                  'info',
                  `✅ Progress: ${episodesGenerated} episode embeddings generated`
                )
              }
            } catch (err) {
              const error = err instanceof Error ? err.message : 'Unknown error'
              addLog(jobId, 'error', `❌ Episode batch failed: ${error}`)
              totalFailed += batch.length

              if (error.includes('rate_limit') || error.includes('429')) {
                addLog(jobId, 'warn', '⏳ Rate limited - waiting 60 seconds...')
                await new Promise((resolve) => setTimeout(resolve, 60000))
              } else if (error.includes('insufficient_quota') || error.includes('402')) {
                addLog(jobId, 'error', '💳 API quota exceeded - stopping job')
                break
              }
            }
          }
        } while (batch.length > 0)
      }
    }

    const finalResult = { seriesGenerated, episodesGenerated, failed: totalFailed, jobId }
    completeJob(jobId, finalResult)

    addLog(
      jobId,
      'info',
      `🎉 Series embedding generation complete: ${seriesGenerated} series, ${episodesGenerated} episodes, ${totalFailed} failed`
    )

    return finalResult
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    failJob(jobId, error)
    throw err
  }
}

/**
 * Get embedding for a specific series
 */
/**
 * Vectors for a set of series, in one round trip.
 *
 * The per-id version below is fine for a single lookup and is an N+1 anywhere
 * a list is involved -- which diversity selection is, once redundancy is
 * measured in embedding space rather than by counting genre labels.
 */
export async function getSeriesEmbeddings(seriesIds: string[]): Promise<Map<string, number[]>> {
  const byId = new Map<string, number[]>()
  if (seriesIds.length === 0) return byId

  const config = await getFunctionConfig('embeddings')
  const modelName = config ? `${config.provider}:${config.model}` : 'unknown'
  const tableName = await getActiveEmbeddingTableName('series_embeddings')

  const result = await query<{ series_id: string; embedding: string }>(
    `SELECT series_id, embedding::text FROM ${tableName} WHERE series_id = ANY($1) AND model = $2`,
    [seriesIds, modelName]
  )

  for (const row of result.rows) {
    byId.set(row.series_id, row.embedding.replace(/[[\]]/g, '').split(',').map(Number))
  }

  return byId
}

export async function getSeriesEmbedding(seriesId: string): Promise<number[] | null> {
  const config = await getFunctionConfig('embeddings')
  const modelName = config ? `${config.provider}:${config.model}` : 'unknown'
  const tableName = await getActiveEmbeddingTableName('series_embeddings')

  const result = await queryOne<{ embedding: string }>(
    `SELECT embedding::text FROM ${tableName} WHERE series_id = $1 AND model = $2`,
    [seriesId, modelName]
  )

  if (!result) {
    return null
  }

  const vectorStr = result.embedding.replace(/[[\]]/g, '')
  return vectorStr.split(',').map(Number)
}

/**
 * Get embedding for a specific episode
 */
export async function getEpisodeEmbedding(episodeId: string): Promise<number[] | null> {
  const config = await getFunctionConfig('embeddings')
  const modelName = config ? `${config.provider}:${config.model}` : 'unknown'
  const tableName = await getActiveEmbeddingTableName('episode_embeddings')

  const result = await queryOne<{ embedding: string }>(
    `SELECT embedding::text FROM ${tableName} WHERE episode_id = $1 AND model = $2`,
    [episodeId, modelName]
  )

  if (!result) {
    return null
  }

  const vectorStr = result.embedding.replace(/[[\]]/g, '')
  return vectorStr.split(',').map(Number)
}

/**
 * Get all episode embeddings for a series (for computing series taste from episodes)
 */
export async function getSeriesEpisodeEmbeddings(
  seriesId: string
): Promise<Array<{ episodeId: string; embedding: number[] }>> {
  const config = await getFunctionConfig('embeddings')
  const modelName = config ? `${config.provider}:${config.model}` : 'unknown'
  const tableName = await getActiveEmbeddingTableName('episode_embeddings')

  const result = await query<{ episode_id: string; embedding: string }>(
    `SELECT ee.episode_id, ee.embedding::text
     FROM ${tableName} ee
     JOIN episodes e ON e.id = ee.episode_id
     WHERE e.series_id = $1 AND ee.model = $2`,
    [seriesId, modelName]
  )

  return result.rows.map((row) => ({
    episodeId: row.episode_id,
    embedding: row.embedding.replace(/[[\]]/g, '').split(',').map(Number),
  }))
}
