/**
 * A short description of the viewer, for the web-search grounding call.
 *
 * The chat model already knows the user's taste — `prompts/context/user.ts`
 * puts both synopses and the last ten watches in the system prompt. The
 * *grounding* call does not: it is a separate model call whose entire input is
 * `groundingPrompt(queryText)`, and queryText is the user's raw message. So a
 * request for "something arthouse" searched the web for exactly that, with no
 * idea it was asking on behalf of someone who watches Béla Tarr.
 *
 * Deliberately short. This is prepended to a search prompt whose job is to find
 * titles, and a long profile would start competing with the request itself for
 * the model's attention — which is the failure mode to avoid, since the request
 * is what the user actually asked for.
 */
import { query, queryOne } from '../../../lib/db.js'
import { createChildLogger } from '@aperture/core'

const logger = createChildLogger('assistant-taste-brief')

/** Enough to characterise taste, short enough not to rival the request. */
const MAX_SYNOPSIS_CHARS = 400
const RECENT_TITLES = 6

interface TasteRow {
  taste_synopsis: string | null
  series_taste_synopsis: string | null
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/**
 * Build the brief, or null when there is nothing worth saying — a user with no
 * taste profile and no watch history must leave the grounding prompt exactly as
 * it was rather than gain an empty "the viewer likes:" heading.
 *
 * Never throws: discovery already works without this, so a failure here degrades
 * to the previous behaviour instead of losing the web search entirely.
 */
export async function buildTasteBrief(userId: string): Promise<string | null> {
  try {
    const taste = await queryOne<TasteRow>(
      `SELECT taste_synopsis, series_taste_synopsis FROM user_preferences WHERE user_id = $1`,
      [userId]
    )

    const recent = await query<{ title: string; year: number | null }>(
      `SELECT COALESCE(m.title, s.title) AS title, COALESCE(m.year, s.year) AS year
         FROM watch_history wh
         LEFT JOIN movies m ON m.id = wh.movie_id
         LEFT JOIN episodes e ON e.id = wh.episode_id
         LEFT JOIN series s ON s.id = e.series_id
        WHERE wh.user_id = $1
          AND COALESCE(m.title, s.title) IS NOT NULL
        ORDER BY wh.last_played_at DESC NULLS LAST
        LIMIT $2`,
      [userId, RECENT_TITLES]
    )

    const parts: string[] = []

    const movieTaste = taste?.taste_synopsis?.trim()
    if (movieTaste) parts.push(`Films: ${truncate(movieTaste, MAX_SYNOPSIS_CHARS)}`)

    const seriesTaste = taste?.series_taste_synopsis?.trim()
    if (seriesTaste) parts.push(`TV: ${truncate(seriesTaste, MAX_SYNOPSIS_CHARS)}`)

    if (recent.rows.length > 0) {
      const titles = recent.rows
        .map((r) => (r.year ? `${r.title} (${r.year})` : r.title))
        .join(', ')
      parts.push(`Recently watched: ${titles}`)
    }

    return parts.length > 0 ? parts.join('\n') : null
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to build taste brief; grounding will run without it')
    return null
  }
}
