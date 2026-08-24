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
import { embed, embedMany } from 'ai'
import { randomUUID } from 'crypto'

const logger = createChildLogger('embeddings')

interface Movie {
  id: string
  title: string
  year: number | null
  genres: string[]
  overview: string | null
  // Extended metadata for richer embeddings
  tagline: string | null
  directors: string[] | null
  actors: Array<{ name: string; role?: string }> | null
  studios: Array<{ id?: string; name: string }> | null
  contentRating: string | null
  tags: string[] | null
  productionCountries: string[] | null
  awards: string | null
  // Enrichment output (TMDb keywords/collection/crew, OMDb languages/awards)
  keywords: string[] | null
  collectionName: string | null
  composers: string[] | null
  cinematographers: string[] | null
  languages: string[] | null
  awardsSummary: string | null
  plotFull: string | null
}

/**
 * Bumped whenever buildCanonicalText changes what it emits, so the embedding
 * job can find rows whose stored text was produced by an older build. Stored
 * as `text_version` on the embedding row; NULL predates it and reads as stale.
 *
 * Version 1 added the enrichment fields. Before it, the builder read only
 * columns the media-server sync writes — `tags` and `awards` — while the
 * enrichment columns beside them (`keywords`, `awards_summary`) went into no
 * vector at all. The pairs are easy to confuse and were: `0022` added `tags`
 * and `awards` for the sync, `0059` added `keywords` and `awards_summary` for
 * enrichment, and the builder was never repointed.
 */
export const CANONICAL_TEXT_VERSION = 2

/** Enough to characterise a film; a few titles carry 100+ and would drown it. */
const MAX_KEYWORDS = 18

/**
 * How much of a title's synopsis is embedded. See the long note at the use
 * site; exported so the series builder cannot drift from it.
 */
export const PLOT_CHARS = 4000

interface EmbeddingResult {
  movieId: string
  embedding: number[]
  canonicalText: string
}

/**
 * Build canonical text for embedding a movie
 *
 * This creates a rich semantic representation that captures:
 * - Core identity (title, year, genres)
 * - Creative DNA (directors, studios, lead actors)
 * - Thematic content (overview, tagline, tags)
 * - Context (rating, country, awards)
 *
 * The text is structured to emphasize elements that affect similarity:
 * movies with same directors/studios/actors should cluster together,
 * as should movies with similar themes and tones.
 */
