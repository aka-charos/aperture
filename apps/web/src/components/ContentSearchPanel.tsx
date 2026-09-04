/**
 * Search for content that is not in the library, and request it.
 *
 * Lives in `components/` rather than beside a page because the point of it is
 * to be mountable anywhere a "find me something" affordance belongs — it is
 * on My Requests today, and the library Search page is the obvious second
 * home. It owns the search box and the request flow; the host page owns the
 * detail modal, since a page that already has one should not get a second.
 *
 * Everything it renders comes from `GET /api/seerr/search`, which answers in
 * Aperture's shape with decided values (`inLibrary`, `availability`,
 * `requested`) rather than a backend's status codes — so this file has no
 * opinion about which backend answered.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Avatar,
  Box,
  Chip,
  CircularProgress,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { MediaPosterCard } from './MediaPosterCard'
import { RequestSeerrOptionsDialog } from './RequestSeerrOptionsDialog'
import { SeasonSelectModal, type SeasonInfo } from '../pages/discovery/components/SeasonSelectModal'
import { useSeerrRequest } from '../pages/discovery/hooks/useSeerrRequest'
import type { SeerrRequestOptions } from '../types/seerrRequest'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500'
const TMDB_PROFILE_BASE = 'https://image.tmdb.org/t/p/w185'
const SEARCH_DEBOUNCE_MS = 400
const MIN_QUERY_LENGTH = 2

export interface ContentSearchItem {
  tmdbId: number
  mediaType: 'movie' | 'series' | 'person'
  title: string
  year: number | null
  overview: string | null
  posterPath: string | null
  backdropPath: string | null
  profilePath: string | null
  voteAverage: number | null
  availability: 'unknown' | 'pending' | 'processing' | 'partially_available' | 'available'
  requested: boolean
  requestStatus: 'pending' | 'approved' | 'declined' | null
  knownFor: string[]
  inLibrary: boolean
  libraryMediaId: string | null
}

interface ContentSearchResponse {
  page: number
  totalPages: number
  totalResults: number
  canRequest: boolean
  source: string | null
  results: ContentSearchItem[]
}

interface ContentSearchPanelProps {
  /** Called when a result's info button is pressed, so the host can open its own modal. */
  onShowDetails?: (item: ContentSearchItem) => void
  /** Raised after a request lands, so the host can refresh its own list. */
  onRequested?: (item: ContentSearchItem) => void
  onNotify?: (message: string, severity: 'success' | 'error') => void
}

/**
 * One result, with the request flow attached.
 *
 * Mirrors DiscoveryCard's sequence — options dialog, then the season picker
 * for a series, then submit — rather than sharing it, because that component
 * is bound to a DiscoveryCandidate. The sequence is the part that has to stay
 * the same; if one gains a step, so should the other.
 */
