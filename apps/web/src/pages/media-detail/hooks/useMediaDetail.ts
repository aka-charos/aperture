import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  Media,
  MediaType,
  Episode,
  SimilarItem,
  RecommendationInsights,
  MediaServerInfo,
  WatchStatus,
  MovieWatchStats,
  SeriesWatchStats,
  SeasonAvailability,
} from '../types'
import { DEFAULT_SIMILAR_MEDIA_LIMIT } from '../constants'
import { useUserRatings } from '@/hooks/useUserRatings'
import { onMovieWatched } from '@/lib/watchStatusEvents'

export type WatchStats = MovieWatchStats | SeriesWatchStats

/**
 * What the request backend permits for this title, as decided values.
 *
 * One answer for the whole page. Two controls need it — the missing-seasons
 * request button and the report-a-problem button — and each used to ask the
 * same endpoint for the same title itself, so a series with gaps made the call
 * twice and the two copies could disagree about which one had landed.
 *
 * Both fields default to false and stay false while the call is in flight or
 * if it fails, which is the safe direction: a control appears once it is known
 * to work, rather than flashing onto the page and then vanishing.
 */
export interface SeerrTitleStatus {
  /** This viewer may request content that is missing. */
  canRequest: boolean
  /**
   * The backend holds a media row for this title, so an issue can be filed
   * against it. Instance-level only — whether *this* viewer's account is
   * linked is checked when the report is submitted.
   */
  canReportIssue: boolean
}

const NO_SEERR_STATUS: SeerrTitleStatus = { canRequest: false, canReportIssue: false }

export interface UseMediaDetailReturn {
  media: Media | null
  mediaType: MediaType
  similar: SimilarItem[]
  /** True while the similar-titles search is still running (it is the slowest part of the page). */
  similarLoading: boolean
  insights: RecommendationInsights | null
  mediaServer: MediaServerInfo | null
  watchStatus: WatchStatus | null
  watchStats: WatchStats | null
  /** One answer per title, shared by every control that needs it. */
  seerrTitleStatus: SeerrTitleStatus
  userRating: number | null
  ratingLoading: boolean
  loading: boolean
  error: string | null
  // Series-specific
  seasons: Record<number, Episode[]>
  seasonAvailability: SeasonAvailability[]
  // Movie-specific
  clearWatchStatus: () => void
  /**
   * `watchedAt` is the date actually recorded. The Mark Watched button omits
   * it and means now; a backfill from the watch-date prompt passes the
   * resolved estimate, which can be a year away.
   */
  setWatchStatusWatched: (watchedAt?: string | null) => void
  isFavorite: boolean | null
  favoriteLoading: boolean
  toggleFavorite: () => Promise<boolean>
  // Shared
  updateRating: (rating: number | null) => Promise<void>
  /**
   * Rewrite this pick's AI explanation (one model call), then reload the
   * insights so the new text and any re-chosen shared titles show. Resolves
   * to the server's error sentence, or null on success.
   */
  refreshExplanation: () => Promise<string | null>
}