export function buildCanonicalText(movie: Movie): string {
  const sections: string[] = []

  // === SECTION 1: Core Identity ===
  // Title and year establish the movie's identity
  const titleLine = movie.year ? `${movie.title} (${movie.year})` : movie.title
  sections.push(titleLine)

  // Tagline often captures the tone/theme brilliantly
  if (movie.tagline) {
    sections.push(`"${movie.tagline}"`)
  }

  // === SECTION 2: Classification ===
  // Genres are primary classification
  if (movie.genres && movie.genres.length > 0) {
    sections.push(`Genres: ${movie.genres.join(', ')}`)
  }

  // Content rating is deliberately absent. "NR" means nobody submitted the
  // film to the MPAA, which tracks age and non-US origin rather than anything
  // about the work, and because it is a literal shared string every old or
  // foreign title in the library carries it — so it functions as an era and
  // nationality detector. Whatever real content signal R vs PG carries is
  // already in genres and keywords, better.

  // === SECTION 3: Creative DNA ===
  // Directors have consistent styles (auteur theory)
  if (movie.directors && movie.directors.length > 0) {
    sections.push(`Directed by ${movie.directors.join(', ')}`)
  }

  // Studios have distinct styles (A24 vs Marvel vs Blumhouse)
  if (movie.studios && movie.studios.length > 0) {
    // Limit to top 2 studios to avoid noise
    const topStudios = movie.studios.slice(0, 2).map((s) => s.name)
    sections.push(`Studio: ${topStudios.join(', ')}`)
  }

  // Below-the-line crew carries real style signal — a Deakins photograph or a
  // Greenwood score is as identifying as the director. TMDb enrichment writes
  // both; nothing else in the app reads them except the NFO writer.
  if (movie.cinematographers && movie.cinematographers.length > 0) {
    sections.push(`Cinematography by ${movie.cinematographers.slice(0, 2).join(', ')}`)
  }

  // Composers are deliberately absent, and cinematographers deliberately are
  // not. The argument for both was that a Deakins photograph or a Greenwood
  // score is as identifying as the director, which is true of perhaps fifty
  // people; for the rest of the ~10,000 crew names in a real library it is a
  // proper noun appearing on two or three titles, contributing nothing to
  // similarity except nationality. Six of the fields here were names or a
  // country, against three describing what a film is like, which is how
  // Metropolis came back nearest to Das Boot. Photography survives that test
  // as a style signal; a single composer credit does not.

  // Lead actors (top 3) influence viewing choices significantly
  if (movie.actors && movie.actors.length > 0) {
    const leadActors = movie.actors.slice(0, 3).map((a) => a.name)
    sections.push(`Starring ${leadActors.join(', ')}`)
  }

  // === SECTION 4: Thematic Content ===
  // Primary semantic content. IMDb's long synopsis when we have one, since it
  // narrates the story — characters, settings, turns — where the media
  // server's blurb only pitches it, and those specifics are what a concept
  // query matches on.
  //
  // Chosen INSTEAD of the overview rather than alongside it: the two describe
  // the same story, and including both would weight plot twice over against
  // genre, crew and keywords. The longer text is picked only when it is
  // actually longer, because OMDb falls back to the short blurb when IMDb has
  // no long synopsis.
  //
  // The 1000-char cap stays. text-embedding-3-small handles 8191 tokens so
  // length is not the constraint — dilution is. A 2,000-word synopsis pulls
  // the vector toward plot minutiae and away from what the film *is*, which
  // costs item-to-item similarity even where it helps query recall.
  // Same condition the hero's "read full synopsis" button uses, so the text
  // that gets embedded is the text a reader can actually see.
  const synopsis =
    movie.plotFull && (!movie.overview || movie.plotFull.length > movie.overview.length)
      ? movie.plotFull
      : movie.overview
  if (synopsis) {
  // The cap is 4000, not 1000 and not absent, and both halves of that matter.
  //
  // `substring(0, 1000)` kept the FIRST thousand characters, which for any real
  // synopsis is the setup — who, where, what the situation is. Setups are the
  // most interchangeable part of any story, so the cap was not merely losing
  // the turn and the ending, it was systematically embedding the one third of
  // every long-plot film that is most like every other. It also largely
  // cancelled the feature it fed: `plot_full` (migration 0139) exists because
  // IMDb's synopsis narrates rather than pitches, and a real one runs 5,000 to
  // 15,000 characters, so keeping the first 10% kept the part most similar to
  // the blurb we already had.
  //
  // Removing it entirely is the other error. `plot_full` is present only where
  // OMDb had a long synopsis, so uncapped a film with 12,000 characters gets a
  // vector that is ~95% plot while one with a 250-character overview gets ~30%
  // plot and 70% metadata — two documents that are not comparable, and cosine
  // starts partly measuring "does this title have an IMDb synopsis". That is
  // the same coverage-asymmetry argument that keeps the title-analysis prose
  // out of here.
  //
  // 4000 captures the turn and the ending for almost every synopsis while
  // keeping every document inside one order of magnitude of every other.
    const maxOverviewLength = PLOT_CHARS
    const text =
      synopsis.length > maxOverviewLength
        ? synopsis.substring(0, maxOverviewLength) + '...'
        : synopsis
    sections.push(text)
  }

  // Tags capture thematic elements (e.g., "time travel", "heist", "dystopia")
  if (movie.tags && movie.tags.length > 0) {
    sections.push(`Themes: ${movie.tags.join(', ')}`)
  }

  // TMDb keywords are the concept vocabulary this text was missing. "film
  // noir", "neo-noir", "dystopia", "one-woman army" are keywords; almost none
  // of them appear in a synopsis, so a semantic search for a *style* had
  // nothing but plot prose to match against. Distinct from `tags`, which comes
  // from the media server and is usually sparse or operator-set.
  if (movie.keywords && movie.keywords.length > 0) {
    sections.push(`Keywords: ${movie.keywords.slice(0, MAX_KEYWORDS).join(', ')}`)
  }

  // === SECTION 5: Context ===
  // Production country affects style, language, cultural context
  if (movie.productionCountries && movie.productionCountries.length > 0) {
    const countries = movie.productionCountries.slice(0, 2)
    sections.push(`From ${countries.join(', ')}`)
  }

  // Spoken language, which country does not imply — a French-language Belgian
  // film and an English-language French co-production read very differently.
  if (movie.languages && movie.languages.length > 0) {
    sections.push(`In ${movie.languages.slice(0, 3).join(', ')}`)
  }

  // Franchise membership, so entries cluster with their siblings rather than
  // relying on title overlap that a renamed sequel does not have.
  if (movie.collectionName) {
    sections.push(`Part of ${movie.collectionName}`)
  }

  // Awards are gone for the reason scores were never here: a bare "82" embeds
  // as noise, and quality already has its own blend term
  // (calculateRatingScore) plus its own filters in Browse. Awards text is that
  // same signal in prose, and worse — it hands every awarded title the tokens
  // "Won", "Oscars", "nominations", so award films cluster with award films
  // regardless of what any of them are about. A prestige detector inside a
  // similarity vector.

  return sections.join('. ')
}