function SearchResultCard({
  item,
  canRequest,
  isRequesting,
  onRequest,
  onShowDetails,
  fetchTVDetails,
}: {
  item: ContentSearchItem
  canRequest: boolean
  isRequesting: boolean
  onRequest: (item: ContentSearchItem, seasons?: number[], opts?: SeerrRequestOptions) => Promise<void>
  onShowDetails?: (item: ContentSearchItem) => void
  fetchTVDetails: (tmdbId: number) => Promise<{ seasons: SeasonInfo[]; title: string; posterPath?: string } | null>
}) {
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [pendingOpts, setPendingOpts] = useState<SeerrRequestOptions | null>(null)
  const [seasonOpen, setSeasonOpen] = useState(false)
  const [seasonLoading, setSeasonLoading] = useState(false)
  const [seasonData, setSeasonData] = useState<{ seasons: SeasonInfo[]; title: string; posterPath?: string } | null>(null)

  const mediaType = item.mediaType === 'movie' ? 'movie' : 'series'
  const posterUrl = item.posterPath ? `${TMDB_IMAGE_BASE}${item.posterPath}` : null

  const handleOptionsConfirm = async (opts: SeerrRequestOptions) => {
    setOptionsOpen(false)
    if (mediaType === 'movie') {
      await onRequest(item, undefined, opts)
      return
    }
    setPendingOpts(opts)
    setSeasonLoading(true)
    setSeasonOpen(true)
    setSeasonData(await fetchTVDetails(item.tmdbId))
    setSeasonLoading(false)
  }

  return (
    <Box sx={{ position: 'relative', height: '100%' }}>
      <MediaPosterCard
        tmdbId={item.tmdbId}
        title={item.title}
        year={item.year}
        posterUrl={posterUrl}
        mediaType={mediaType}
        inLibrary={item.inLibrary}
        libraryId={item.libraryMediaId ?? undefined}
        seerrStatus={{
          requested: item.requested,
          requestStatus: item.requestStatus ?? undefined,
        }}
        // Something already in the library, or already available in Seerr, has
        // nothing to request — the button would submit a duplicate that Seerr
        // answers with a 409.
        canRequest={canRequest && !item.inLibrary && item.availability !== 'available'}
        isRequesting={isRequesting}
        onRequest={() => setOptionsOpen(true)}
        overview={item.overview}
        voteAverage={item.voteAverage}
        onShowDetails={onShowDetails ? () => onShowDetails(item) : undefined}
        onClick={onShowDetails ? () => onShowDetails(item) : undefined}
      />

      <RequestSeerrOptionsDialog
        open={optionsOpen}
        mediaType={mediaType}
        title={item.title}
        onClose={() => setOptionsOpen(false)}
        onConfirm={handleOptionsConfirm}
      />

      <SeasonSelectModal
        open={seasonOpen}
        onClose={() => {
          setSeasonOpen(false)
          setSeasonData(null)
          setPendingOpts(null)
        }}
        onSubmit={(seasons) => onRequest(item, seasons, pendingOpts ?? undefined)}
        title={seasonData?.title || item.title}
        posterPath={seasonData?.posterPath || item.posterPath || undefined}
        seasons={seasonData?.seasons || []}
        loading={seasonLoading}
      />
    </Box>
  )
}

