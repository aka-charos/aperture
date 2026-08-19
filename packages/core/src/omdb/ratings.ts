/**
 * OMDb Ratings API Functions
 */

import { omdbRequest } from './client.js'
import { normalizeCountries } from '../countries/canonical.js'
import type { OMDbMovieResponse, RatingsData } from './types.js'
import type { ApiLogCallback } from '../tmdb/client.js'

/**
 * Parse Rotten Tomatoes score from OMDb rating string
 * e.g., "85%" -> 85
 */
function parsePercentage(value: string | undefined): number | null {
  if (!value) return null
  const match = value.match(/^(\d+)%$/)
  if (match) {
    return parseInt(match[1], 10)
  }
  return null
}

/**
 * Parse Metacritic score from OMDb Metascore string
 * e.g., "74" -> 74, "N/A" -> null
 */
function parseMetascore(value: string | undefined): number | null {
  if (!value || value === 'N/A') return null
  const num = parseInt(value, 10)
  return isNaN(num) ? null : num
}

/**
 * Parse awards summary from OMDb
 * e.g., "Won 4 Oscars. 12 nominations total."
 */
function parseAwards(value: string | undefined): string | null {
  if (!value || value === 'N/A') return null
  return value
}

/**
 * Parse a plain decimal, e.g. imdbRating "7.0" -> 7.0
 *
 * "N/A" is OMDb's null and must not become 0 — a title nobody has rated would
 * otherwise render as the worst-rated thing in the library.
 */
function parseDecimal(value: string | undefined): number | null {
  if (!value || value === 'N/A') return null
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Parse a thousands-grouped integer, e.g. imdbVotes "545,163" -> 545163
 *
 * The separators have to go before parseFloat sees the string: `parseFloat`
 * stops at the first comma and would read "545,163" as 545.
 */
function parseGroupedInteger(value: string | undefined): number | null {
  if (!value || value === 'N/A') return null
  const parsed = parseInt(value.replace(/[,\s]/g, ''), 10)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Parse comma-separated string into array
 * e.g., "English, French, Spanish" -> ["English", "French", "Spanish"]
 */
function parseCommaSeparated(value: string | undefined): string[] | null {
  if (!value || value === 'N/A') return null
  const items = value.split(',').map((s) => s.trim()).filter(Boolean)
  return items.length > 0 ? items : null
}

/**
 * Extract ratings data from OMDb response
 */
export function extractRatingsData(data: OMDbMovieResponse): RatingsData {
  // Find Rotten Tomatoes rating
  const rtRating = data.Ratings?.find((r) => r.Source === 'Rotten Tomatoes')
  const rtCriticScore = parsePercentage(rtRating?.Value)

  // OMDb doesn't provide RT Audience Score directly
  // We could potentially scrape it, but for now we'll leave it null
  const rtAudienceScore: number | null = null

  // Get Metacritic score
  const metacriticScore = parseMetascore(data.Metascore)

  // Get awards summary
  const awardsSummary = parseAwards(data.Awards)

  // Parse language and country fields.
  //
  // Countries go through the canonical vocabulary on the way out. OMDb writes
  // "USA" and "UK" where the media server writes "United States of America"
  // and "United Kingdom", and these are the two paths that put both spellings
  // into the same column. Normalising here means the difference never reaches
  // the database, rather than being cleaned up afterwards.
  //
  // Null still means "OMDb told us nothing", which the enrichment UPDATE
  // depends on: `COALESCE($13, production_countries)` leaves whatever is
  // already stored alone, where an empty array would wipe it.
  const languages = parseCommaSeparated(data.Language)
  const rawCountries = parseCommaSeparated(data.Country)
  const normalized = rawCountries ? normalizeCountries(rawCountries) : null
  const countries = normalized && normalized.length > 0 ? normalized : null

  // The long synopsis. The client asks for plot=full, but OMDb falls back to
  // the short blurb when no long one exists, so this is often just the
  // one-liner — callers compare against what they already have rather than
  // assuming it is longer.
  const plot = !data.Plot || data.Plot === 'N/A' ? null : data.Plot.trim() || null

  const imdbRating = parseDecimal(data.imdbRating)
  const imdbVotes = parseGroupedInteger(data.imdbVotes)

  return {
    rtCriticScore,
    rtAudienceScore,
    metacriticScore,
    awardsSummary,
    languages,
    countries,
    plot,
    imdbRating,
    imdbVotes,
  }
}

/**
 * Get ratings data for a movie/series by IMDB ID
 */
export async function getRatingsData(
  imdbId: string,
  options: { onLog?: ApiLogCallback } = {}
): Promise<RatingsData | null> {
  const data = await omdbRequest(imdbId, options)
  if (!data) {
    return null
  }

  return extractRatingsData(data)
}

/**
 * Get ratings data for multiple IMDB IDs in batch
 * Returns a map of IMDB ID -> RatingsData
 */
export async function getRatingsDataBatch(
  imdbIds: string[],
  options: { onLog?: ApiLogCallback } = {}
): Promise<Map<string, RatingsData>> {
  const results = new Map<string, RatingsData>()

  // Process in chunks to respect rate limits
  const chunkSize = 10
  for (let i = 0; i < imdbIds.length; i += chunkSize) {
    const chunk = imdbIds.slice(i, i + chunkSize)
    const promises = chunk.map(async (imdbId) => {
      const data = await getRatingsData(imdbId, options)
      if (data) {
        results.set(imdbId, data)
      }
    })
    await Promise.all(promises)
  }

  return results
}

/**
 * Get full OMDb data for a movie/series by IMDB ID
 */
export async function getOMDbData(
  imdbId: string,
  options: { onLog?: ApiLogCallback } = {}
): Promise<OMDbMovieResponse | null> {
  return omdbRequest(imdbId, options)
}