export function useMediaDetail(
  mediaType: MediaType,
  id: string | undefined,
  userId: string | undefined
): UseMediaDetailReturn {
  const { i18n } = useTranslation()
  const displayLanguage = i18n.resolvedLanguage ?? i18n.language
  const [media, setMedia] = useState<Media | null>(null)
  const [similar, setSimilar] = useState<SimilarItem[]>([])
  const [similarLoading, setSimilarLoading] = useState(true)
  const [insights, setInsights] = useState<RecommendationInsights | null>(null)
  const [mediaServer, setMediaServer] = useState<MediaServerInfo | null>(null)
  const [watchStatus, setWatchStatus] = useState<WatchStatus | null>(null)
  const [userRating, setUserRating] = useState<number | null>(null)
  const [ratingLoading, setRatingLoading] = useState(false)
  const { setRating: setSharedRating } = useUserRatings()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [watchStats, setWatchStats] = useState<WatchStats | null>(null)
  const [seerrTitleStatus, setSeerrTitleStatus] = useState<SeerrTitleStatus>(NO_SEERR_STATUS)
  // null until the media-server favorite status has loaded
  const [isFavorite, setIsFavorite] = useState<boolean | null>(null)
  const [favoriteLoading, setFavoriteLoading] = useState(false)
  // Series-specific
  const [seasons, setSeasons] = useState<Record<number, Episode[]>>({})
  const [seasonAvailability, setSeasonAvailability] = useState<SeasonAvailability[]>([])

  useEffect(() => {
    if (!id) return

    // The page used to await each of these in turn — media, then similar
    // titles, then watch stats, then the viewer's own data — and hold one
    // spinner over all of it. Similar titles is a vector search that takes
    // seconds, so every title page sat blank for that long and only then
    // started the rest. Now the page appears as soon as the title itself is in,
    // and each request fills its own part of it whenever it lands.
    //
    // `cancelled` matters more than it did: with the spinner gone early, a
    // late answer for the title just left would land on the one now open (the
    // modal swaps titles in place).
    let cancelled = false
    const live = () => !cancelled

    setLoading(true)
    setError(null)
    // Last title's answers must not show under this one while its own load.
    setSimilar([])
    setSimilarLoading(true)
    setWatchStats(null)
    setInsights(null)
    setWatchStatus(null)
    setUserRating(null)

    const getJson = async <T,>(url: string): Promise<T | null> => {
      const response = await fetch(url, { credentials: 'include' })
      return response.ok ? ((await response.json()) as T) : null
    }

    const base = mediaType === 'movie' ? `/api/movies/${id}` : `/api/series/${id}`

    // Everything below depends only on the id, so it starts with the title
    // rather than after it. Each part fails on its own and leaves its section
    // empty, as each did before.
    getJson<{ similar?: SimilarItem[] }>(`${base}/similar?limit=${DEFAULT_SIMILAR_MEDIA_LIMIT}`)
      .then((data) => {
        if (live() && data) setSimilar(data.similar || [])
      })
      .catch(() => {})
      .finally(() => {
        if (live()) setSimilarLoading(false)
      })

    getJson<WatchStats>(`${base}/watch-stats`)
      .then((data) => {
        if (live() && data) setWatchStats(data)
      })
      .catch(() => {})

    if (userId) {
      getJson<RecommendationInsights>(`/api/recommendations/${userId}/${mediaType}/${id}/insights`)
        .then((data) => {
          if (live() && data) setInsights(data)
        })
        .catch(() => {})

      if (mediaType === 'movie') {
        // Watch state for THIS film.
        //
        // This used to fetch the whole history with pageSize=1000 and scan it
        // for the movie, but the list route caps pageSize at 100 — so it saw
        // the first hundred titles alphabetically and answered "not watched"
        // for everything past them. On a 244-film history that is most of it,
        // and the page offered to Mark Watched films the viewer had finished
        // while the poster grids ticked them correctly.
        getJson<{ watched?: boolean; playCount?: number; lastWatched?: string | null }>(
          `/api/users/${userId}/watch-history/movies/${id}`
        )
          .then((watchData) => {
            if (!live() || !watchData) return
            setWatchStatus({
              isWatched: watchData.watched === true,
              playCount: watchData.playCount ?? 0,
              lastWatched: watchData.lastWatched ?? null,
            })
          })
          .catch(() => {})

        getJson<{ rating?: number | null }>(`/api/ratings/movie/${id}`)
          .then((ratingData) => {
            if (live() && ratingData) setUserRating(ratingData.rating ?? null)
          })
          .catch(() => {})
      } else {
        getJson<{ ratings?: { series_id: string; rating: number }[] }>('/api/ratings')
          .then((ratingsData) => {
            if (!live() || !ratingsData) return
            const seriesRating = ratingsData.ratings?.find((r) => r.series_id === id)
            setUserRating(seriesRating?.rating || null)
          })
          .catch(() => {})
      }
    }

    const fetchMedia = async () => {
      try {
        // The language the page is displayed in rides along, so the server can
        // attach a machine translation of the synopsis in that language
        // (`localized_synopsis`) — only the client knows which one it rendered.
        const lang = encodeURIComponent(displayLanguage)

        const fetchPromises: Promise<Response>[] = [
          fetch(`${base}?lang=${lang}`, { credentials: 'include' }),
          fetch('/api/settings/media-server', { credentials: 'include' }),
        ]
        if (mediaType === 'series') {
          fetchPromises.push(fetch(`/api/series/${id}/episodes`, { credentials: 'include' }))
        }

        const [mediaResponse, mediaServerResponse, episodesResponse] = await Promise.all(fetchPromises)
        if (!live()) return

        if (mediaServerResponse.ok) {
          const mediaServerData = await mediaServerResponse.json()
          if (live()) setMediaServer(mediaServerData)
        }

        if (!mediaResponse.ok) {
          if (live()) setError(`${mediaType === 'movie' ? 'Movie' : 'Series'} not found`)
          return
        }

        const data = await mediaResponse.json()
        if (!live()) return
        setMedia({ ...data, type: mediaType } as Media)

        if (mediaType === 'series' && episodesResponse?.ok) {
          const episodesData = await episodesResponse.json()
          if (!live()) return
          setSeasons(episodesData.seasons || {})
          setSeasonAvailability(episodesData.seasonAvailability || [])
        }
      } catch {
        if (live()) setError('Could not connect to server')
      } finally {
        if (live()) setLoading(false)
      }
    }

    fetchMedia()

    return () => {
      cancelled = true
    }
  }, [mediaType, id, userId, displayLanguage])

  // Favorite status lives on the media server, not in our DB — fetched separately.
  useEffect(() => {
    if (!id || !userId || mediaType !== 'movie') return

    let cancelled = false
    setIsFavorite(null)

    fetch(`/api/favorites/status?movieId=${id}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { favorite?: boolean } | null) => {
        if (!cancelled && data) setIsFavorite(data.favorite === true)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [mediaType, id, userId])

  // What the request backend permits for this title. Keyed on the TMDb id
  // rather than the library id because that is what the endpoint takes, and it
  // only exists once the media itself has landed.
  const tmdbId = media?.tmdb_id ?? null
  useEffect(() => {
    // Reset first: the detail page is rendered inside a modal that swaps
    // titles in place, so last title's answer must not outlive it.
    setSeerrTitleStatus(NO_SEERR_STATUS)
    const numericTmdbId = tmdbId != null ? Number(tmdbId) : NaN
    if (!Number.isFinite(numericTmdbId) || numericTmdbId <= 0) return

    let cancelled = false
    // Seerr's own vocabulary for a show is 'tv', not 'series'.
    const path = mediaType === 'movie' ? 'movie' : 'tv'
    fetch(`/api/seerr/status/${path}/${numericTmdbId}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { canRequest?: boolean; canReportIssue?: boolean } | null) => {
        // Absent reads as false in both directions — an older server that does
        // not send a field cannot honour the action behind it either.
        if (!cancelled) {
          setSeerrTitleStatus({
            canRequest: data?.canRequest === true,
            canReportIssue: data?.canReportIssue === true,
          })
        }
      })
      .catch(() => {
        if (!cancelled) setSeerrTitleStatus(NO_SEERR_STATUS)
      })

    return () => {
      cancelled = true
    }
  }, [mediaType, tmdbId])

  const toggleFavorite = useCallback(async (): Promise<boolean> => {
    if (!id || mediaType !== 'movie') return false

    const next = !isFavorite
    setFavoriteLoading(true)
    try {
      const response = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ movieIds: [id], favorite: next }),
      })
      if (!response.ok) return false
      setIsFavorite(next)
      return true
    } catch {
      return false
    } finally {
      setFavoriteLoading(false)
    }
  }, [mediaType, id, isFavorite])

  const clearWatchStatus = useCallback(() => {
    setWatchStatus({ isWatched: false, playCount: 0, lastWatched: null })
  }, [])

  const setWatchStatusWatched = useCallback((watchedAt?: string | null) => {
    setWatchStatus({
      isWatched: true,
      playCount: 1,
      lastWatched: watchedAt ?? new Date().toISOString(),
    })
  }, [])

  // The watch-date prompt writes the play from up near the root of the tree,
  // where rating lives, and cannot reach this page by a prop. Without this the
  // button goes on offering to mark watched a film it has just marked watched
  // — the write succeeded, only the screen disagreed.
  useEffect(() => {
    if (mediaType !== 'movie' || !id) return
    return onMovieWatched((event) => {
      if (event.movieId === id) setWatchStatusWatched(event.watchedAt)
    })
  }, [mediaType, id, setWatchStatusWatched])

  // Rating goes through the shared provider rather than posting here.
  //
  // This page used to call /api/ratings itself, which made it the second
  // implementation of one action — and the difference was invisible until
  // something was attached to rating: the "when did you watch this?" prompt
  // fired from cards and carousels and did nothing on the detail page, which
  // is where people actually rate. It also left the provider's ratings map
  // stale, so a card elsewhere kept showing the old stars until a reload.
  const updateRating = useCallback(
    async (rating: number | null) => {
      if (!id) return

      setRatingLoading(true)
      try {
        const next = rating === null || rating === 0 ? null : rating
        await setSharedRating(mediaType, id, next)
        setUserRating(next)
      } catch (err) {
        console.error('Failed to update rating:', err)
      } finally {
        setRatingLoading(false)
      }
    },
    [mediaType, id, setSharedRating]
  )

  const refreshExplanation = useCallback(async (): Promise<string | null> => {
    if (!userId || !id) return null
    try {
      const response = await fetch(
        `/api/recommendations/${userId}/${mediaType}/${id}/explanation`,
        { method: 'POST', credentials: 'include' }
      )
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        return body?.error ?? `HTTP ${response.status}`
      }
      const insightsResponse = await fetch(
        `/api/recommendations/${userId}/${mediaType}/${id}/insights`,
        { credentials: 'include' }
      )
      if (insightsResponse.ok) setInsights(await insightsResponse.json())
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }, [userId, id, mediaType])

  return {
    media,
    mediaType,
    similar,
    similarLoading,
    insights,
    refreshExplanation,
    mediaServer,
    watchStatus,
    watchStats,
    seerrTitleStatus,
    userRating,
    ratingLoading,
    loading,
    error,
    seasons,
    seasonAvailability,
    clearWatchStatus,
    setWatchStatusWatched,
    isFavorite,
    favoriteLoading,
    toggleFavorite,
    updateRating,
  }
}

export function formatRuntime(minutes: number | null | undefined): string {
  if (!minutes) return ''
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
}

