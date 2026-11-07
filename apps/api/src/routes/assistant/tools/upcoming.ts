/**
 * "What's coming next for the shows I follow?", or for one show they name.
 *
 * Reads the viewer's own `user_watching_series`, or their library for a named
 * show, and reuses the Watching page's lookups, forecast cache included. No TMDb
 * call of its own, and no card lists or text naming a show outside the viewer's
 * scope: such a show answers as if it were not there at all. What the answer may
 * claim is decided in `upcomingAnswer.ts`.
 */
import { tool } from 'ai'
import { z } from 'zod'
import { binderFor, displayRatingSql, libraryScopeSql } from '@aperture/core'
import {
  getEpisodeStandings,
  getLatestAiredEpisodes,
  getUpcomingEpisodesReport,
} from '@aperture/core/watching'
import { query } from '../../../lib/db.js'
import { anyTitleMatchesSql, titleMatchRankSql } from '../helpers/titleMatch.js'
import type { ToolContext } from '../types.js'
import {
  buildUpcomingAnswer,
  UPCOMING_DEFAULT_LIMIT,
  UPCOMING_MAX_LIMIT,
  UPCOMING_MAX_NAME_MATCHES,
  type FollowedShow,
} from './upcomingAnswer.js'
import { nullSafe } from './utils.js'

type ShowRow = Omit<FollowedShow, 'tmdb_status'>

const SHOW_COLUMNS = `s.id, s.title, s.year, s.poster_url, s.genres,
                  ${displayRatingSql('s')} AS community_rating`

/**
 * Scoped in the SQL, not left to the card wrapper: the no-date lists are text that
 * wrapper cannot see, and they name shows too.
 */
function followedShows(ctx: ToolContext) {
  const params: unknown[] = [ctx.userId]
  return query<ShowRow>(
    `SELECT ${SHOW_COLUMNS}
     FROM user_watching_series uws
     JOIN series s ON s.id = uws.series_id
     WHERE uws.user_id = $1 AND ${libraryScopeSql(ctx.scope, 's', binderFor(params))}
     ORDER BY s.title`,
    params
  )
}

/** Library shows matching a name, followed or not. An exact name comes first. */
function namedShows(ctx: ToolContext, name: string) {
  const params: unknown[] = [`%${name}%`, name]
  return query<ShowRow>(
    `SELECT ${SHOW_COLUMNS}
     FROM series s
     WHERE ${anyTitleMatchesSql('$1', 's')} AND ${libraryScopeSql(ctx.scope, 's', binderFor(params))}
     ORDER BY ${titleMatchRankSql('$2', 's')}, s.title
     LIMIT ${UPCOMING_MAX_NAME_MATCHES}`,
    params
  )
}

export function createUpcomingTools(ctx: ToolContext) {
  return {
    getUpcomingEpisodes: tool({
      description:
        "What is coming next for the shows this user added to follow, or for one show they name: " +
        'each show\'s next episode and its date, soonest first, plus the latest episode that has ' +
        'aired and whether their library holds it. Use for "what\'s coming next for my shows", ' +
        '"when is the next episode of Severance", "any new episodes this week". Do not search the ' +
        'web for this and do not answer it from memory. Read `answer` first, because an empty ' +
        'list has several meanings: "scheduled", "nothingAnnounced" (TMDb says no date), ' +
        '"notFollowing" (no shows added to follow), "notInLibrary" (the named show is not in ' +
        'their library), "noTmdbKey" (forecasts are not set up), ' +
        '"lookupFailed" (TMDb did not answer: never present this as nothing coming), ' +
        '"noTmdbEntry" (TMDb does not know these shows). A date with status "expected" is a ' +
        'forecast and never proof the episode will be playable then.',
      inputSchema: nullSafe(
        z.object({
          series: z
            .string()
            .optional()
            .describe(
              'One show by name. Use whenever the user names a show: it answers for any show in ' +
                'their library, followed or not, and the unnamed list is capped.'
            ),
          limit: z
            .number()
            .optional()
            .default(UPCOMING_DEFAULT_LIMIT)
            .describe(
              `Most shows to show as cards, soonest first (default ${UPCOMING_DEFAULT_LIMIT}, max ${UPCOMING_MAX_LIMIT})`
            ),
        })
      ),
      execute: async ({ series, limit = UPCOMING_DEFAULT_LIMIT }) => {
        const name = series?.trim() || undefined
        const { rows } = await (name ? namedShows(ctx, name) : followedShows(ctx))
        const ids = rows.map((show) => show.id)
        const today = new Date().toISOString().slice(0, 10)

        const report = await getUpcomingEpisodesReport(ids)
        // After the lookups, not beside them: a live forecast writes
        // tmdb_last_episode and tmdb_status, which these read.
        const [latestAired, statuses] = await Promise.all([
          getLatestAiredEpisodes(ids, today),
          ids.length > 0
            ? query<{ id: string; tmdb_status: string | null }>(
                `SELECT id, tmdb_status FROM series WHERE id = ANY($1)`,
                [ids]
              )
            : { rows: [] },
        ])
        const statusOf = new Map(statuses.rows.map((row) => [row.id, row.tmdb_status]))

        return buildUpcomingAnswer({
          id: `upcoming-${Date.now()}`,
          shows: rows.map((show) => ({ ...show, tmdb_status: statusOf.get(show.id) ?? null })),
          report,
          latestAired,
          standings: await getEpisodeStandings(ctx.userId, latestAired),
          today,
          limit: Math.max(1, Math.min(limit ?? UPCOMING_DEFAULT_LIMIT, UPCOMING_MAX_LIMIT)),
          series: name,
        })
      },
    }),
  }
}
