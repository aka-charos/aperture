/**
 * Franchise Detail Handler
 *
 * GET /api/movies/franchises/:id - One TMDb collection: every part, which ones
 * this library holds, which are missing or upcoming, and which may be requested.
 *
 * "Franchise" rather than "collection" in the route on purpose: `/collections`
 * in this app is channels written out as media-server Box Sets.
 */
import type { FastifyInstance } from 'fastify'
import {
  batchGetSeerrMediaStatus,
  classifyCollectionPart,
  getCollectionDataCached,
  getImageUrl,
  isSeerrConfigured,
  type ClassifiedCollectionPart,
  type CollectionPartStatus,
  type SeerrMediaStatusLike,
} from '@aperture/core'
import { query, queryOne } from '../../../lib/db.js'
import { requireAuth, type SessionUser } from '../../../plugins/auth.js'
import { franchiseDetailSchema } from '../schemas.js'

interface LibraryRow {
  id: string
  tmdb_id: string | null
  title: string
  year: number | null
  poster_url: string | null
  community_rating: string | number | null
  collection_name: string | null
  watched: boolean
}

type FranchisePart = ClassifiedCollectionPart & {
  tmdbId: number | null
  title: string
  year: number | null
  releaseDate: string | null
  /** TMDb artwork; always present for a part TMDb lists, whether or not it is owned. */
  posterUrl: string | null
  libraryId: string | null
  /** The media server's artwork, for an owned part. */
  libraryPosterUrl: string | null
  communityRating: number | null
  watched: boolean
}

/** NUMERIC arrives as text, and `Number(null)` is 0 — so NULL stays null. */
function toNumberOrNull(value: string | number | null): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function yearFrom(releaseDate: string | null | undefined): number | null {
  if (!releaseDate || releaseDate.length < 4) return null
  const y = parseInt(releaseDate.slice(0, 4), 10)
  return Number.isFinite(y) ? y : null
}

/** Franchise order: by date, undated last, falling back to the year a library row carries. */
function sortKey(part: FranchisePart): string {
  return part.releaseDate || (part.year != null ? `${part.year}-12-31` : '9999-12-31')
}

