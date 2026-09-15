import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import SearchIcon from '@mui/icons-material/Search'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { MoviePoster } from '@aperture/ui'
import { RequestSeerrOptionsDialog } from '../../components/RequestSeerrOptionsDialog'
import {
  TmdbExternalDetailModal,
  type TmdbExternalDetailPayload,
} from '../../components/TmdbExternalDetailModal'
import type { SeerrRequestOptions } from '../../types/seerrRequest'
import { PageHeading } from '@/components/PageHeading'
import { MediaDetailModalProvider } from '@/hooks/MediaDetailModalProvider'
import { useMediaDetailModal } from '@/hooks/useMediaDetailModal'
import { adminPathFor } from './nav/registry'
import { jobConsoleLink } from '../jobs/registry'
import { GapCollectionRow } from './gapAnalysis/GapCollectionRow'
import {
  buildGapListings,
  compareByRelease,
  listingMatchesSearch,
  matchesMissingFilter,
  relativeTimeParts,
  sortGapListings,
  type GapCollectionListing,
  type GapCollectionSummary,
  type GapMissingFilter,
  type GapMissingTitle,
  type GapSort,
} from './gapAnalysis/listing'

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500'
const BULK_CONFIRM_THRESHOLD = 5
/** The request route refuses more than this per call, so a larger selection is sent in batches. */
const REQUEST_BATCH_SIZE = 200
/** Collections rendered per step; a snapshot routinely has hundreds. */
const PAGE_SIZE = 50
const RESULTS_PAGE_SIZE = 500
const MAX_RESULT_PAGES = 40
const PROGRESS_POLL_MS = 600
/** How often a running scan refetches the listing — progress polls far faster than that is worth. */
const LIVE_LIST_REFRESH_MS = 3000
const POLL_TIMEOUT_MS = 15 * 60 * 1000

/** Sized off the container: this page renders beside the admin nav, where `lg` is rarely reached. */
const PARTS_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
  gap: 2,
} as const

type GapRequestItem = { tmdbId: number; mediaType: 'movie'; title: string }

interface GapRun {
  id: string
  status: string
  collectionsScanned: number
  totalParts: number
  ownedParts: number
  missingCount: number
  completedAt: string | null
  startedAt: string
}

interface LatestResponse {
  prerequisites: { tmdbConfigured: boolean; moviesWithCollectionCount: number }
  run: GapRun | null
  activeRun: GapRun | null
  collectionSummaries?: GapCollectionSummary[]
  moviesAddedSinceRun?: number | null
}

type PartSeerrStatus = 'none' | 'requested' | 'processing' | 'available'

interface GapCollectionPart {
  tmdbId: number
  title: string
  releaseYear: number | null
  releaseDate: string | null
  posterPath: string | null
  inLibrary: boolean
  seerrStatus: PartSeerrStatus
  /** The library movie holding this part now, if any. */
  libraryId: string | null
}

interface GapCollectionPartsPayload {
  collectionId: number
  collectionName: string
  collectionPosterPath: string | null
  parts: GapCollectionPart[]
}

interface GapRow extends GapMissingTitle {
  id: string
  collectionName: string
}

interface JobProgressState {
  overallProgress: number
  currentStep: string
  itemsProcessed: number
  itemsTotal: number
  currentItem?: string
}

/**
 * How a part reads in the expanded grid. `requested` is a part the scan saw as
 * a gap that is no longer open — requested since, from here or elsewhere — so
 * it must not offer a Request button the row's own count has stopped counting.
 */
type PartVariant = 'owned' | 'seerr' | 'requested' | 'missing'

type DisplayPart = GapCollectionPart & { variant: PartVariant }

function seerrChipLabel(status: PartSeerrStatus, t: TFunction): string {
  switch (status) {
    case 'processing':
      return t('admin.gaps.seerrProcessing')
    case 'available':
      return t('admin.gaps.seerrAvailable')
    default:
      return t('admin.gaps.seerrRequested')
  }
}

function PartStatusChip({ icon, label, color }: { icon: ReactElement; label: string; color: string }) {
  return (
    <Chip
      icon={icon}
      label={label}
      size="small"
      sx={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        zIndex: 3,
        fontWeight: 600,
        fontSize: '0.7rem',
        height: 24,
        bgcolor: alpha(color, 0.9),
        color: 'common.white',
        '& .MuiChip-icon': { color: 'common.white' },
      }}
    />
  )
}

function SnapshotStat({ value, label, detail }: { value: string; label: string; detail?: string }) {
  return (
    <Box sx={{ px: 1.5, py: 1.25, borderRadius: 1.5, bgcolor: 'action.hover', minWidth: 0 }}>
      <Typography variant="h5" fontWeight={700} lineHeight={1.2}>
        {value}
      </Typography>
      <Typography variant="body2">{label}</Typography>
      {detail && (
        <Typography variant="caption" color="text.secondary" display="block" noWrap>
          {detail}
        </Typography>
      )}
    </Box>
  )
}

