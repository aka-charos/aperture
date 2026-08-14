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
 * Deliberately short. This is appended to a search prompt whose job is to find
 * titles, and a long profile would start competing with the request itself for
 * the model's attention — which is the failure mode to avoid, since the request
 * is what the user actually asked for.
 */
import { query, queryOne } from '../../../lib/db.js'
import { createChildLogger } from '@aperture/core'

const logger = createChildLogger('assistant-taste-brief')

/** Enough to characterise taste, short enough not to rival the request. */
const MAX_SYNOPSIS_CHARS = 400
const SIGNATURE_TITLES = 6

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

    // Titles that CHARACTERISE the viewer, not whatever happened to be on last
    // night. One measured reason and one judgement.
    //
    // Measured: a watch_history row is an EPISODE, so the old query returned a
    // series once per episode watched. The ten most recent rows on the live
    // instance held `Silo` four times — a six-title brief could be one show
    // named six times, which describes nobody. GROUP BY collapses a series to
    // one entry.
    //
    // Judgement: last_played_at says what someone did on Tuesday, not what they
    // like, so a weekend of background TV displaced everything that makes their
    // taste legible. Ordering mirrors recommender/movies/taste.ts (favorite,
    // then play count, then recency) and gates on WATCH_HISTORY_TASTE_SQL from
    // recommender/watchedExclusion.ts — "what shaped your taste" rather than
    // "have you seen it". Neither is exported from a core barrel, so both are
    // inlined; keep them in step with that file.
    //
    // NOT established, and it was assumed once already: whether the grounding
    // model reads these titles at all. A "like Meshes of the Afternoon" request
    // issued six "<Title> + seed comparison" queries, which looked like one per
    // entry in this list — but five of those six titles appear in no watch
    // history on the instance, so the model was working from its own knowledge.
    // The influence of this list is unmeasured; do not reason from it.
    const signature = await query<{ title: string; year: number | null }>(
      `SELECT COALESCE(m.title, s.title) AS title, COALESCE(m.year, s.year) AS year
         FROM watch_history wh
         LEFT JOIN movies m ON m.id = wh.movie_id
         LEFT JOIN episodes e ON e.id = wh.episode_id
         LEFT JOIN series s ON s.id = e.series_id
        WHERE wh.user_id = $1
          AND COALESCE(m.title, s.title) IS NOT NULL
          AND (wh.played = true OR wh.is_favorite = true)
        GROUP BY COALESCE(m.title, s.title), COALESCE(m.year, s.year)
        ORDER BY bool_or(wh.is_favorite) DESC,
                 SUM(COALESCE(wh.play_count, 0)) DESC,
                 MAX(wh.last_played_at) DESC NULLS LAST
        LIMIT $2`,
      [userId, SIGNATURE_TITLES]
    )

    const parts: string[] = []

    const movieTaste = taste?.taste_synopsis?.trim()
    if (movieTaste) parts.push(`Films: ${truncate(movieTaste, MAX_SYNOPSIS_CHARS)}`)

    const seriesTaste = taste?.series_taste_synopsis?.trim()
    if (seriesTaste) parts.push(`TV: ${truncate(seriesTaste, MAX_SYNOPSIS_CHARS)}`)

    if (signature.rows.length > 0) {
      const titles = signature.rows
        .map((r) => (r.year ? `${r.title} (${r.year})` : r.title))
        .join(', ')
      // Named for what it is. "Recently watched" invited the model to read the
      // list as news; these are the viewer's touchstones.
      parts.push(`Favorites and most-watched: ${titles}`)
    }

    return parts.length > 0 ? parts.join('\n') : null
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to build taste brief; grounding will run without it')
    return null
  }
}
