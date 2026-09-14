import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { MoviePoster } from '@aperture/ui'
import { PageHeading } from '@/components/PageHeading'
import { MediaPosterCard } from '../components/MediaPosterCard'
import { RequestSeerrOptionsDialog } from '../components/RequestSeerrOptionsDialog'
import {
  TmdbExternalDetailModal,
  type TmdbExternalDetailPayload,
} from '../components/TmdbExternalDetailModal'
import { useUserRatings } from '../hooks/useUserRatings'
import { useSeerrRequest } from './discovery/hooks/useSeerrRequest'
import type { SeerrRequestOptions } from '../types/seerrRequest'

/** Mirrors core's CollectionPartStatus by hand — the bundle never imports core. */
type PartStatus = 'owned' | 'available' | 'requested' | 'processing' | 'missing' | 'upcoming'
type PartSeerrStatus = 'none' | 'requested' | 'processing' | 'available'

interface FranchisePart {
  tmdbId: number | null
  title: string
  year: number | null
  releaseDate: string | null
  posterUrl: string | null
  libraryId: string | null
  libraryPosterUrl: string | null
  communityRating: number | null
  watched: boolean
  status: PartStatus
  seerrStatus: PartSeerrStatus
  requestable: boolean
}

interface FranchiseDetailResponse {
  collection: {
    id: string
    name: string
    overview: string | null
    posterUrl: string | null
    backdropUrl: string | null
  }
  tmdbAvailable: boolean
  seerrConfigured: boolean
  canRequest: boolean
  stats: {
    total: number
    watched: number
    byStatus: Record<PartStatus, number>
  }
  parts: FranchisePart[]
}

type OwnedPart = FranchisePart & { libraryId: string }

/**
 * Sized off the container, not the window: this page also renders beside the
 * docked assistant, where a breakpoint would keep desktop's column count in
 * half the width.
 */
const POSTER_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: 2,
} as const

/** TMDb dates are calendar days; formatted in UTC so none shifts by one. */
function formatReleaseDate(date: string, locale: string): string {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" sx={{ mb: 4 }}>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
        {title}
      </Typography>
      {children}
    </Box>
  )
}

/**
 * One TMDb collection: the films on the server, the ones that are not, and a
 * Request button for exactly those a request could bring.
 *
 * What each part is and whether it may be requested arrive decided from the
 * server (core `classifyCollectionPart`), so this page and admin gap analysis
 * cannot disagree about a title. The only state kept here is the request the
 * viewer just made, so a card changes under the press instead of on reload.
 */