/**
 * Generate embeddings for a batch of movies
 */
export async function embedMovies(movies: Movie[]): Promise<EmbeddingResult[]> {
  if (movies.length === 0) {
    return []
  }

  const embeddingModel = await getEmbeddingModelInstance()
  const config = await getFunctionConfig('embeddings')

  // Build canonical texts
  const textsWithIds = movies.map((movie) => ({
    movieId: movie.id,
    text: buildCanonicalText(movie),
  }))

  logger.info({ count: textsWithIds.length, provider: config?.provider, model: config?.model }, 'Generating embeddings')

  // Process in batches of up to 100 texts
  const batchSize = 100
  const results: EmbeddingResult[] = []

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
        movieId: batch[j].movieId,
        embedding: embeddings[j],
        canonicalText: batch[j].text,
      })
    }

    logger.debug(
      { batch: Math.floor(i / batchSize) + 1, total: Math.ceil(textsWithIds.length / batchSize) },
      'Batch completed'
    )
  }

  return results
}

/**
 * Store embeddings in the database
 */
export async function storeEmbeddings(embeddings: EmbeddingResult[]): Promise<void> {
  const config = await getFunctionConfig('embeddings')
  const modelName = config ? `${config.provider}:${config.model}` : 'unknown'
  const tableName = await getActiveEmbeddingTableName('embeddings')

  await query(
    `INSERT INTO ${tableName} (movie_id, model, embedding, canonical_text, text_version, updated_at)
     SELECT t.movie_id, t.model, t.embedding, t.canonical_text, $5, NOW()
     FROM unnest($1::uuid[], $2::text[], $3::halfvec[], $4::text[])
     AS t(movie_id, model, embedding, canonical_text)
     ON CONFLICT (movie_id, model) DO UPDATE SET
       embedding = EXCLUDED.embedding,
       canonical_text = EXCLUDED.canonical_text,
       text_version = EXCLUDED.text_version,
       -- created_at deliberately survives the upsert, which is exactly why the
       -- staleness check reads updated_at instead.
       updated_at = NOW()`,
    [
      embeddings.map((emb) => emb.movieId),
      Array(embeddings.length).fill(modelName),
      embeddings.map((emb) => `[${emb.embedding.join(',')}]`),
      embeddings.map((emb) => emb.canonicalText),
      CANONICAL_TEXT_VERSION,
    ]
  )

  logger.info({ count: embeddings.length, table: tableName }, 'Embeddings stored')
}

