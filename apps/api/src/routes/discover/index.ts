/**
 * Discovery Routes
 * Browse content by person (actors/directors) or studio/network
 */

import type { FastifyPluginAsync } from 'fastify'
import {
  displayRatingSql,
  listPeopleForBrowse,
  resolveTmdbPersonProfileImageUrl,
  getCachedOrFetchCombinedCredits,
  getCachedOrFetchPersonDetails,
  tmdbCreditsByTitle,
  tmdbPersonAgreesWithLibrary,
  tmdbTitleKey,
  getPersonCreditsGap,
  getPersonMediaServerDetails,
  findPersonMediaServerItemIdForName,
  pushImageToMediaServer,
  resolveStudioLogo,
  studioLogoColumns,
  unlistedStudioLogo,
  type StudioLogoKind,
  type StudioLogoRow,
} from '@aperture/core'
import { query, queryOne } from '../../lib/db.js'
import { requireAuth, requireAdmin } from '../../plugins/auth.js'
import { scopeClause, viewerScope } from '../../lib/viewerScope.js'
import { discoverSchemas, getPeopleListSchema } from './schemas.js'
import { registerTmdbExternalDetailRoutes } from './tmdbExternalDetail.js'

interface ContentItem {
  id: string
  title: string
  year: number | null
  posterUrl: string | null
  backdropUrl: string | null
  genres: string[]
  communityRating: number | null
  role?: string // For actors - their role in this content
  /** Person page only: the TMDb id, so TMDb's credit roles can join the media server's. */
  tmdbId?: string | null
  /** Person page only: how the person is credited on this title, from the media server. */
  credits?: PersonCreditKind[]
}

type PersonCreditKind = 'actor' | 'director' | 'writer' | 'creator'

interface PersonResponse {
  name: string
  imageUrl: string | null
  /** TMDb profile URL when media server has no portrait (optional eager load). */
  tmdbFallbackImageUrl?: string | null
  /** Person metadata from the media server (null when it has none). */
  overview: string | null
  birthDate: string | null
  deathDate: string | null
  birthPlace: string | null
  movies: ContentItem[]
  series: ContentItem[]
  stats: {
    totalMovies: number
    totalSeries: number
    asActor: number
    asDirector: number
  }
}

interface StudioResponse {
  name: string
  imageUrl: string | null
  /** How the logo is drawn: a media-server tile as it is, a TMDb mark on a plate. */
  imageKind: StudioLogoKind | null
  movies: ContentItem[]
  series: ContentItem[]
  stats: {
    totalMovies: number
    totalSeries: number
  }
}

