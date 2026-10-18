/**
 * Translated text for the cards on a page: overviews in one batched request,
 * and the names genres print under.
 *
 * The detail page reads a title's translated synopsis off its own route; the
 * poster grids are fed by a dozen list endpoints, and putting the translation
 * on each of them would be a dozen copies of the language rule. The grids ask
 * here instead — the same shape as GET /api/watch-status — and a card with no
 * answer keeps its original text.
 *
 * Named `title-translations` so it is never mistaken for `/api/i18n`, which
 * serves the UI's own strings.
 */
import type { FastifyPluginAsync } from 'fastify'
import { requireAuth, type SessionUser } from '../../plugins/auth.js'
import { appLocaleToTmdbLanguage, getLocalizedGenreNames, resolveLocalizedOverviews } from '@aperture/core'
import { idsInScope } from '../../lib/viewerScope.js'

/** Per media type. The client sends fewer per request, to keep the URL short. */
const MAX_IDS = 100

interface OverviewsQuery {
  lang?: string
  movie?: string[]
  series?: string[]
}

const titleTranslationRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/title-translations/overviews?lang=el&movie=<id>&series=<id>
   * Repeated `movie`/`series` parameters name the cards on screen. Only titles
   * the viewer may open are answered; anything else is simply absent, exactly
   * like a title with no translation, so the answer confirms nothing.
   */
  fastify.get<{ Querystring: OverviewsQuery }>(
    '/api/title-translations/overviews',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['movies', 'series'],
        description:
          'Current translated overviews of the given movies and series, in the language the page is displayed in.',
        querystring: {
          type: 'object',
          properties: {
            lang: { type: 'string', maxLength: 10 },
            // Arrays, or a single repeated name would arrive as a string and
            // more than one would be refused (config/ajv.ts).
            movie: { type: 'array', items: { type: 'string' }, maxItems: MAX_IDS },
            series: { type: 'array', items: { type: 'string' }, maxItems: MAX_IDS },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              movies: { type: 'object', additionalProperties: { type: 'string' } },
              series: { type: 'object', additionalProperties: { type: 'string' } },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user as SessionUser
      const [movie, series] = await Promise.all([
        idsInScope(request, 'movies', request.query.movie ?? []),
        idsInScope(request, 'series', request.query.series ?? []),
      ])
      const overviews = await resolveLocalizedOverviews(
        { movie: [...movie], series: [...series] },
        request.query.lang,
        user.id
      )
      return reply.send(overviews)
    }
  )

  /**
   * GET /api/title-translations/genres?lang=el
   * English genre name → its name in that language, from TMDb's own genre
   * lists. Empty when TMDb is not configured or the language is English; the
   * client then prints its own strings or the stored names.
   */
  fastify.get<{ Querystring: { lang?: string } }>(
    '/api/title-translations/genres',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['movies', 'series'],
        description: 'Display names of the stored (English) genre names in the given language.',
        querystring: {
          type: 'object',
          properties: { lang: { type: 'string', maxLength: 10 } },
        },
        response: {
          200: {
            type: 'object',
            properties: { names: { type: 'object', additionalProperties: { type: 'string' } } },
          },
        },
      },
    },
    async (request, reply) => {
      const language = appLocaleToTmdbLanguage(request.query.lang)
      if (language === 'en-US') return reply.send({ names: {} })
      return reply.send({ names: await getLocalizedGenreNames(language) })
    }
  )
}

export default titleTranslationRoutes