/**
 * A movie whose vector is missing or out of date, carrying the text that was
 * embedded last time so the caller can decide whether anything actually
 * changed before paying for a new embedding.
 */
export interface MovieNeedingEmbedding extends Movie {
  storedCanonicalText: string | null
}

/**
 * The three ways a row can need work.
 *
 * Only the first existed before: `e.id IS NULL`, missing. A row whose metadata
 * changed after it was embedded kept its original vector permanently, and the
 * only cure was truncating every embedding table in the instance.
 *
 * `updated_at`, not `created_at` — storeEmbeddings upserts, so created_at holds
 * the *first* write forever and a row would re-qualify on every pass. The batch
 * loop runs until this selection empties, so that is a job that never ends.
 *
 * The version is interpolated rather than bound, and that is load-bearing: a
 * fragment shared by queries with different parameter lists cannot name a
 * placeholder index without forcing every caller to pad its array to match. The
 * count query has no LIMIT, so padding it meant passing a `$2` that appears
 * nowhere in the SQL — Postgres cannot infer a type for an unreferenced
 * parameter and rejects the whole statement (42P18). It is a numeric constant
 * with a literal type, so there is nothing to escape.
 */
export const MOVIE_STALE_SQL = `(
        e.id IS NULL
        OR COALESCE(e.text_version, 0) < ${CANONICAL_TEXT_VERSION}
        OR (m.enriched_at IS NOT NULL AND e.updated_at < m.enriched_at)
      )`

/**
 * Get movies whose embedding is missing or stale (with full metadata)
 * Only includes movies from enabled libraries
 */
export async function getMoviesNeedingEmbeddings(limit = 100): Promise<MovieNeedingEmbedding[]> {
  const config = await getFunctionConfig('embeddings')
  const modelName = config ? `${config.provider}:${config.model}` : 'unknown'
  const tableName = await getActiveEmbeddingTableName('embeddings')

  // Check if any library configs exist
  const configCheck = await queryOne<{ count: string }>('SELECT COUNT(*) FROM library_config')
  const hasLibraryConfigs = configCheck && parseInt(configCheck.count, 10) > 0

  const result = await query<{
    id: string
    title: string
    year: number | null
    genres: string[]
    overview: string | null
    tagline: string | null
    directors: string[] | null
    actors: string | null
    studios: string | null
    content_rating: string | null
    tags: string[] | null
    production_countries: string[] | null
    awards: string | null
    keywords: string[] | null
    collection_name: string | null
    composers: string[] | null
    cinematographers: string[] | null
    languages: string[] | null
    awards_summary: string | null
    plot_full: string | null
    stored_canonical_text: string | null
  }>(
    hasLibraryConfigs
      ? `SELECT m.id, m.title, m.year, m.genres, m.overview,
                m.tagline, m.directors, m.actors::text, m.studios::text,
                m.content_rating, m.tags, m.production_countries, m.awards,
                m.keywords, m.collection_name, m.composers, m.cinematographers,
                m.languages, m.awards_summary, m.plot_full,
                e.canonical_text AS stored_canonical_text
         FROM movies m
         LEFT JOIN ${tableName} e ON e.movie_id = m.id AND e.model = $1
         WHERE ${MOVIE_STALE_SQL}
           AND EXISTS (
             SELECT 1 FROM library_config lc
             WHERE lc.provider_library_id = m.provider_library_id
               AND lc.is_enabled = true
           )
         LIMIT $2`
      : `SELECT m.id, m.title, m.year, m.genres, m.overview,
                m.tagline, m.directors, m.actors::text, m.studios::text,
                m.content_rating, m.tags, m.production_countries, m.awards,
                m.keywords, m.collection_name, m.composers, m.cinematographers,
                m.languages, m.awards_summary, m.plot_full,
                e.canonical_text AS stored_canonical_text
         FROM movies m
         LEFT JOIN ${tableName} e ON e.movie_id = m.id AND e.model = $1
         WHERE ${MOVIE_STALE_SQL}
         LIMIT $2`,
    [modelName, limit]
  )

  // Map database rows to Movie interface
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    year: row.year,
    genres: row.genres,
    overview: row.overview,
    tagline: row.tagline,
    directors: row.directors,
    actors: row.actors ? JSON.parse(row.actors) : null,
    studios: row.studios ? JSON.parse(row.studios) : null,
    contentRating: row.content_rating,
    tags: row.tags,
    productionCountries: row.production_countries,
    awards: row.awards,
    keywords: row.keywords,
    collectionName: row.collection_name,
    composers: row.composers,
    cinematographers: row.cinematographers,
    languages: row.languages,
    awardsSummary: row.awards_summary,
    plotFull: row.plot_full,
    storedCanonicalText: row.stored_canonical_text,
  }))
}