export function ContentSearchPanel({
  onShowDetails,
  onRequested,
  onNotify,
}: ContentSearchPanelProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { submitRequest, isRequesting, fetchTVDetails } = useSeerrRequest()

  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ContentSearchResponse | null>(null)
  /** tmdbIds requested in this session, so a card flips without a refetch. */
  const [justRequested, setJustRequested] = useState<Set<number>>(new Set())

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Guards against an older response overwriting a newer one. Typing fires
   * several requests and they do not necessarily land in order, so results
   * for "the god" can arrive after "the godfather" and stay on screen.
   */
  const requestSeqRef = useRef(0)

  const runSearch = useCallback(
    async (text: string) => {
      const seq = ++requestSeqRef.current
      setLoading(true)
      setError(null)
      setUnavailable(false)
      try {
        const url = new URL('/api/seerr/search', window.location.origin)
        url.searchParams.set('query', text)
        const res = await fetch(url.toString(), { credentials: 'include' })
        if (seq !== requestSeqRef.current) return

        if (res.status === 503) {
          setData(null)
          setUnavailable(true)
          return
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
          throw new Error(body.message || body.error || t('contentSearch.errorSearch'))
        }
        setData((await res.json()) as ContentSearchResponse)
      } catch (e) {
        if (seq !== requestSeqRef.current) return
        setData(null)
        setError(e instanceof Error ? e.message : t('contentSearch.errorSearch'))
      } finally {
        if (seq === requestSeqRef.current) setLoading(false)
      }
    },
    [t]
  )

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      requestSeqRef.current++
      setData(null)
      setLoading(false)
      setError(null)
      setUnavailable(false)
      return
    }
    debounceRef.current = setTimeout(() => void runSearch(trimmed), SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, runSearch])

  const handleRequest = useCallback(
    async (item: ContentSearchItem, seasons?: number[], opts?: SeerrRequestOptions) => {
      const result = await submitRequest(
        item.tmdbId,
        item.mediaType === 'movie' ? 'movie' : 'series',
        item.title,
        undefined,
        seasons,
        opts,
        // Someone searched for this and asked for it, which is a different act
        // from accepting a Discovery suggestion — and telling the two apart is
        // the whole point of the source column.
        'direct'
      )
      if (result.success) {
        setJustRequested((prev) => new Set(prev).add(item.tmdbId))
        onNotify?.(t('contentSearch.requestSubmitted', { title: item.title }), 'success')
        onRequested?.(item)
      } else {
        // The server passes Seerr's own sentence through ("Movie Quota
        // exceeded"), which is the whole point of showing it rather than a
        // generic failure the user cannot act on.
        onNotify?.(result.error || t('contentSearch.requestFailed'), 'error')
      }
    },
    [submitRequest, onNotify, onRequested, t]
  )

  // Split rather than one mixed grid. Relevance order interleaves a film, a
  // show and a film again, so scanning for "the series called X" means reading
  // every card; within each section the backend's ordering is preserved.
  const results = data?.results ?? []
  const movies = results.filter((r) => r.mediaType === 'movie')
  const series = results.filter((r) => r.mediaType === 'series')
  const people = results.filter((r) => r.mediaType === 'person')
  const titles = movies.length + series.length
  const hasQuery = query.trim().length >= MIN_QUERY_LENGTH

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: { xs: 2, md: 3 }, mb: 3 }}>
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        {t('contentSearch.heading')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('contentSearch.subheading')}
      </Typography>

      <TextField
        fullWidth
        size="small"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('contentSearch.placeholder')}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: loading ? (
              <InputAdornment position="end">
                <CircularProgress size={18} />
              </InputAdornment>
            ) : null,
          },
        }}
      />

      {unavailable && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {t('contentSearch.unavailable')}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {data && data.canRequest === false && titles > 0 && (
        <Alert severity="info" sx={{ mt: 2 }}>
          {t('contentSearch.requestsDisabled')}
        </Alert>
      )}

      {hasQuery && !loading && !unavailable && !error && data && data.results.length === 0 && (
        <Typography color="text.secondary" sx={{ mt: 3 }}>
          {t('contentSearch.noResults', { query: query.trim() })}
        </Typography>
      )}

      {people.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            {t('contentSearch.people')}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {people.map((person) => (
              <Tooltip
                key={`person-${person.tmdbId}`}
                title={person.knownFor.join(' · ')}
                disableHoverListener={person.knownFor.length === 0}
              >
                <Chip
                  avatar={
                    <Avatar
                      alt={person.title}
                      src={person.profilePath ? `${TMDB_PROFILE_BASE}${person.profilePath}` : undefined}
                    />
                  }
                  label={person.title}
                  variant="outlined"
                  onClick={() => navigate(`/person/${encodeURIComponent(person.title)}`)}
                />
              </Tooltip>
            ))}
          </Stack>
        </Box>
      )}

      {([
        { key: 'movies', heading: t('contentSearch.movies'), items: movies },
        { key: 'series', heading: t('contentSearch.series'), items: series },
      ] as const).map(({ key, heading, items }) =>
        items.length === 0 ? null : (
          <Box key={key} sx={{ mt: 3 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              {heading} ({items.length})
            </Typography>
            <Box
              sx={{
                display: 'grid',
                // Sized off this container, not the viewport: the panel sits in
                // a page that narrows when the assistant is docked, so a
                // breakpoint grid would keep its full-desktop column count in
                // half the width.
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 2,
              }}
            >
              {items.map((item) => (
                <SearchResultCard
                  key={`${item.mediaType}-${item.tmdbId}`}
                  item={
                    justRequested.has(item.tmdbId)
                      ? { ...item, requested: true, requestStatus: item.requestStatus ?? 'pending' }
                      : item
                  }
                  canRequest={data?.canRequest ?? false}
                  isRequesting={isRequesting(item.tmdbId)}
                  onRequest={handleRequest}
                  onShowDetails={onShowDetails}
                  fetchTVDetails={fetchTVDetails}
                />
              ))}
            </Box>
          </Box>
        )
      )}
    </Paper>
  )
}