export function FranchiseDetailPage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { getRating, setRating } = useUserRatings()
  const { submitRequest, isRequesting } = useSeerrRequest()

  const [data, setData] = useState<FranchiseDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestedIds, setRequestedIds] = useState<Set<number>>(new Set())
  const [optionsTarget, setOptionsTarget] = useState<FranchisePart | null>(null)
  const [snackbar, setSnackbar] = useState<{
    message: string
    severity: 'success' | 'error'
  } | null>(null)
  const [detailPart, setDetailPart] = useState<FranchisePart | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailData, setDetailData] = useState<TmdbExternalDetailPayload | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setRequestedIds(new Set())
    fetch(`/api/movies/franchises/${encodeURIComponent(id)}`, { credentials: 'include' })
      .then(async (res) => {
        if (res.status === 404) throw new Error('notFound')
        if (!res.ok) throw new Error('errorLoad')
        return (await res.json()) as FranchiseDetailResponse
      })
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setData(null)
        setError(
          err instanceof Error && err.message === 'notFound'
            ? t('browse.franchiseDetail.notFound')
            : t('browse.franchiseDetail.errorLoad')
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, t])

  const groups = useMemo(() => {
    const parts = data?.parts ?? []
    return {
      owned: parts.filter((part): part is OwnedPart => part.status === 'owned' && part.libraryId != null),
      notInLibrary: parts.filter((part) => part.status !== 'owned' && part.status !== 'upcoming'),
      upcoming: parts.filter((part) => part.status === 'upcoming'),
    }
  }, [data])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error || !data) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error ?? t('browse.franchiseDetail.errorLoad')}</Alert>
      </Box>
    )
  }

  const { collection, stats } = data

  const isPending = (part: FranchisePart) =>
    (part.tmdbId != null && requestedIds.has(part.tmdbId)) ||
    part.seerrStatus === 'requested' ||
    part.seerrStatus === 'processing'

  const canRequestPart = (part: FranchisePart) =>
    data.canRequest && part.requestable && part.tmdbId != null && !isPending(part)

  const handleOptionsConfirm = async (opts: SeerrRequestOptions) => {
    const part = optionsTarget
    // Closed before the await: the options dialog confirms straight through for
    // a viewer, and it would fire again on every render while still open.
    setOptionsTarget(null)
    if (!part || part.tmdbId == null) return
    const tmdbId = part.tmdbId
    // `direct`: someone went looking for this title, which is what separates it
    // from a suggestion the recommender made.
    const result = await submitRequest(tmdbId, 'movie', part.title, undefined, undefined, opts, 'direct')
    if (result.success) {
      setRequestedIds((prev) => new Set(prev).add(tmdbId))
      setSnackbar({
        severity: 'success',
        message: t('browse.franchiseDetail.requestSuccess', { title: part.title }),
      })
    } else {
      // Seerr's own sentence when there is one ("Movie Quota exceeded").
      setSnackbar({
        severity: 'error',
        message: result.error || t('browse.franchiseDetail.requestFailed', { title: part.title }),
      })
    }
  }

  const openDetail = (part: FranchisePart) => {
    if (part.tmdbId == null) return
    setDetailPart(part)
    setDetailLoading(true)
    setDetailError(null)
    setDetailData(null)
    fetch(`/api/discover/tmdb/movie/${part.tmdbId}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error || t('browse.franchiseDetail.detailFailed'))
        }
        return (await res.json()) as TmdbExternalDetailPayload
      })
      .then(setDetailData)
      .catch((err: unknown) =>
        setDetailError(err instanceof Error ? err.message : t('browse.franchiseDetail.detailFailed'))
      )
      .finally(() => setDetailLoading(false))
  }

  const closeDetail = () => {
    setDetailPart(null)
    setDetailData(null)
    setDetailError(null)
  }

  const statusCaption = (part: FranchisePart): string | null => {
    if (part.status === 'upcoming') {
      return part.releaseDate
        ? t('browse.franchiseDetail.releases', {
            date: formatReleaseDate(part.releaseDate, i18n.language),
          })
        : t('browse.franchiseDetail.dateTba')
    }
    if (part.status === 'available') return t('browse.franchiseDetail.availableSoon')
    return null
  }

  const renderTmdbCard = (part: FranchisePart) => {
    const caption = statusCaption(part)
    return (
      <Box key={part.tmdbId ?? part.title}>
        <MediaPosterCard
          tmdbId={part.tmdbId ?? 0}
          title={part.title}
          year={part.year}
          posterUrl={part.posterUrl}
          mediaType="movie"
          seerrStatus={isPending(part) ? { requested: true, requestStatus: 'pending' } : undefined}
          canRequest={canRequestPart(part)}
          isRequesting={part.tmdbId != null && isRequesting(part.tmdbId)}
          onRequest={() => setOptionsTarget(part)}
          onClick={() => openDetail(part)}
          compactMeta
        />
        {caption && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            {caption}
          </Typography>
        )}
      </Box>
    )
  }

  const notInLibraryCount = groups.notInLibrary.length
  const complete = data.tmdbAvailable && notInLibraryCount === 0 && groups.owned.length > 0

  // Why there are no Request buttons, when there are none to explain.
  const requestNotice =
    notInLibraryCount === 0
      ? null
      : !data.seerrConfigured
        ? t('browse.franchiseDetail.seerrNotConfigured')
        : !data.canRequest
          ? t('browse.franchiseDetail.requestsDisabled')
          : null

  return (
    <Box>
      <PageHeading
        title={collection.name}
        description={t('browse.franchiseDetail.summary', {
          total: stats.total,
          owned: stats.byStatus.owned,
          watched: stats.watched,
        })}
      />

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap', mb: 4 }}>
        <IconButton onClick={() => navigate(-1)} aria-label={t('browse.franchiseDetail.back')}>
          <ArrowBackIcon />
        </IconButton>
        {collection.posterUrl && (
          <Box
            component="img"
            src={collection.posterUrl}
            alt={collection.name}
            sx={{
              width: 120,
              maxWidth: '30%',
              aspectRatio: '2/3',
              objectFit: 'cover',
              borderRadius: 2,
            }}
          />
        )}
        <Box sx={{ flex: '1 1 16rem', minWidth: 0 }}>
          <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 1.5 }}>
            {complete && (
              <Chip
                icon={<CheckCircleIcon />}
                label={t('browse.franchises.complete')}
                color="success"
                size="small"
              />
            )}
            {stats.byStatus.missing > 0 && (
              <Chip
                label={t('browse.franchiseDetail.missingChip', { count: stats.byStatus.missing })}
                size="small"
                variant="outlined"
              />
            )}
            {stats.byStatus.upcoming > 0 && (
              <Chip
                label={t('browse.franchiseDetail.upcomingChip', { count: stats.byStatus.upcoming })}
                size="small"
                variant="outlined"
              />
            )}
          </Stack>
          {collection.overview && (
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '80ch' }}>
              {collection.overview}
            </Typography>
          )}
        </Box>
      </Box>

      {!data.tmdbAvailable && (
        <Alert severity="info" sx={{ mb: 3 }}>
          {t('browse.franchiseDetail.tmdbUnavailable')}
        </Alert>
      )}

      {groups.owned.length > 0 && (
        <Section title={t('browse.franchiseDetail.inLibrary', { count: groups.owned.length })}>
          <Box sx={POSTER_GRID}>
            {groups.owned.map((part) => (
              // `watched` from this response rather than useWatchStatus: it is
              // the figure the summary line counts, so the ticks and the line
              // cannot disagree (the Franchises list does the same).
              <MoviePoster
                key={part.libraryId}
                title={part.title}
                year={part.year}
                posterUrl={part.libraryPosterUrl ?? part.posterUrl}
                rating={part.communityRating}
                userRating={getRating('movie', part.libraryId)}
                watched={part.watched}
                onRate={(rating) => {
                  void setRating('movie', part.libraryId, rating).catch((err: unknown) =>
                    console.error('Failed to rate movie:', err)
                  )
                }}
                responsive
                onClick={() => navigate(`/movies/${part.libraryId}`)}
              />
            ))}
          </Box>
        </Section>
      )}

      {notInLibraryCount > 0 && (
        <Section title={t('browse.franchiseDetail.notInLibrary', { count: notInLibraryCount })}>
          {requestNotice && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {requestNotice}
            </Typography>
          )}
          <Box sx={POSTER_GRID}>{groups.notInLibrary.map(renderTmdbCard)}</Box>
        </Section>
      )}

      {groups.upcoming.length > 0 && (
        <Section title={t('browse.franchiseDetail.upcoming', { count: groups.upcoming.length })}>
          <Box sx={POSTER_GRID}>{groups.upcoming.map(renderTmdbCard)}</Box>
        </Section>
      )}

      <RequestSeerrOptionsDialog
        open={optionsTarget != null}
        mediaType="movie"
        title={optionsTarget?.title ?? ''}
        onClose={() => setOptionsTarget(null)}
        onConfirm={handleOptionsConfirm}
      />

      <TmdbExternalDetailModal
        open={detailPart != null}
        onClose={closeDetail}
        loading={detailLoading}
        error={detailError}
        data={detailData}
        sourceLabel={t('browse.franchiseDetail.sourceLabel')}
        canRequest={detailPart ? canRequestPart(detailPart) : false}
        isRequesting={detailPart?.tmdbId != null ? isRequesting(detailPart.tmdbId) : false}
        seerrAvailable={detailPart?.seerrStatus === 'available'}
        seerrPending={detailPart ? isPending(detailPart) : false}
        onRequest={detailPart ? () => setOptionsTarget(detailPart) : undefined}
      />

      <Snackbar
        open={snackbar != null}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snackbar ? (
          <Alert onClose={() => setSnackbar(null)} severity={snackbar.severity} sx={{ width: '100%' }}>
            {snackbar.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  )
}