/**
 * Mark a stored embedding as current without re-embedding it.
 *
 * A row can be selected as stale — its text_version is behind, or enrichment
 * touched it — and still produce byte-identical canonical text, because most
 * enrichment passes change columns this text does not read. Re-embedding those
 * is a paid API call for the same vector, and *not* clearing their staleness is
 * an infinite batch loop, so the stamp has to move either way.
 */
export async function markEmbeddingsCurrent(movieIds: string[]): Promise<void> {
  if (movieIds.length === 0) return

  const config = await getFunctionConfig('embeddings')
  const modelName = config ? `${config.provider}:${config.model}` : 'unknown'
  const tableName = await getActiveEmbeddingTableName('embeddings')

  await query(
    `UPDATE ${tableName}
        SET text_version = $3, updated_at = NOW()
      WHERE model = $2 AND movie_id = ANY($1::uuid[])`,
    [movieIds, modelName, CANONICAL_TEXT_VERSION]
  )
}

export interface GenerateEmbeddingsResult {
  generated: number
  failed: number
  /** Selected as stale but the text had not actually changed — no API call. */
  unchanged: number
  jobId: string
}

/**
 * Generate and store embeddings for all movies missing them
 */
export async function generateMissingEmbeddings(
  existingJobId?: string
): Promise<GenerateEmbeddingsResult> {
  const jobId = existingJobId || randomUUID()
  createJobProgress(jobId, 'generate-movie-embeddings', 3)

  try {
    // Step 1: Check AI provider configuration
    setJobStep(jobId, 0, 'Checking AI configuration')

    const isConfigured = await isAIFunctionConfigured('embeddings')
    const config = await getFunctionConfig('embeddings')

    if (!isConfigured || !config) {
      addLog(jobId, 'error', '❌ Embedding provider is not configured!')
      addLog(jobId, 'info', '💡 Go to Settings > AI to configure your embedding provider')
      completeJob(jobId, { generated: 0, failed: 0, skipped: true })
      return { generated: 0, failed: 0, unchanged: 0, jobId }
    }

    const modelName = `${config.provider}:${config.model}`
    addLog(jobId, 'info', `🤖 Using embedding provider: ${config.provider}, model: ${config.model}`)

    // Step 2: Count movies needing embeddings (only from enabled libraries)
    setJobStep(jobId, 1, 'Counting movies needing embeddings')

    // Check if any library configs exist
    const configCheck = await queryOne<{ count: string }>('SELECT COUNT(*) FROM library_config')
    const hasLibraryConfigs = configCheck && parseInt(configCheck.count, 10) > 0
    const tableName = await getActiveEmbeddingTableName('embeddings')

    // Must use the same predicate as the selection, or the counter reports a
    // total the loop never reaches and the job looks stuck or finishes early.
    const countResult = await query<{ count: string }>(
      hasLibraryConfigs
        ? `SELECT COUNT(*) as count
           FROM movies m
           LEFT JOIN ${tableName} e ON e.movie_id = m.id AND e.model = $1
           WHERE ${MOVIE_STALE_SQL}
             AND EXISTS (
               SELECT 1 FROM library_config lc
               WHERE lc.provider_library_id = m.provider_library_id
                 AND lc.is_enabled = true
             )`
        : `SELECT COUNT(*) as count
           FROM movies m
           LEFT JOIN ${tableName} e ON e.movie_id = m.id AND e.model = $1
           WHERE ${MOVIE_STALE_SQL}`,
      [modelName]
    )

    const totalNeeded = parseInt(countResult.rows[0]?.count || '0', 10)

    if (totalNeeded === 0) {
      addLog(jobId, 'info', '✅ All movie embeddings are up to date!')
      completeJob(jobId, { generated: 0, failed: 0, unchanged: 0 })
      return { generated: 0, failed: 0, unchanged: 0, jobId }
    }

    addLog(jobId, 'info', `🎬 Found ${totalNeeded} movies needing embeddings`)

    // Step 3: Generate embeddings in batches
    setJobStep(jobId, 2, 'Generating embeddings', totalNeeded)

    let totalGenerated = 0
    let totalFailed = 0
    let totalUnchanged = 0
    const batchSize = 25 // Smaller batches for better progress feedback

    // The loop reads until the selection stops returning rows, so any row that
    // is still selected after being handled spins it forever. That was already
    // reachable — a batch whose embedding call fails is never stored and comes
    // straight back — and staleness adds two more ways in. One attempt per row
    // per run removes the whole class.
    const attempted = new Set<string>()

    for (;;) {
      const fetched = await getMoviesNeedingEmbeddings(batchSize)
      const batch = fetched.filter((m) => !attempted.has(m.id))
      if (batch.length === 0) break
      for (const movie of batch) attempted.add(movie.id)

      // A row can be stale without its text having moved: enrichment mostly
      // writes columns this text does not read (the scores, the crew nobody
      // renders), and the version bump flags everything regardless. Re-embedding
      // those buys an identical vector for the price of an API call.
      const changed: Array<{ movie: MovieNeedingEmbedding; text: string }> = []
      const unchanged: string[] = []
      for (const movie of batch) {
        const text = buildCanonicalText(movie)
        if (movie.storedCanonicalText !== null && movie.storedCanonicalText === text) {
          unchanged.push(movie.id)
        } else {
          changed.push({ movie, text })
        }
      }

      if (unchanged.length > 0) {
        // Must happen even though nothing was embedded — this is what clears
        // their staleness, and therefore what lets the loop finish.
        await markEmbeddingsCurrent(unchanged)
        totalUnchanged += unchanged.length
      }

      if (changed.length > 0) {
        addLog(jobId, 'info', `🧠 Processing batch of ${changed.length} movies...`)

        // Log some movie titles
        const movieTitles = changed.slice(0, 3).map((c) => `${c.movie.title} (${c.movie.year || 'N/A'})`)
        addLog(
          jobId,
          'debug',
          `  Including: ${movieTitles.join(', ')}${changed.length > 3 ? '...' : ''}`
        )

        try {
          // Generate embeddings
          const embeddings = await embedMovies(changed.map((c) => c.movie))

          // Store them
          await storeEmbeddings(embeddings)

          totalGenerated += embeddings.length

          addLog(
            jobId,
            'info',
            `✅ Batch complete: ${embeddings.length} embeddings generated (${totalGenerated}/${totalNeeded} total)`
          )

          // Estimate cost
          const estimatedTokens = changed.reduce(
            (sum, c) => sum + Math.ceil(c.text.length / 4), // Rough token estimate
            0
          )
          addLog(jobId, 'debug', `  Estimated tokens: ~${estimatedTokens}`, { estimatedTokens })
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Unknown error'
          addLog(jobId, 'error', `❌ Batch failed: ${error}`)
          totalFailed += changed.length

          // Continue with next batch
          if (error.includes('rate_limit') || error.includes('429')) {
            addLog(jobId, 'warn', '⏳ Rate limited - waiting 60 seconds...')
            await new Promise((resolve) => setTimeout(resolve, 60000))
          } else if (error.includes('insufficient_quota') || error.includes('402')) {
            addLog(jobId, 'error', '💳 API quota exceeded - stopping job')
            break
          }
        }
      }

      // Skipped rows are progress too, or the bar stalls on a run that is
      // mostly re-verification.
      const handled = totalGenerated + totalUnchanged + totalFailed
      updateJobProgress(jobId, handled, totalNeeded, `Processed ${handled}/${totalNeeded}`)
    }

    const finalResult = {
      generated: totalGenerated,
      failed: totalFailed,
      unchanged: totalUnchanged,
      jobId,
    }
    completeJob(jobId, finalResult)

    addLog(
      jobId,
      'info',
      `🎉 Embedding generation complete: ${totalGenerated} generated, ${totalUnchanged} already current, ${totalFailed} failed`
    )

    return finalResult
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    failJob(jobId, error)
    throw err
  }
}

