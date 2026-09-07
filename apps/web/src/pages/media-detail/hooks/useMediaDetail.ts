import { useEffect, useState, useCallback } from 'react'
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
}

export function useMediaDetail(
  mediaType: MediaType,
  id: string | undefined,
  userId: string | undefined
): UseMediaDetailReturn {
  const [media, setMedia] = useState<Media | null>(null)
  const [similar, setSimilar] = useState<SimilarItem[]>([])
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
    const fetchMedia = async () => {
      if (!id) return

      setLoading(true)
      setError(null)

      try {
        const endpoint = mediaType === 'movie' ? `/api/movies/${id}` : `/api/series/${id}`

        // Fetch media and media server info in parallel
        const fetchPromises: Promise<Response>[] = [
          fetch(endpoint, { credentials: 'include' }),
          fetch('/api/settings/media-server', { credentials: 'include' }),
        ]

        // For series, also fetch episodes
        if (mediaType === 'series') {
          fetchPromises.push(fetch(`/api/series/${id}/episodes`, { credentials: 'include' }))
        }

        const responses = await Promise.all(fetchPromises)
        const [mediaResponse, mediaServerResponse, episodesResponse] = responses

        // Process media server info
        if (mediaServerResponse.ok) {
          const mediaServerData = await mediaServerResponse.json()
          setMediaServer(mediaServerData)
        }

        if (mediaResponse.ok) {
          const data = await mediaResponse.json()
          // Add type to the media object
          const mediaWithType = { ...data, type: mediaType } as Media
          setMedia(mediaWithType)

          // Process episodes for series
          if (mediaType === 'series' && episodesResponse?.ok) {
            const episodesData = await episodesResponse.json()
            setSeasons(episodesData.seasons || {})
            setSeasonAvailability(episodesData.seasonAvailability || [])
          }

          // Fetch similar items (same default count as graph neighbors)
          const similarEndpoint =
            mediaType === 'movie'
              ? `/api/movies/${id}/similar?limit=${DEFAULT_SIMILAR_MEDIA_LIMIT}`
              : `/api/series/${id}/similar?limit=${DEFAULT_SIMILAR_MEDIA_LIMIT}`

          const similarResponse = await fetch(similarEndpoint, { credentials: 'include' })
          if (similarResponse.ok) {
            const similarData = await similarResponse.json()
            setSimilar(similarData.similar || [])
          }

          // Fetch watch stats (how many users watched)
          const watchStatsEndpoint =
            mediaType === 'movie'
              ? `/api/movies/${id}/watch-stats`
              : `/api/series/${id}/watch-stats`
          
          const watchStatsResponse = await fetch(watchStatsEndpoint, { credentials: 'include' })
          if (watchStatsResponse.ok) {
            const statsData = await watchStatsResponse.json()
            setWatchStats(statsData)
          }

          // Fetch user-specific data
          if (userId) {
            const userFetchPromises: Promise<Response>[] = []

            // Insights endpoint (media-type specific)
            const insightsUrl =
              mediaType === 'movie'
                ? `/api/recommendations/${userId}/movie/${id}/insights`
                : `/api/recommendations/${userId}/series/${id}/insights`
            userFetchPromises.push(
              fetch(insightsUrl, { credentials: 'include' })
            )

            // Movie-specific: watch history
            if (mediaType === 'movie') {
              userFetchPromises.push(
                fetch(`/api/users/${userId}/watch-history?pageSize=1000&sortBy=title`, {
                  credentials: 'include',
                })
              )
            }

            // Rating endpoint (shared but different for movies/series)
            userFetchPromises.push(
              fetch(
                mediaType === 'movie' ? `/api/ratings/movie/${id}` : '/api/ratings',
                { credentials: 'include' }
              )
            )

            const userResponses = await Promise.all(userFetchPromises)

            if (mediaType === 'movie') {
              const [insightsResponse, watchHistoryResponse, ratingResponse] = userResponses

              if (insightsResponse.ok) {
                const insightsData = await insightsResponse.json()
                setInsights(insightsData)
              }

              if (watchHistoryResponse.ok) {
                const watchData = await watchHistoryResponse.json()
                const watchedMovie = watchData.history?.find(
                  (h: { movie_id: string }) => h.movie_id === id
                )
                if (watchedMovie) {
                  setWatchStatus({
                    isWatched: true,
                    playCount: watchedMovie.play_count || 1,
                    lastWatched: watchedMovie.last_played_at,
                  })
                } else {
                  setWatchStatus({ isWatched: false, playCount: 0, lastWatched: null })
                }
              }

              if (ratingResponse.ok) {
                const ratingData = await ratingResponse.json()
                setUserRating(ratingData.rating)
              }
            } else {
              const [insightsResponse, ratingResponse] = userResponses

              if (insightsResponse.ok) {
                const insightsData = await insightsResponse.json()
                setInsights(insightsData)
              }

              if (ratingResponse.ok) {
                const ratingsData = await ratingResponse.json()
                const seriesRating = ratingsData.ratings?.find(
                  (r: { series_id: string }) => r.series_id === id
                )
                setUserRating(seriesRating?.rating || null)
              }
            }
          }
        } else {
          setError(`${mediaType === 'movie' ? 'Movie' : 'Series'} not found`)
        }
      } catch {
        setError('Could not connect to server')
      } finally {
        setLoading(false)
      }
    }

    fetchMedia()
  }, [mediaType, id, userId])

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

  return {
    media,
    mediaType,
    similar,
    insights,
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