export function registerFranchiseDetailHandler(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string } }>(
    '/api/movies/franchises/:id',
    {
      preHandler: requireAuth,
      schema: franchiseDetailSchema,
    },
    async (request, reply) => {
      const user = request.user as SessionUser
      const collectionId = parseInt(request.params.id, 10)
      if (!Number.isFinite(collectionId)) {
        return reply.status(400).send({ error: 'Invalid franchise id' })
      }

      const collection = await getCollectionDataCached(collectionId)
      const partTmdbIds = (collection?.parts ?? []).map((part) => String(part.tmdbId))

      // By TMDb id for the parts TMDb lists, and by collection_id for anything
      // this library files under the collection that the list does not name —
      // a part list changes, and a film on the server must not vanish from its
      // own franchise for it.
      //
      // played = true, not "has a row": a favorited-but-unplayed title and one
      // abandoned minutes in both have a watch_history row, and this is the
      // figure a tick is drawn from (F-109, F-114).
      const libraryResult = await query<LibraryRow>(
        `SELECT m.id, m.tmdb_id, m.title, m.year, m.poster_url, m.community_rating,
                m.collection_name, (wh.id IS NOT NULL) AS watched
         FROM movies m
         LEFT JOIN watch_history wh
           ON wh.movie_id = m.id AND wh.user_id = $1 AND wh.played = true
         WHERE m.tmdb_id = ANY($2::text[]) OR m.collection_id = $3
         ORDER BY m.year NULLS LAST, m.title`,
        [user.id, partTmdbIds, String(collectionId)]
      )

      if (!collection && libraryResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Franchise not found' })
      }

      // One part per title: a film held in two libraries is still one film,
      // and watched on either copy is watched.
      const libraryByTmdb = new Map<string, LibraryRow>()
      const libraryWithoutTmdb: LibraryRow[] = []
      for (const row of libraryResult.rows) {
        const key = row.tmdb_id?.trim()
        if (!key) {
          libraryWithoutTmdb.push(row)
          continue
        }
        const seen = libraryByTmdb.get(key)
        if (!seen) libraryByTmdb.set(key, row)
        else if (row.watched && !seen.watched) libraryByTmdb.set(key, { ...seen, watched: true })
      }

      const seerrConfigured = await isSeerrConfigured()

      // Asked for every part the library lacks, upcoming ones included, so a
      // request someone already filed for an announced sequel still shows.
      let statuses = new Map<number, SeerrMediaStatusLike>()
      const toAsk = (collection?.parts ?? [])
        .filter((part) => !libraryByTmdb.has(String(part.tmdbId)))
        .map((part) => ({ tmdbId: part.tmdbId, mediaType: 'movie' as const }))
      if (seerrConfigured && toAsk.length > 0) {
        try {
          statuses = await batchGetSeerrMediaStatus(toAsk)
        } catch (err) {
          request.log.warn(
            { err, collectionId },
            'Seerr status lookup failed; franchise parts shown without request state'
          )
        }
      }

      // Decided here, the same test /api/seerr/status applies, so the page
      // never has to guess whether its Request buttons would work.
      let canRequest = false
      if (seerrConfigured) {
        const row = await queryOne<{ discover_request_enabled: boolean }>(
          `SELECT discover_request_enabled FROM users WHERE id = $1`,
          [user.id]
        )
        canRequest = row?.discover_request_enabled === true
      }

      const parts: FranchisePart[] = []
      const listed = new Set<string>()

      for (const part of collection?.parts ?? []) {
        const key = String(part.tmdbId)
        listed.add(key)
        const lib = libraryByTmdb.get(key)
        parts.push({
          tmdbId: part.tmdbId,
          // The owned copy's title, which is the one on its poster.
          title: lib?.title ?? part.title,
          year: lib?.year ?? yearFrom(part.releaseDate),
          releaseDate: part.releaseDate || null,
          posterUrl: getImageUrl(part.posterPath, 'w342'),
          libraryId: lib?.id ?? null,
          libraryPosterUrl: lib?.poster_url ?? null,
          communityRating: lib ? toNumberOrNull(lib.community_rating) : null,
          watched: lib?.watched === true,
          ...classifyCollectionPart({
            releaseDate: part.releaseDate,
            inLibrary: lib != null,
            seerr: statuses.get(part.tmdbId),
          }),
        })
      }

      const unlisted = [
        ...[...libraryByTmdb.entries()].filter(([key]) => !listed.has(key)).map(([, row]) => row),
        ...libraryWithoutTmdb,
      ]
      for (const row of unlisted) {
        const tmdbId = row.tmdb_id != null ? Number(row.tmdb_id) : NaN
        parts.push({
          tmdbId: Number.isFinite(tmdbId) ? tmdbId : null,
          title: row.title,
          year: row.year,
          releaseDate: null,
          posterUrl: null,
          libraryId: row.id,
          libraryPosterUrl: row.poster_url,
          communityRating: toNumberOrNull(row.community_rating),
          watched: row.watched === true,
          ...classifyCollectionPart({ releaseDate: null, inLibrary: true }),
        })
      }

      parts.sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.title.localeCompare(b.title))

      const byStatus: Record<CollectionPartStatus, number> = {
        owned: 0,
        available: 0,
        requested: 0,
        processing: 0,
        missing: 0,
        upcoming: 0,
      }
      for (const part of parts) byStatus[part.status]++

      return reply.send({
        collection: {
          id: String(collectionId),
          name:
            collection?.name ??
            libraryResult.rows.find((row) => row.collection_name)?.collection_name ??
            '',
          overview: collection?.overview ?? null,
          posterUrl: collection?.posterUrl ?? null,
          backdropUrl: collection?.backdropUrl ?? null,
        },
        // False means TMDb gave nothing, so only owned films are listed and
        // "nothing missing" would be a claim this response cannot make.
        tmdbAvailable: collection != null,
        seerrConfigured,
        canRequest,
        stats: {
          total: parts.length,
          watched: parts.filter((part) => part.status === 'owned' && part.watched).length,
          byStatus,
        },
        parts,
      })
    }
  )
}