/**
 * Embed an arbitrary piece of text with the configured embedding model.
 * Same vector space as movie embeddings, so the result can be blended into a
 * taste profile or used directly in a similarity search. Returns null for empty text.
 */
export async function embedText(text: string): Promise<number[] | null> {
  const trimmed = text.trim()
  if (!trimmed) return null

  const embeddingModel = await getEmbeddingModelInstance()
  const { embedding } = await embed({ model: embeddingModel, value: trimmed })
  return embedding
}

/**
 * Get embedding for a specific movie
 */
/**
 * Fetch many item embeddings in one round trip, keyed by movie id.
 *
 * buildTasteProfile used getMovieEmbedding inside its weighting loop, which is
 * one query per watched film -- and that helper re-resolves the embedding model
 * and table name on every call, so it was up to three round trips per item. At
 * the old recentWatchLimit of 50 that was tolerable; the default is 200 now,
 * and 200 sequential awaits per user per run is not.
 *
 * Returns a Map rather than an array because the caller must keep iterating its
 * OWN ordered list: the position weight is derived from the index in the
 * favourites-first watch history, so re-ordering by whatever the database
 * returned would silently reweight the profile.
 */
export async function getMovieEmbeddings(movieIds: string[]): Promise<Map<string, number[]>> {
  const byId = new Map<string, number[]>()
  if (movieIds.length === 0) return byId

  const config = await getFunctionConfig('embeddings')
  const modelName = config ? `${config.provider}:${config.model}` : 'unknown'
  const tableName = await getActiveEmbeddingTableName('embeddings')

  const result = await query<{ movie_id: string; embedding: string }>(
    `SELECT movie_id, embedding::text FROM ${tableName} WHERE movie_id = ANY($1) AND model = $2`,
    [movieIds, modelName]
  )

  for (const row of result.rows) {
    byId.set(row.movie_id, row.embedding.replace(/[[]]/g, '').split(',').map(Number))
  }
  return byId
}

export async function getMovieEmbedding(movieId: string): Promise<number[] | null> {
  const config = await getFunctionConfig('embeddings')
  const modelName = config ? `${config.provider}:${config.model}` : 'unknown'
  const tableName = await getActiveEmbeddingTableName('embeddings')

  const result = await queryOne<{ embedding: string }>(
    `SELECT embedding::text FROM ${tableName} WHERE movie_id = $1 AND model = $2`,
    [movieId, modelName]
  )

  if (!result) {
    return null
  }

  // Parse PostgreSQL vector format [x,y,z,...] to number array
  const vectorStr = result.embedding.replace(/[[\]]/g, '')
  return vectorStr.split(',').map(Number)
}