function ListSkeleton() {
  return (
    <Stack spacing={1}>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} variant="rounded" height={72} />
      ))}
    </Stack>
  )
}

export function GapAnalysisPage() {
  // An owned film opens its library page in a dialog, so the admin keeps the
  // collection they were reading instead of being routed away from it.
  return (
    <MediaDetailModalProvider>
      <GapAnalysisContent />
    </MediaDetailModalProvider>
  )
}

function GapAnalysisContent() {
  const { t, i18n } = useTranslation()
  const theme = useTheme()
  const navigate = useNavigate()
  const openMediaDetail = useMediaDetailModal()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [run, setRun] = useState<GapRun | null>(null)
  const [activeRun, setActiveRun] = useState<GapRun | null>(null)
  const [jobProgress, setJobProgress] = useState<JobProgressState | null>(null)
  const [summaries, setSummaries] = useState<GapCollectionSummary[]>([])
  const [prereq, setPrereq] = useState<LatestResponse['prerequisites'] | null>(null)
  const [moviesAddedSinceRun, setMoviesAddedSinceRun] = useState<number | null>(null)
  const [rows, setRows] = useState<GapRow[]>([])
  /** The run whose gaps `rows` holds — until it matches the displayed run, the list is still loading. */
  const [resultsRunId, setResultsRunId] = useState<string | null>(null)
  const [seerrOk, setSeerrOk] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<GapSort>('closest')
  const [missingFilter, setMissingFilter] = useState<GapMissingFilter>('any')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [locallyRequested, setLocallyRequested] = useState<Set<number>>(new Set())
  const [requestOptionsOpen, setRequestOptionsOpen] = useState(false)
  const [itemsPendingSeerrOptions, setItemsPendingSeerrOptions] = useState<GapRequestItem[] | null>(null)
  const [optionsDialogTitle, setOptionsDialogTitle] = useState('')
  const [pendingBulkAfterOptions, setPendingBulkAfterOptions] = useState<{
    items: GapRequestItem[]
    seerrOptions: SeerrRequestOptions
  } | null>(null)
  const [collectionPartsById, setCollectionPartsById] = useState<Record<number, GapCollectionPartsPayload | undefined>>({})
  const [expandedCollections, setExpandedCollections] = useState<Set<number>>(new Set())
  const [partsLoading, setPartsLoading] = useState<Set<number>>(new Set())
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailData, setDetailData] = useState<TmdbExternalDetailPayload | null>(null)
  const [detailPart, setDetailPart] = useState<Pick<GapCollectionPart, 'tmdbId' | 'title' | 'inLibrary' | 'seerrStatus'> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const formatNumber = useCallback((n: number) => n.toLocaleString(i18n.language), [i18n.language])

  /** Returns the id of the run the page should show — the running one if any. */
  const loadLatest = useCallback(async (): Promise<string | null> => {
    // Deliberately does not clear `error`: this reload follows a request, and
    // clearing here wiped the request's own failure message before it rendered.
    try {
      const [latestRes, seerrRes] = await Promise.all([
        fetch('/api/admin/gap-analysis/latest', { credentials: 'include' }),
        fetch('/api/seerr/config', { credentials: 'include' }),
      ])
      if (!latestRes.ok) {
        const d = await latestRes.json().catch(() => ({}))
        throw new Error(d.error || t('admin.gaps.errorLoadGapAnalysis'))
      }
      const data = (await latestRes.json()) as LatestResponse
      setPrereq(data.prerequisites)
      setRun(data.run ?? null)
      setActiveRun(data.activeRun ?? null)
      setSummaries(data.collectionSummaries ?? [])
      setMoviesAddedSinceRun(data.moviesAddedSinceRun ?? null)

      if (seerrRes.ok) {
        const sc = await seerrRes.json()
        setSeerrOk(!!(sc.configured && sc.enabled && sc.hasApiKey))
      } else {
        setSeerrOk(false)
      }
      return data.activeRun?.id ?? data.run?.id ?? null
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.gaps.errorFailedToLoad'))
      return null
    } finally {
      setLoading(false)
    }
  }, [t])

  /**
   * Every open gap for a run, loaded once; search and filters work on this
   * copy. It used to refetch all pages on each keystroke.
   */
  const loadResults = useCallback(
    async (runId: string) => {
      try {
        const all: GapRow[] = []
        let page = 1
        let total = 0
        do {
          const u = new URL('/api/admin/gap-analysis/results', window.location.origin)
          u.searchParams.set('runId', runId)
          u.searchParams.set('page', String(page))
          u.searchParams.set('pageSize', String(RESULTS_PAGE_SIZE))
          const res = await fetch(u.toString(), { credentials: 'include' })
          if (!res.ok) throw new Error(t('admin.gaps.errorLoadGapAnalysis'))
          const data = await res.json()
          total = data.total ?? 0
          const chunk = (data.rows || []) as GapRow[]
          all.push(...chunk)
          if (chunk.length === 0) break
          page++
        } while (all.length < total && page <= MAX_RESULT_PAGES)
        setRows(all)
      } catch (e) {
        // Keep whatever was already listed rather than blanking it.
        setError(e instanceof Error ? e.message : t('admin.gaps.errorLoadGapAnalysis'))
      } finally {
        setResultsRunId(runId)
      }
    },
    [t]
  )

  useEffect(() => {
    void loadLatest()
  }, [loadLatest])

  const displayRunId = activeRun?.id ?? run?.id ?? null

  useEffect(() => {
    if (displayRunId) {
      void loadResults(displayRunId)
    } else {
      setRows([])
      setResultsRunId(null)
    }
  }, [displayRunId, loadResults])

  useEffect(() => {
    setCollectionPartsById({})
    setExpandedCollections(new Set())
  }, [displayRunId])

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const listReady = displayRunId != null && resultsRunId === displayRunId

  const listings = useMemo(() => buildGapListings(summaries, rows), [summaries, rows])

  const filtered = useMemo(
    () =>
      sortGapListings(
        listings.filter(
          (l) => listingMatchesSearch(l, search) && matchesMissingFilter(l.missing.length, missingFilter)
        ),
        sortBy
      ),
    [listings, search, missingFilter, sortBy]
  )

  const shown = filtered.slice(0, visibleCount)

  /** A film can sit in two TMDb collections; it is still one film to request. */
  const openGapIds = useMemo(() => new Set(rows.map((r) => r.tmdbId)), [rows])

  const filteredMissingCount = useMemo(() => {
    const ids = new Set<number>()
    for (const l of filtered) for (const m of l.missing) ids.add(m.tmdbId)
    return ids.size
  }, [filtered])

  const requestableIds = useCallback(
    (listing: GapCollectionListing<GapRow>) =>
      listing.missing.filter((m) => !locallyRequested.has(m.tmdbId)).map((m) => m.tmdbId),
    [locallyRequested]
  )

  const setSelection = (ids: number[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  const toggleIds = (ids: number[]) => {
    if (ids.length === 0) return
    setSelection(ids, !ids.every((id) => selected.has(id)))
  }

  const shownRequestableIds = shown.flatMap(requestableIds)
  const shownSelected = shownRequestableIds.filter((id) => selected.has(id)).length

  const clearSel = () => setSelected(new Set())

  const loadCollectionParts = useCallback(async (cid: number) => {
    setPartsLoading((prev) => new Set(prev).add(cid))
    try {
      const u = new URL('/api/admin/gap-analysis/collection-parts', window.location.origin)
      u.searchParams.set('ids', String(cid))
      const res = await fetch(u.toString(), { credentials: 'include' })
      if (res.ok) {
        const d = (await res.json()) as { collections?: Record<string, GapCollectionPartsPayload> }
        const p = d.collections?.[String(cid)]
        if (p) {
          setCollectionPartsById((prev) => ({ ...prev, [cid]: p }))
        }
      }
    } catch {
      /* the panel falls back to the missing films alone */
    } finally {
      setPartsLoading((prev) => {
        const n = new Set(prev)
        n.delete(cid)
        return n
      })
    }
  }, [])

  const toggleExpand = (cid: number) => {
    const willExpand = !expandedCollections.has(cid)
    setExpandedCollections((prev) => {
      const n = new Set(prev)
      if (n.has(cid)) n.delete(cid)
      else n.add(cid)
      return n
    })
    if (willExpand && !collectionPartsById[cid] && !partsLoading.has(cid)) {
      void loadCollectionParts(cid)
    }
  }

  const openDetailModal = useCallback(
    (part: Pick<GapCollectionPart, 'tmdbId' | 'title' | 'inLibrary' | 'seerrStatus'>) => {
      setDetailPart(part)
      setDetailOpen(true)
      setDetailLoading(true)
      setDetailError(null)
      setDetailData(null)
      void fetch(`/api/discover/tmdb/movie/${part.tmdbId}`, { credentials: 'include' })
        .then(async (r) => {
          if (!r.ok) {
            const j = (await r.json().catch(() => ({}))) as { error?: string }
            throw new Error(j.error || t('admin.gaps.errorLoadDetails'))
          }
          return r.json() as Promise<TmdbExternalDetailPayload>
        })
        .then((payload) => setDetailData(payload))
        .catch((e: unknown) =>
          setDetailError(e instanceof Error ? e.message : t('admin.gaps.errorLoadDetails'))
        )
        .finally(() => setDetailLoading(false))
    },
    [t]
  )

  const closeDetailModal = useCallback(() => {
    setDetailOpen(false)
    setDetailError(null)
    setDetailData(null)
    setDetailPart(null)
  }, [])

  /**
   * A film the library holds opens its own page — ratings, who watched it, the
   * play button — rather than TMDb's card for a film we lack. The TMDb card is
   * kept for everything else, including an owned film whose library row has
   * gone since the scan.
   */
  const openPart = (part: DisplayPart) => {
    if (part.libraryId) {
      if (openMediaDetail) openMediaDetail('movie', part.libraryId)
      else navigate(`/movies/${part.libraryId}`)
      return
    }
    openDetailModal(part)
  }

  const openSeerrOptionsStep = useCallback(
    (items: GapRequestItem[], titleOverride?: string) => {
      if (!seerrOk || items.length === 0) return
      setOptionsDialogTitle(
        titleOverride ?? (items.length === 1 ? items[0].title : t('admin.gaps.moviesCount', { count: items.length }))
      )
      setItemsPendingSeerrOptions(items)
      setRequestOptionsOpen(true)
    },
    [seerrOk, t]
  )

  const executeGapRequest = useCallback(
    async (items: GapRequestItem[], seerrOptions: SeerrRequestOptions) => {
      setRequesting(true)
      const failures: { tmdbId: number; title: string; message: string }[] = []
      try {
        for (let i = 0; i < items.length; i += REQUEST_BATCH_SIZE) {
          const batch = items.slice(i, i + REQUEST_BATCH_SIZE)
          const res = await fetch('/api/admin/gap-analysis/request', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: batch,
              ...(Object.keys(seerrOptions).length > 0 ? { seerrOptions } : {}),
            }),
          })
          const data = await res.json().catch(() => ({}))
          // `message` first: for an unlinked Seerr account it is the sentence
          // that says what to do, where `error` is only the label.
          if (!res.ok) throw new Error(data.message || data.error || t('admin.gaps.errorRequestFailed'))
          const errs = (data.errors || []) as { tmdbId: number; title: string; message: string }[]
          failures.push(...errs)
          const errored = new Set(errs.map((e) => e.tmdbId))
          setLocallyRequested((prev) => {
            const next = new Set(prev)
            for (const it of batch) {
              if (!errored.has(it.tmdbId)) next.add(it.tmdbId)
            }
            return next
          })
        }
        setError(
          failures.length > 0
            ? failures
                .slice(0, 3)
                .map((e) => `${e.title || e.tmdbId}: ${e.message}`)
                .join(' · ')
            : null
        )
        setSelected(new Set())
      } catch (e) {
        setError(e instanceof Error ? e.message : t('admin.gaps.errorRequestFailed'))
      } finally {
        setConfirmOpen(false)
        setRequesting(false)
        setPendingBulkAfterOptions(null)
        const displayed = await loadLatest()
        if (displayed) await loadResults(displayed)
      }
    },
    [loadLatest, loadResults, t]
  )

  const handleSeerrOptionsConfirm = (opts: SeerrRequestOptions) => {
    const items = itemsPendingSeerrOptions
    setRequestOptionsOpen(false)
    setItemsPendingSeerrOptions(null)
    if (!items?.length) return
    if (items.length > BULK_CONFIRM_THRESHOLD) {
      setPendingBulkAfterOptions({ items, seerrOptions: opts })
      setConfirmOpen(true)
    } else {
      void executeGapRequest(items, opts)
    }
  }

  const handleSeerrOptionsDialogClose = () => {
    if (!requesting) {
      setRequestOptionsOpen(false)
      setItemsPendingSeerrOptions(null)
    }
  }

  const runRefresh = async () => {
    setRefreshing(true)
    setError(null)
    setJobProgress(null)
    try {
      const res = await fetch('/api/admin/gap-analysis/refresh', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || t('admin.gaps.errorRefreshFailed'))
      const jobId = data.jobId as string
      const startedAt = Date.now()
      let lastListRefresh = 0
      let busy = false
      stopPolling()
      pollRef.current = setInterval(async () => {
        // A slow tick must not overlap the next one.
        if (busy) return
        busy = true
        try {
          let status: string | undefined
          const jr = await fetch(`/api/jobs/progress/${jobId}`, { credentials: 'include' })
          if (jr.ok) {
            const j = await jr.json()
            status = j.status
            setJobProgress({
              overallProgress: typeof j.overallProgress === 'number' ? j.overallProgress : 0,
              currentStep: j.currentStep ?? '',
              itemsProcessed: typeof j.itemsProcessed === 'number' ? j.itemsProcessed : 0,
              itemsTotal: typeof j.itemsTotal === 'number' ? j.itemsTotal : 0,
              currentItem: j.currentItem,
            })
          }
          const terminal = status === 'completed' || status === 'failed' || status === 'cancelled'
          if (terminal || Date.now() - startedAt > POLL_TIMEOUT_MS) {
            stopPolling()
            setRefreshing(false)
            setJobProgress(null)
            if (status === 'failed') setError(t('admin.gaps.errorRefreshFailed'))
            const displayed = await loadLatest()
            if (displayed) await loadResults(displayed)
            return
          }
          if (Date.now() - lastListRefresh >= LIVE_LIST_REFRESH_MS) {
            lastListRefresh = Date.now()
            const displayed = await loadLatest()
            if (displayed) await loadResults(displayed)
          }
        } catch {
          stopPolling()
          setRefreshing(false)
          setJobProgress(null)
        } finally {
          busy = false
        }
      }, PROGRESS_POLL_MS)
    } catch (e) {
      stopPolling()
      setError(e instanceof Error ? e.message : t('admin.gaps.errorRefreshFailed'))
      setRefreshing(false)
      setJobProgress(null)
    }
  }

  const buildItemsFromSelection = (): GapRequestItem[] => {
    const byId = new Map<number, GapRequestItem>()
    for (const r of rows) {
      if (selected.has(r.tmdbId) && !byId.has(r.tmdbId)) {
        byId.set(r.tmdbId, { tmdbId: r.tmdbId, mediaType: 'movie', title: r.title })
      }
    }
    return [...byId.values()]
  }

  const onToolbarRequest = () => {
    const items = buildItemsFromSelection()
    if (items.length === 0) return
    openSeerrOptionsStep(
      items,
      items.length === 1 ? items[0].title : t('admin.gaps.selectedTitles', { count: items.length })
    )
  }

  const closeConfirm = () => {
    if (!requesting) {
      setConfirmOpen(false)
      setPendingBulkAfterOptions(null)
    }
  }

  const snapshotRun = activeRun ?? run
  const coveragePct =
    snapshotRun && snapshotRun.totalParts > 0
      ? Math.round((snapshotRun.ownedParts / snapshotRun.totalParts) * 100)
      : 0

  const bulkPreConfirmCount = pendingBulkAfterOptions?.items.length ?? 0

  const describeRun = (r: GapRun): string => {
    const when = new Date(r.completedAt || r.startedAt)
    const { value, unit } = relativeTimeParts(when, new Date())
    return t('admin.gaps.scannedAt', {
      when: when.toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
      relative: new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }).format(value, unit),
    })
  }

  const partsFor = (listing: GapCollectionListing<GapRow>): DisplayPart[] | null => {
    const detail = collectionPartsById[listing.collectionId]
    if (!detail) return null
    return [...detail.parts].sort(compareByRelease).map((p) => {
      let variant: PartVariant
      if (p.inLibrary) variant = 'owned'
      else if (p.seerrStatus !== 'none') variant = 'seerr'
      else if (openGapIds.has(p.tmdbId) && !locallyRequested.has(p.tmdbId)) variant = 'missing'
      else variant = 'requested'
      return { ...p, variant }
    })
  }

  const renderPart = (part: DisplayPart) => {
    const { variant } = part
    return (
      <Box key={part.tmdbId} sx={{ opacity: variant === 'missing' ? 1 : 0.55, transition: 'opacity 0.2s', '&:hover': { opacity: 1 } }}>
        <MoviePoster
          title={part.title}
          year={part.releaseYear}
          posterUrl={part.posterPath ? `${TMDB_IMG}${part.posterPath}` : null}
          responsive
          titleLines={2}
          hideRating
          hideUserRating
          hideWatchingToggle
          hideExploreButton
          onClick={() => openPart(part)}
        >
          {variant === 'owned' && (
            <PartStatusChip icon={<CheckCircleIcon />} label={t('admin.gaps.inLibrary')} color={theme.palette.success.main} />
          )}
          {variant === 'seerr' && (
            <PartStatusChip
              icon={<HourglassEmptyIcon />}
              label={seerrChipLabel(part.seerrStatus, t)}
              color={theme.palette.info.main}
            />
          )}
          {variant === 'requested' && (
            <PartStatusChip icon={<HourglassEmptyIcon />} label={t('admin.gaps.requested')} color={theme.palette.secondary.main} />
          )}
          {variant === 'missing' && (
            <>
              <Checkbox
                size="small"
                checked={selected.has(part.tmdbId)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleIds([part.tmdbId])}
                inputProps={{ 'aria-label': t('admin.gaps.selectAria', { title: part.title }) }}
                sx={{
                  position: 'absolute',
                  top: 4,
                  left: 4,
                  zIndex: 5,
                  bgcolor: alpha(theme.palette.common.black, 0.5),
                  borderRadius: 1,
                  p: 0.25,
                  color: 'common.white',
                  '&.Mui-checked': { color: 'primary.main' },
                  '&:hover': { bgcolor: alpha(theme.palette.common.black, 0.7) },
                }}
              />
              {seerrOk && (
                <Button
                  size="small"
                  variant="contained"
                  sx={{
                    position: 'absolute',
                    bottom: 8,
                    right: 8,
                    zIndex: 5,
                    minWidth: 0,
                    py: 0.25,
                    px: 1,
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    textTransform: 'none',
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    openSeerrOptionsStep([{ tmdbId: part.tmdbId, mediaType: 'movie', title: part.title }])
                  }}
                >
                  {t('admin.gaps.request')}
                </Button>
              )}
            </>
          )}
        </MoviePoster>
      </Box>
    )
  }

  const renderExpanded = (listing: GapCollectionListing<GapRow>) => {
    const parts = partsFor(listing)
    const stillLoading = parts == null && partsLoading.has(listing.collectionId)
    // Without the full part list (it failed, or a scan is still running) the
    // missing films alone are still worth showing.
    const display: DisplayPart[] =
      parts ??
      listing.missing.map((m) => ({
        tmdbId: m.tmdbId,
        title: m.title,
        releaseYear: m.releaseYear,
        releaseDate: m.releaseDate ?? null,
        posterPath: m.posterPath,
        inLibrary: false,
        seerrStatus: 'none',
        libraryId: null,
        variant: locallyRequested.has(m.tmdbId) ? 'requested' : 'missing',
      }))

    return (
      <Box sx={{ px: 2, pb: 2, borderTop: 1, borderColor: 'divider' }}>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            py: 1.25,
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {stillLoading ? '' : parts ? t('admin.gaps.releaseOrder') : t('admin.gaps.missingOnly')}
          </Typography>
          <Button
            size="small"
            component={RouterLink}
            to={`/franchises/${listing.collectionId}`}
            endIcon={<ArrowForwardIcon />}
          >
            {t('admin.gaps.openFranchise')}
          </Button>
        </Box>
        {stillLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <Box sx={PARTS_GRID}>{display.map(renderPart)}</Box>
        )}
      </Box>
    )
  }

  const tmdbMissing = prereq != null && !prereq.tmdbConfigured
  const collectionsMissing = prereq != null && prereq.moviesWithCollectionCount === 0
  const allReady = prereq != null && !tmdbMissing && !collectionsMissing && seerrOk
  const uniqueMissingFilms = openGapIds.size

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto', p: { xs: 2, md: 3 }, pb: 10 }}>
      <PageHeading
        title={t('admin.gaps.pageTitle')}
        description={t('admin.gaps.pageSubtitle')}
        icon={<FactCheckIcon color="primary" />}
        sx={{ mb: 3 }}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <>
          <Skeleton variant="rounded" height={170} sx={{ mb: 3 }} />
          <ListSkeleton />
        </>
      ) : (
        <>
          {/* Only what is wrong gets a banner; when everything is set up, one caption says so. */}
          {tmdbMissing && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              action={
                <Button color="inherit" size="small" component={RouterLink} to={adminPathFor('tmdb')}>
                  {t('admin.gaps.openTmdbSettings')}
                </Button>
              }
            >
              {t('admin.gaps.tmdbMissing')}
            </Alert>
          )}
          {collectionsMissing && (
            <Alert
              severity="warning"
              sx={{ mb: 2 }}
              action={
                <Button color="inherit" size="small" component={RouterLink} to={jobConsoleLink('enrich-metadata')}>
                  {t('admin.gaps.openEnrichJob')}
                </Button>
              }
            >
              {t('admin.gaps.collectionsMissing')}
            </Alert>
          )}
          {!seerrOk && (
            <Alert
              severity="info"
              sx={{ mb: 2 }}
              action={
                <Button color="inherit" size="small" component={RouterLink} to={adminPathFor('seerr')}>
                  {t('admin.gaps.openSeerrSettings')}
                </Button>
              }
            >
              {t('admin.gaps.seerrMissing')}
            </Alert>
          )}

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3 }}>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 2,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography fontWeight={600}>{t('admin.gaps.analysisSnapshot')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {activeRun ? t('admin.gaps.scanInProgress') : run ? describeRun(run) : t('admin.gaps.noRunYet')}
                </Typography>
              </Box>
              <Button
                variant="contained"
                onClick={() => void runRefresh()}
                disabled={refreshing || activeRun != null || tmdbMissing}
                startIcon={refreshing ? <CircularProgress size={16} color="inherit" /> : undefined}
              >
                {t('admin.gaps.runAnalysis')}
              </Button>
            </Box>

            {moviesAddedSinceRun != null && moviesAddedSinceRun > 0 && !activeRun && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                {t('admin.gaps.staleMovies', { count: moviesAddedSinceRun, movies: formatNumber(moviesAddedSinceRun) })}
              </Alert>
            )}

            {snapshotRun && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
                  gap: 1.5,
                  mt: 2,
                }}
              >
                <SnapshotStat
                  value={listReady ? formatNumber(listings.length) : '–'}
                  label={t('admin.gaps.statCollections')}
                  detail={t('admin.gaps.statCollectionsDetail', { scanned: formatNumber(snapshotRun.collectionsScanned) })}
                />
                <SnapshotStat
                  value={listReady ? formatNumber(uniqueMissingFilms) : '–'}
                  label={t('admin.gaps.statMissing')}
                  detail={t('admin.gaps.statMissingDetail')}
                />
                <SnapshotStat
                  value={`${coveragePct}%`}
                  label={t('admin.gaps.statCoverage')}
                  detail={t('admin.gaps.statCoverageDetail', {
                    owned: formatNumber(snapshotRun.ownedParts),
                    total: formatNumber(snapshotRun.totalParts),
                  })}
                />
              </Box>
            )}

            {refreshing && (
              <Box sx={{ mt: 2 }}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 1, mb: 0.75 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {jobProgress?.currentStep || t('admin.gaps.startingGapAnalysis')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {jobProgress && jobProgress.itemsTotal > 0
                      ? t('admin.gaps.progressCollections', {
                          processed: jobProgress.itemsProcessed,
                          total: jobProgress.itemsTotal,
                        })
                      : jobProgress?.currentItem || t('admin.gaps.scanningCollections')}
                  </Typography>
                </Box>
                <LinearProgress
                  variant={jobProgress && jobProgress.overallProgress > 0 ? 'determinate' : 'indeterminate'}
                  value={jobProgress ? Math.min(100, jobProgress.overallProgress) : 0}
                />
              </Box>
            )}

            {allReady && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
                {t('admin.gaps.readyLine', {
                  count: prereq.moviesWithCollectionCount,
                  movies: formatNumber(prereq.moviesWithCollectionCount),
                })}
              </Typography>
            )}
          </Paper>

          {displayRunId && (
            <>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', mb: 2 }}>
                <TextField
                  size="small"
                  placeholder={t('admin.gaps.searchLabel')}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setVisibleCount(PAGE_SIZE)
                  }}
                  sx={{ flex: '1 1 16rem', maxWidth: { sm: 360 } }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                  inputProps={{ 'aria-label': t('admin.gaps.searchLabel') }}
                />
                <FormControl size="small" sx={{ minWidth: 190 }}>
                  <InputLabel id="gap-sort-by">{t('admin.gaps.sortBy')}</InputLabel>
                  <Select
                    labelId="gap-sort-by"
                    label={t('admin.gaps.sortBy')}
                    value={sortBy}
                    onChange={(e) => {
                      setSortBy(e.target.value as GapSort)
                      setVisibleCount(PAGE_SIZE)
                    }}
                  >
                    <MenuItem value="closest">{t('admin.gaps.sortClosest')}</MenuItem>
                    <MenuItem value="mostMissing">{t('admin.gaps.sortMostMissing')}</MenuItem>
                    <MenuItem value="name">{t('admin.gaps.sortName')}</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="gap-missing-filter">{t('admin.gaps.missingFilter')}</InputLabel>
                  <Select
                    labelId="gap-missing-filter"
                    label={t('admin.gaps.missingFilter')}
                    value={missingFilter}
                    onChange={(e) => {
                      setMissingFilter(e.target.value as GapMissingFilter)
                      setVisibleCount(PAGE_SIZE)
                    }}
                  >
                    <MenuItem value="any">{t('admin.gaps.missingAny')}</MenuItem>
                    <MenuItem value="one">{t('admin.gaps.missingOne')}</MenuItem>
                    <MenuItem value="few">{t('admin.gaps.missingFew')}</MenuItem>
                    <MenuItem value="many">{t('admin.gaps.missingMany')}</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <RequestSeerrOptionsDialog
                open={requestOptionsOpen}
                mediaType="movie"
                title={optionsDialogTitle || t('admin.gaps.requestOptionsDefault')}
                onClose={handleSeerrOptionsDialogClose}
                onConfirm={handleSeerrOptionsConfirm}
              />

              {!listReady ? (
                <ListSkeleton />
              ) : listings.length === 0 ? (
                <Alert severity="success">{t('admin.gaps.noGaps')}</Alert>
              ) : filtered.length === 0 ? (
                <Alert severity="info">{t('admin.gaps.noMatches')}</Alert>
              ) : (
                <>
                  {/* Same horizontal inset as a row, so this checkbox sits over theirs. */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, mb: 1 }}>
                    <Checkbox
                      size="small"
                      checked={shownRequestableIds.length > 0 && shownSelected === shownRequestableIds.length}
                      indeterminate={shownSelected > 0 && shownSelected < shownRequestableIds.length}
                      disabled={shownRequestableIds.length === 0}
                      onChange={() => toggleIds(shownRequestableIds)}
                      inputProps={{ 'aria-label': t('admin.gaps.selectShownAria') }}
                      sx={{ p: 0.5 }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      {t('admin.gaps.showingCollections', {
                        count: filtered.length,
                        shown: formatNumber(shown.length),
                        total: formatNumber(filtered.length),
                      })}
                      {' · '}
                      {t('admin.gaps.missingInView', {
                        count: filteredMissingCount,
                        films: formatNumber(filteredMissingCount),
                      })}
                    </Typography>
                  </Box>

                  <Stack spacing={1}>
                    {shown.map((listing) => {
                      const ids = requestableIds(listing)
                      const expanded = expandedCollections.has(listing.collectionId)
                      return (
                        <GapCollectionRow
                          key={listing.collectionId}
                          listing={listing}
                          expanded={expanded}
                          onToggleExpand={() => toggleExpand(listing.collectionId)}
                          requestableCount={ids.length}
                          selectedCount={ids.filter((id) => selected.has(id)).length}
                          onToggleSelect={() => toggleIds(ids)}
                          canRequest={seerrOk}
                          onRequestAll={() =>
                            openSeerrOptionsStep(
                              listing.missing
                                .filter((m) => !locallyRequested.has(m.tmdbId))
                                .map((m) => ({ tmdbId: m.tmdbId, mediaType: 'movie' as const, title: m.title })),
                              t('admin.gaps.requestAllMissing', { name: listing.name })
                            )
                          }
                          onOpenTitle={(m) =>
                            openDetailModal({ tmdbId: m.tmdbId, title: m.title, inLibrary: false, seerrStatus: 'none' })
                          }
                        >
                          {expanded ? renderExpanded(listing) : null}
                        </GapCollectionRow>
                      )
                    })}
                  </Stack>

                  {shown.length < filtered.length && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                      <Button variant="outlined" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                        {t('admin.gaps.showMore', { count: Math.min(PAGE_SIZE, filtered.length - shown.length) })}
                      </Button>
                    </Box>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      <TmdbExternalDetailModal
        open={detailOpen}
        onClose={closeDetailModal}
        loading={detailLoading}
        error={detailError}
        data={detailData}
        sourceLabel={t('admin.gaps.sourceLabel')}
        canRequest={
          seerrOk && !!detailPart && openGapIds.has(detailPart.tmdbId) && !locallyRequested.has(detailPart.tmdbId)
        }
        seerrAvailable={detailPart?.inLibrary || detailPart?.seerrStatus === 'available'}
        seerrPending={
          !!detailPart &&
          (detailPart.seerrStatus === 'requested' ||
            detailPart.seerrStatus === 'processing' ||
            locallyRequested.has(detailPart.tmdbId) ||
            (!detailPart.inLibrary && detailPart.seerrStatus === 'none' && !openGapIds.has(detailPart.tmdbId)))
        }
        onRequest={
          detailPart
            ? () => {
                closeDetailModal()
                openSeerrOptionsStep([{ tmdbId: detailPart.tmdbId, mediaType: 'movie', title: detailPart.title }])
              }
            : undefined
        }
      />

      {selected.size > 0 && (
        <AppBar
          position="fixed"
          color="default"
          sx={{ top: 'auto', bottom: 0, borderTop: 1, borderColor: 'divider' }}
        >
          <Toolbar sx={{ justifyContent: 'space-between', gap: 2 }}>
            <Typography variant="body2">{t('admin.gaps.selectedCount', { count: selected.size })}</Typography>
            <Stack direction="row" spacing={1}>
              <Button onClick={clearSel}>{t('common.clear')}</Button>
              <Button variant="contained" disabled={!seerrOk || requesting} onClick={onToolbarRequest}>
                {t('admin.gaps.requestSelectedSeerr')}
              </Button>
            </Stack>
          </Toolbar>
        </AppBar>
      )}

      <Dialog open={confirmOpen} onClose={closeConfirm} maxWidth="sm" fullWidth>
        <DialogTitle>{t('admin.gaps.dialogRequestTitle')}</DialogTitle>
        <DialogContent>
          {pendingBulkAfterOptions ? (
            <>
              <Typography variant="body2" color="text.secondary" mb={2}>
                {t('admin.gaps.dialogBulkBody', { count: bulkPreConfirmCount })}
              </Typography>
              {requesting && <CircularProgress size={24} />}
            </>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeConfirm} disabled={requesting}>
            {t('common.cancel')}
          </Button>
          {pendingBulkAfterOptions && (
            <Button
              variant="contained"
              disabled={requesting || !seerrOk || bulkPreConfirmCount === 0}
              onClick={() => {
                const b = pendingBulkAfterOptions
                if (!b) return
                void executeGapRequest(b.items, b.seerrOptions)
              }}
            >
              {t('common.confirm')}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  )
}
