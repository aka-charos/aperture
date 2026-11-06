/**
 * "What's coming next for the shows I follow?"
 *
 * Reads the viewer's own `user_watching_series` and reuses the Watching page's
 * lookups, forecast cache included. No TMDb call of its own, and no card lists
 * or text naming a show outside the viewer's scope: such a show answers as if it
 * were not followed at all. What the answer may claim is decided in
 * `upcomingAnswer.ts`.
 */
import { tool } from 'ai'
import { z } from 'zod'
import { binderFor, displayRatingSql, libraryScopeSql } from '@aperture/core'
import {
  getLatestAiredEpisodes,
  getSeasonProgress,
  getUpcomingEpisodesReport,
} from '@aperture/core/watching'
import { query } from '../../../lib/db.js'
import type { ToolContext } from '../types.js'
import {
  buildUpcomingAnswer,
  UPCOMING_DEFAULT_LIMIT,
  UPCOMING_MAX_LIMIT,
  type FollowedShow,
} from './upcomingAnswer.js'
import { nullSafe } from './utils.js'

export function createUpcomingTools(ctx: ToolContext) {
  return {
    getUpcomingEpisodes: tool({
      description:
        "What is coming next for the shows this user follows (their Shows You Watch list): each " +
        'show\'s next episode and its date, soonest first, plus the latest episode that has aired ' +
        'and whether their library holds it. Use for "what\'s coming next for my shows", "when ' +
        'is the next episode of the shows I follow", "any new episodes this week". Do not search ' +
        'the web for this and do not answer it from memory. Read `answer` first, because an empty ' +
        'list has several meanings: "scheduled", "nothingAnnounced" (TMDb says no date), ' +
        '"notFollowing" (no followed shows here), "noTmdbKey" (forecasts are not set up), ' +
        '"lookupFailed" (TMDb did not answer: never present this as nothing coming), ' +
        '"noTmdbEntry" (TMDb does not know these shows). A date with status "expected" is a ' +
        'forecast and never proof the episode will be playable then.',
      inputSchema: nullSafe(
        z.object({
          limit: z
            .number()
            .optional()
            .default(UPCOMING_DEFAULT_LIMIT)
            .describe(
              `Most shows to show as cards, soonest first (default ${UPCOMING_DEFAULT_LIMIT}, max ${UPCOMING_MAX_LIMIT})`
            ),
        })
      ),
      execute: async ({ limit = UPCOMING_DEFAULT_LIMIT }) => {
        const params: unknown[] = [ctx.userId]
        const followed = await query<FollowedShow>(
          // In the SQL, not left to the card wrapper: the no-date lists are text
          // that wrapper cannot see, and they name shows too.
          `SELECT s.id, s.title, s.year, s.poster_url, s.genres,
                  ${displayRatingSql('s')} AS community_rating, s.tmdb_status
           FROM user_watching_series uws
           JOIN series s ON s.id = uws.series_id
           WHERE uws.user_id = $1 AND ${libraryScopeSql(ctx.scope, 's', binderFor(params))}
           ORDER BY s.title`,
          params
        )
        const ids = followed.rows.map((show) => show.id)
        const today = new Date().toISOString().slice(0, 10)

        const report = await getUpcomingEpisodesReport(ids)
        // After the lookups, not beside them: a live forecast writes
        // tmdb_last_episode, which this reads.
        const [latestAired, seasonProgress] = await Promise.all([
          getLatestAiredEpisodes(ids, today),
          getSeasonProgress(ctx.userId, ids),
        ])

        return buildUpcomingAnswer({
          id: `upcoming-${Date.now()}`,
          shows: followed.rows,
          report,
          latestAired,
          seasonProgress,
          today,
          limit: Math.max(1, Math.min(limit ?? UPCOMING_DEFAULT_LIMIT, UPCOMING_MAX_LIMIT)),
        })
      },
    }),
  }
}
