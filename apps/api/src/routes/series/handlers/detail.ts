/**
 * Series Detail Handler
 * 
 * GET /api/series/:id - Get series by ID with full metadata
 */
import type { FastifyInstance } from 'fastify'
import { getStudioLogos, resolveLocalizedSynopsis, type StudioLogo } from '@aperture/core'
import { queryOne } from '../../../lib/db.js'
import { requireAuth } from '../../../plugins/auth.js'
import { titleInScope } from '../../../lib/viewerScope.js'
import { qualityRatingFields } from '../../../lib/qualityRating.js'
import { refreshStaleTmdbTotals } from '@aperture/core/watching'
import { getSeriesSchema } from '../schemas.js'
import type { SeriesDetailRow } from '../types.js'

export function registerDetailHandler(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string }; Querystring: { lang?: string }; Reply: SeriesDetailRow }>(
    '/api/series/:id',
    {
      preHandler: requireAuth,
      schema: getSeriesSchema,
    },
    async (request, reply) => {
      const { id } = request.params

      // A title in a library this viewer may not open answers exactly like one
      // that does not exist (lib/viewerScope.ts).
      if (!(await titleInScope(request, 'series', id))) {
        return reply.status(404).send({ error: 'Series not found' } as never)
      }

      // Ensure TMDB season data is cached for this series so the page can
      // show aired-but-missing seasons. At most one TMDB call; a no-op when
      // the cache is fresh, and never fatal.
      try {
        await refreshStaleTmdbTotals([id], { maxFetches: 1 })
      } catch (err) {
        request.log.warn({ err, seriesId: id }, 'TMDB totals refresh failed')
      }

      const series = await queryOne<SeriesDetailRow>(
        `SELECT s.id, s.provider_item_id, s.title, s.original_title, s.year, s.end_year, s.genres, s.overview,
                s.community_rating, s.critic_rating, s.content_rating, s.status, s.total_seasons, s.total_episodes,
                s.network, s.tagline, s.studios, s.directors, s.writers, s.actors,
                s.imdb_id, s.tmdb_id, s.tvdb_id, s.air_days, s.production_countries, s.awards,
                s.poster_url, s.backdrop_url, s.created_at, s.updated_at,
                s.keywords, s.rt_critic_score, s.rt_audience_score, s.rt_consensus, s.metacritic_score, s.awards_summary,
                s.languages, s.plot_full, s.letterboxd_score, s.mdblist_score, s.streaming_providers,
                s.tmdb_rating, s.tmdb_vote_count, s.imdb_rating, s.imdb_vote_count,
                s.quality_rating::float8 AS quality_rating, s.quality_rating_sources,
                s.tmdb_total_episodes, s.tmdb_total_seasons, s.tmdb_seasons, s.tmdb_status,
                (SELECT ROUND(AVG(e.runtime_minutes))::int
                 FROM episodes e
                 WHERE e.series_id = s.id AND e.runtime_minutes IS NOT NULL) AS average_episode_runtime_minutes
         FROM series s WHERE s.id = $1`,
        [id]
      )

      if (!series) {
        return reply.status(404).send({ error: 'Series not found' } as never)
      }

      // A machine translation of the synopsis into the language the page is
      // shown in, when one exists for the text the title carries now. Null
      // otherwise, and never an error (core translation/store.ts).
      //
      // Logos for the network the hero shows and the studios the info card
      // lists, looked up alongside. A series' studios are filed as networks by
      // the logo job, so network rows are preferred. Never an error: a failed
      // lookup costs the logos, not the page.
      const studioNames = ((series.studios ?? []) as Array<string | { name: string }>).map((st) =>
        typeof st === 'string' ? st : st.name
      )
      const [localized_synopsis, logos] = await Promise.all([
        resolveLocalizedSynopsis('series', id, request.query.lang, request.user!.id),
        getStudioLogos(
          series.network ? [series.network, ...studioNames] : studioNames,
          'network'
        ).catch((err: unknown) => {
          request.log.warn({ err, seriesId: id }, 'Studio logo lookup failed')
          return new Map<string, StudioLogo>()
        }),
      ])
      const network_logo = series.network ? (logos.get(series.network) ?? null) : null
      const studio_logos = Object.fromEntries(
        studioNames.flatMap((n) => {
          const url = logos.get(n)
          return url ? [[n, url] as const] : []
        })
      )

      // The unified rating recommendations score on, for the headline: the
      // pair stored on the row, read the way the scorer reads it (F-167).
      return reply.send({ ...series, localized_synopsis, studio_logos, network_logo, ...qualityRatingFields(series) })
    }
  )
}