const discoverRoutes: FastifyPluginAsync = async (fastify) => {
  // Register schemas
  for (const [name, schema] of Object.entries(discoverSchemas)) {
    fastify.addSchema({ $id: name, ...schema })
  }

  registerTmdbExternalDetailRoutes(fastify)

  /**
   * GET /api/discover/people
   * Paginated list of distinct people (actors + directors) in the library
   */
  fastify.get<{
    Querystring: {
      search?: string
      page?: string
      pageSize?: string
      sortBy?: string
      showAll?: string
    }
  }>(
    '/api/discover/people',
    { preHandler: requireAuth, schema: getPeopleListSchema },
    async (request) => {
      const page = Math.max(1, parseInt(request.query.page || '1', 10) || 1)
      const pageSize = Math.min(
        Math.max(1, parseInt(request.query.pageSize || '50', 10) || 50),
        50
      )
      const sortBy = request.query.sortBy === 'credits' ? 'credits' : 'name'
      const search = request.query.search?.trim() || undefined
      const showAll = request.query.showAll === 'true'

      return listPeopleForBrowse({
        scope: await viewerScope(request),
        page,
        pageSize,
        sortBy,
        search,
        showAll,
      })
    }
  )

  /**
   * GET /api/discover/person-profile?name=...
   * TMDb profile image URL for lazy UI fallback (cache-backed).
   */
  fastify.get<{
    Querystring: { name?: string }
  }>(
    '/api/discover/person-profile',
    { preHandler: requireAuth, schema: { tags: ['discovery'] } },
    async (request, reply) => {
      const raw = request.query.name?.trim()
      if (!raw) {
        return reply.status(400).send({ error: 'Missing name query parameter' })
      }
      // Already decoded once by the router; a second decode breaks names with a %.
      const decodedName = raw
      const { imageUrl, tmdbPersonId } = await resolveTmdbPersonProfileImageUrl(decodedName)
      request.log.info(
        {
          route: 'person-profile',
          name: decodedName,
          hasImageUrl: !!imageUrl,
          tmdbPersonId,
        },
        'TMDb person profile fallback lookup'
      )
      return reply.send({ imageUrl })
    }
  )

  /**
   * GET /api/discover/person/:name/credits-gap
   * TMDb combined credits vs visible library (missing titles).
   */
  fastify.get<{
    Params: { name: string }
    Querystring: { showAll?: string; maxMissing?: string }
  }>(
    '/api/discover/person/:name/credits-gap',
    { preHandler: requireAuth, schema: { tags: ['discovery'] } },
    async (request, reply) => {
      // Already decoded once by the router; a second decode breaks names with a %.
      const decodedName = request.params.name
      const showAll = request.query.showAll === 'true'
      const maxMissing = request.query.maxMissing
        ? parseInt(request.query.maxMissing, 10)
        : undefined
      const gap = await getPersonCreditsGap(decodedName, {
        scope: await viewerScope(request),
        showAll,
        maxMissing: Number.isFinite(maxMissing) ? maxMissing : undefined,
      })
      return reply.send(gap)
    }
  )

  /**
   * POST /api/discover/person/:name/push-tmdb-portrait
   * Admin: download TMDb portrait and push Primary image to media server (requires synced personId on actors).
   */
  fastify.post<{ Params: { name: string } }>(
    '/api/discover/person/:name/push-tmdb-portrait',
    { preHandler: [requireAuth, requireAdmin], schema: { tags: ['discovery'] } },
    async (request, reply) => {
      // Already decoded once by the router; a second decode breaks names with a %.
      const decodedName = request.params.name
      const itemId = await findPersonMediaServerItemIdForName(decodedName)
      if (!itemId) {
        return reply.status(400).send({
          error: 'No media server Person item id',
          message:
            'Re-sync movies/series so actors include personId from Jellyfin/Emby, or the name does not match cast entries.',
        })
      }

      const { imageUrl } = await resolveTmdbPersonProfileImageUrl(decodedName)
      if (!imageUrl) {
        return reply.status(404).send({
          error: 'No TMDb profile image',
          message: 'Could not resolve a TMDb portrait for this person.',
        })
      }

      const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) })
      if (!imgRes.ok) {
        return reply.status(502).send({ error: 'Failed to download TMDb image' })
      }
      const buf = Buffer.from(await imgRes.arrayBuffer())
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
      const result = await pushImageToMediaServer(itemId, 'Primary', buf, contentType)
      if (!result.success) {
        return reply.status(500).send({
          error: result.error || 'Failed to push image to media server',
        })
      }
      return reply.send({ success: true, itemId })
    }
  )

  /**
   * GET /api/discover/person/:name
   * Get all movies and series featuring a person (actor or director)
   */
  fastify.get<{ Params: { name: string } }>(
    '/api/discover/person/:name',
    { preHandler: requireAuth, schema: { tags: ["discovery"] } },
    async (request, reply) => {
      const { name } = request.params
      // Already decoded once by the router; a second decode breaks names with a %.
      const decodedName = name

      // Only titles this viewer may open (lib/viewerScope.ts).
      const scope = await viewerScope(request)
      const movieParams: unknown[] = [decodedName]
      const moviesInScope = scopeClause(scope, 'm', movieParams)
      const seriesParams: unknown[] = [decodedName]
      const seriesInScope = scopeClause(scope, 's', seriesParams)

      // Titles where the person is credited, with HOW: the page groups them by
      // medium and role, the way its "Not in your library" section groups TMDb's.
      // The media server records cast, directors and writers; a show's creators
      // come from TMDb in their own column (series.directors is empty for nearly
      // every show — see CLAUDE.md, creators rule).
      const creditColumns = (alias: 'm' | 's') => `
          ${alias}.id,
          ${alias}.tmdb_id::text AS tmdb_id,
          ${alias}.title,
          ${alias}.year,
          ${alias}.poster_url,
          ${alias}.backdrop_url,
          ${alias}.genres,
          ${displayRatingSql(alias)} AS community_rating,
          EXISTS(
            SELECT 1 FROM jsonb_array_elements(${alias}.actors) AS a
            WHERE a->>'name' ILIKE $1
          ) AS is_actor,
          ${
            // A show's directors column is the media server's Director AND
            // Creator people in one list (both mappers), and at series level
            // those are its creators; it is read as Creator, with TMDb's.
            alias === 's'
              ? `false AS is_director,
          ($1 = ANY(COALESCE(s.directors, '{}')) OR $1 = ANY(COALESCE(s.tmdb_creators, '{}'))) AS is_creator,`
              : `$1 = ANY(COALESCE(m.directors, '{}')) AS is_director,
          false AS is_creator,`
          }
          $1 = ANY(COALESCE(${alias}.writers, '{}')) AS is_writer,
          (
            SELECT a->>'role' FROM jsonb_array_elements(${alias}.actors) AS a
            WHERE a->>'name' ILIKE $1
            LIMIT 1
          ) AS role`
      const creditedWhere = (alias: 'm' | 's') => `(
          EXISTS(SELECT 1 FROM jsonb_array_elements(${alias}.actors) AS a WHERE a->>'name' ILIKE $1)
          OR $1 = ANY(${alias}.directors)
          OR $1 = ANY(COALESCE(${alias}.writers, '{}'))
          ${alias === 's' ? `OR $1 = ANY(COALESCE(s.tmdb_creators, '{}'))` : ''}
        )`

      type CreditRow = {
        id: string
        tmdb_id: string | null
        title: string
        year: number | null
        poster_url: string | null
        backdrop_url: string | null
        genres: string[]
        community_rating: number | null
        is_actor: boolean
        is_director: boolean
        is_writer: boolean
        is_creator: boolean
        role: string | null
      }

      const [movieResults, seriesResults, tmdbProfile, personDetails] = await Promise.all([
        query<CreditRow>(
          `SELECT ${creditColumns('m')}
           FROM movies m
           WHERE ${creditedWhere('m')} AND ${moviesInScope}
           ORDER BY m.year DESC NULLS LAST, m.title ASC`,
          movieParams
        ),
        query<CreditRow>(
          `SELECT ${creditColumns('s')}
           FROM series s
           WHERE ${creditedWhere('s')} AND ${seriesInScope}
           ORDER BY s.year DESC NULLS LAST, s.title ASC`,
          seriesParams
        ),
        resolveTmdbPersonProfileImageUrl(decodedName),
        getPersonMediaServerDetails(decodedName),
      ])

      // TMDb's credits fill in library titles the media server credits the
      // person on under another spelling or not at all, and TMDb's biography
      // fills what the media server's Person metadata leaves empty: both only
      // once TMDb's person agrees with the library on a title the media server
      // already credits by name (core discover/personTmdbCredits.ts).
      const tmdbPersonId = tmdbProfile.tmdbPersonId
      const needsTmdbDetails =
        !personDetails?.overview?.trim() ||
        !personDetails?.birthDate ||
        !personDetails?.birthPlace?.trim()
      const [tmdbCredits, tmdbDetails] =
        tmdbPersonId != null
          ? await Promise.all([
              getCachedOrFetchCombinedCredits(decodedName, tmdbPersonId).catch((err: unknown) => {
                request.log.warn({ err, tmdbPersonId }, 'TMDb person credits lookup failed')
                return null
              }),
              needsTmdbDetails
                ? getCachedOrFetchPersonDetails(decodedName, tmdbPersonId).catch((err: unknown) => {
                    request.log.warn({ err, tmdbPersonId }, 'TMDb person details lookup failed')
                    return null
                  })
                : Promise.resolve(null),
            ])
          : [null, null]
      const creditsByTitle = tmdbCredits ? tmdbCreditsByTitle(tmdbCredits) : null
      const tmdbAgrees =
        creditsByTitle != null &&
        tmdbPersonAgreesWithLibrary(creditsByTitle, [
          ...movieResults.rows.map((r) => ({ media: 'movie' as const, tmdbId: r.tmdb_id })),
          ...seriesResults.rows.map((r) => ({ media: 'tv' as const, tmdbId: r.tmdb_id })),
        ])

      // Library titles TMDb credits the person on that the name match missed.
      const tmdbOnlyRows = async (alias: 'm' | 's', found: CreditRow[]): Promise<CreditRow[]> => {
        if (!creditsByTitle || !tmdbAgrees) return []
        const media = alias === 'm' ? 'movie' : 'tv'
        const tmdbIds = [...creditsByTitle.values()]
          .filter((credit) => credit.media === media)
          .map((credit) => credit.tmdbId)
        if (tmdbIds.length === 0) return []
        const params: unknown[] = [decodedName]
        const inScope = scopeClause(scope, alias, params)
        params.push(tmdbIds)
        const idsParam = `$${params.length}`
        params.push(found.map((r) => r.id))
        const foundParam = `$${params.length}`
        const result = await query<CreditRow>(
          `SELECT ${creditColumns(alias)}
           FROM ${alias === 'm' ? 'movies' : 'series'} ${alias}
           WHERE ${alias}.tmdb_id = ANY(${idsParam}::text[])
             AND NOT (${alias}.id = ANY(${foundParam}::uuid[]))
             AND ${inScope}`,
          params
        )
        return result.rows
      }
      const [extraMovies, extraSeries] = await Promise.all([
        tmdbOnlyRows('m', movieResults.rows),
        tmdbOnlyRows('s', seriesResults.rows),
      ])

      const tmdbCreditOf = (media: 'movie' | 'tv', r: CreditRow) =>
        r.tmdb_id ? creditsByTitle?.get(tmdbTitleKey(media, r.tmdb_id)) : undefined
      const creditsOf = (
        media: 'movie' | 'tv',
        r: CreditRow,
        fromTmdb: boolean
      ): PersonCreditKind[] => {
        const kinds = new Set<PersonCreditKind>([
          ...(r.is_actor ? (['actor'] as const) : []),
          ...(r.is_director ? (['director'] as const) : []),
          ...(r.is_writer ? (['writer'] as const) : []),
          ...(r.is_creator ? (['creator'] as const) : []),
        ])
        if (fromTmdb) {
          for (const role of tmdbCreditOf(media, r)?.roles ?? []) {
            if (role === 'actor' || role === 'director' || role === 'writer' || role === 'creator') {
              kinds.add(role)
            }
          }
        }
        return [...kinds]
      }
      const toItem =
        (media: 'movie' | 'tv', fromTmdb: boolean) =>
        (r: CreditRow): ContentItem => ({
          id: r.id,
          tmdbId: r.tmdb_id,
          title: r.title,
          year: r.year,
          posterUrl: r.poster_url,
          backdropUrl: r.backdrop_url,
          genres: r.genres || [],
          communityRating: r.community_rating,
          role: r.role || (fromTmdb ? tmdbCreditOf(media, r)?.character : null) || undefined,
          credits: creditsOf(media, r, fromTmdb),
        })
      // Newest first, undated last, then by title: the SQL order, kept once
      // TMDb's titles join.
      const byYearThenTitle = (a: ContentItem, b: ContentItem) =>
        (b.year ?? -Infinity) - (a.year ?? -Infinity) || a.title.localeCompare(b.title)
      const movies = [
        ...movieResults.rows.map(toItem('movie', false)),
        ...extraMovies.map(toItem('movie', true)),
      ]
      const series = [
        ...seriesResults.rows.map(toItem('tv', false)),
        ...extraSeries.map(toItem('tv', true)),
      ]
      if (extraMovies.length > 0) movies.sort(byYearThenTitle)
      if (extraSeries.length > 0) series.sort(byYearThenTitle)

      // Build person image URL through our proxy
      const imageUrl = `/api/media/images/Persons/${encodeURIComponent(decodedName)}/Images/Primary`

      const credited = (items: ContentItem[], kind: PersonCreditKind) =>
        items.filter((item) => item.credits?.includes(kind)).length

      // A field the media server leaves empty takes TMDb's, field by field.
      const tmdbBio = tmdbAgrees ? tmdbDetails : null
      const response: PersonResponse = {
        name: decodedName,
        imageUrl,
        tmdbFallbackImageUrl: tmdbProfile.imageUrl,
        overview: personDetails?.overview?.trim() || tmdbBio?.biography || null,
        birthDate: personDetails?.birthDate || tmdbBio?.birthday || null,
        deathDate: personDetails?.deathDate || tmdbBio?.deathday || null,
        birthPlace: personDetails?.birthPlace?.trim() || tmdbBio?.placeOfBirth || null,
        movies,
        series,
        stats: {
          totalMovies: movies.length,
          totalSeries: series.length,
          asActor: credited(movies, 'actor') + credited(series, 'actor'),
          asDirector: credited(movies, 'director'),
        },
      }

      return reply.send(response)
    }
  )

  /**
   * GET /api/discover/studio/:name
   * Get all movies and series from a studio or network
   */
  fastify.get<{ Params: { name: string } }>(
    '/api/discover/studio/:name',
    { preHandler: requireAuth, schema: { tags: ["discovery"] } },
    async (request, reply) => {
      const { name } = request.params
      // Already decoded once by the router; a second decode breaks names with a %.
      const decodedName = name

      // Only titles this viewer may open (lib/viewerScope.ts).
      const studioScope = await viewerScope(request)
      const studioMovieParams: unknown[] = [decodedName]
      const studioSeriesParams: unknown[] = [decodedName]

      // Query movies from this studio
      const movieResults = await query<{
        id: string
        title: string
        year: number | null
        poster_url: string | null
        backdrop_url: string | null
        genres: string[]
        community_rating: number | null
      }>(
        `SELECT 
          m.id,
          m.title,
          m.year,
          m.poster_url,
          m.backdrop_url,
          m.genres,
          ${displayRatingSql('m')} AS community_rating
        FROM movies m
        WHERE EXISTS(
          SELECT 1 FROM jsonb_array_elements(m.studios) AS s
          WHERE s->>'name' ILIKE $1
        ) AND ${scopeClause(studioScope, 'm', studioMovieParams)}
        ORDER BY m.year DESC NULLS LAST, m.title ASC`,
        studioMovieParams
      )

      // Query series from this studio OR network
      const seriesResults = await query<{
        id: string
        title: string
        year: number | null
        poster_url: string | null
        backdrop_url: string | null
        genres: string[]
        community_rating: number | null
      }>(
        `SELECT 
          s.id,
          s.title,
          s.year,
          s.poster_url,
          s.backdrop_url,
          s.genres,
          ${displayRatingSql('s')} AS community_rating
        FROM series s
        WHERE (
          EXISTS(
            SELECT 1 FROM jsonb_array_elements(s.studios) AS st  
            WHERE st->>'name' ILIKE $1
          )
          OR s.network ILIKE $1
        ) AND ${scopeClause(studioScope, 's', studioSeriesParams)}
        ORDER BY s.year DESC NULLS LAST, s.title ASC`,
        studioSeriesParams
      )

      // The logo: the media server's image for this name first, TMDb's
      // otherwise (core resolveStudioLogo). Both kinds of row, since this page
      // serves studios and networks; a row with a logo wins over one without.
      const studioRow = await queryOne<StudioLogoRow>(
        `SELECT ${studioLogoColumns('sn')} FROM studios_networks sn
         WHERE sn.name ILIKE $1
         ORDER BY sn.media_image_type IS NOT NULL DESC, sn.logo_path IS NOT NULL DESC
         LIMIT 1`,
        [decodedName]
      )
      // A name no row has yet (synced since the job last ran) still guesses at
      // the media server's Thumb by name, as this page did before the read.
      const logo = studioRow ? await resolveStudioLogo(studioRow) : unlistedStudioLogo(decodedName)

      const response: StudioResponse = {
        name: decodedName,
        imageUrl: logo?.url ?? null,
        imageKind: logo?.kind ?? null,
        movies: movieResults.rows.map(r => ({
          id: r.id,
          title: r.title,
          year: r.year,
          posterUrl: r.poster_url,
          backdropUrl: r.backdrop_url,
          genres: r.genres || [],
          communityRating: r.community_rating,
        })),
        series: seriesResults.rows.map(r => ({
          id: r.id,
          title: r.title,
          year: r.year,
          posterUrl: r.poster_url,
          backdropUrl: r.backdrop_url,
          genres: r.genres || [],
          communityRating: r.community_rating,
        })),
        stats: {
          totalMovies: movieResults.rows.length,
          totalSeries: seriesResults.rows.length,
        },
      }

      return reply.send(response)
    }
  )
}

export default discoverRoutes
