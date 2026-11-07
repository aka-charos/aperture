import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  AppBar,
  Autocomplete,
  Box,
  Button,
  Checkbox,
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
import SearchIcon from '@mui/icons-material/Search'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import PieChartOutlineIcon from '@mui/icons-material/PieChartOutline'
import { MoviePoster } from '@aperture/ui'
import { RequestSeerrOptionsDialog } from '../../../components/RequestSeerrOptionsDialog'
import type { SeerrRequestOptions } from '../../../types/seerrRequest'
import { useOpenMedia } from '@/hooks/useOpenMedia'
import { adminPathFor } from '../nav/registry'
import { GapSeriesRow } from './GapSeriesRow'
import { describeScanFailure, type FailedScan } from './scanFailure'
import { PosterStatusChip, SnapshotStat } from './shared'
import { matchesMissingFilter, relativeTimeParts, type GapMissingFilter, type GapSort } from './listing'
import {
  buildSeriesRequestItems,
  gapCount,
  matchesKind,
  matchesNetworks,
  networkOptions,
  NO_NETWORK,
  requestableSeasons,
  seasonKey,
  showMatchesSearch,
  sortSeriesGaps,
  type SeriesGapKind,
  type SeriesGapSeason,
  type SeriesGapShow,
  type SeriesRequestItem,
} from './seriesListing'

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500'
const BULK_CONFIRM_THRESHOLD = 5
const REQUEST_BATCH_SIZE = 200
const PAGE_SIZE = 50
const RESULTS_PAGE_SIZE = 500
const MAX_RESULT_PAGES = 40
const SCAN_POLL_MS = 3000
/** How often a running scan refetches the list, which is far heavier than its progress. */
const LIVE_LIST_REFRESH_MS = 15_000

const SEASONS_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
  gap: 2,
} as const

interface SeriesGapRun extends FailedScan {
  id: string
  showsTotal: number
  showsScanned: number
  showsListed: number
  showsNumberingDiffers: number
  showsNotOnTmdb: number
  lookupsFailed: number
  showsWithoutTmdbId: number
  airedSeasons: number
  ownedSeasons: number
  startedAt: string
  completedAt: string | null
}

interface LatestResponse {
  prerequisites: { tmdbConfigured: boolean; showsWithTmdbId: number }
  scanning: boolean
  run: SeriesGapRun | null
  activeRun: SeriesGapRun | null
  failedRun: SeriesGapRun | null
  episodesAddedSinceRun: number | null
}

/**
 * The TV half of Gap Analysis. A scan is followed by reading its run row rather than a
 * job id, so a scan started from the jobs console or the schedule, or before this page
 * was opened, is followed the same way.
 */
export function SeriesGapPanel() {
  const { t, i18n } = useTranslation()
  const theme = useTheme()
  const openMedia = useOpenMedia()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [latest, setLatest] = useState<LatestResponse | null>(null)
  const [shows, setShows] = useState<SeriesGapShow[]>([])
  /** The run whose gaps `shows` holds; until it matches the displayed run, the list is still loading. */
  const [loadedRunId, setLoadedRunId] = useState<string | null>(null)
  const [listRefresh, setListRefresh] = useState(0)
  const latestLoad = useRef(0)
  const [seerrOk, setSeerrOk] = useState(false)
  const [starting, setStarting] = useState(false)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<SeriesGapKind>('missing')
  const [networks, setNetworks] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<GapSort>('closest')
  const [missingFilter, setMissingFilter] = useState<GapMissingFilter>('any')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [locallyRequested, setLocallyRequested] = useState<Set<string>>(new Set())
  const [requesting, setRequesting] = useState(false)
  const [optionsFor, setOptionsFor] = useState<{ items: SeriesRequestItem[]; title: string } | null>(null)
  const [confirm, setConfirm] = useState<{ items: SeriesRequestItem[]; options: SeerrRequestOptions } | null>(null)

  const formatNumber = useCallback((n: number) => n.toLocaleString(i18n.language), [i18n.language])

  const loadLatest = useCallback(async () => {
    // Does not clear `error`: this reload follows a request, whose failure must survive it.
    try {
      const res = await fetch('/api/admin/gap-analysis/series/latest', { credentials: 'include' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || t('admin.gaps.errorLoadGapAnalysis'))
      }
      setLatest((await res.json()) as LatestResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.gaps.errorFailedToLoad'))
    }
  }, [t])

  /** Only the newest load may write: a slower, older one would put back a shorter list. */
  const loadResults = useCallback(
    async (runId: string) => {
      const ticket = ++latestLoad.current
      try {
        const all: SeriesGapShow[] = []
        let page = 1
        let total = 0
        do {
          const u = new URL('/api/admin/gap-analysis/series/results', window.location.origin)
          u.searchParams.set('runId', runId)
          u.searchParams.set('page', String(page))
          u.searchParams.set('pageSize', String(RESULTS_PAGE_SIZE))
          const res = await fetch(u.toString(), { credentials: 'include' })
          if (ticket !== latestLoad.current) return
          if (!res.ok) throw new Error(t('admin.gaps.errorLoadGapAnalysis'))
          const data = await res.json()
          total = data.total ?? 0
          const chunk = (data.shows || []) as SeriesGapShow[]
          all.push(...chunk)
          if (chunk.length === 0) break
          page++
        } while (all.length < total && page <= MAX_RESULT_PAGES)
        if (ticket === latestLoad.current) setShows(all)
      } catch (e) {
        // Keep whatever was already listed rather than blanking it.
        if (ticket === latestLoad.current) {
          setError(e instanceof Error ? e.message : t('admin.gaps.errorLoadGapAnalysis'))
        }
      } finally {
        if (ticket === latestLoad.current) setLoadedRunId(runId)
      }
    },
    [t]
  )

  useEffect(() => {
    const loadSeerr = async () => {
      try {
        const res = await fetch('/api/seerr/config', { credentials: 'include' })
        const config = res.ok ? await res.json() : null
        setSeerrOk(!!(config?.configured && config.enabled && config.hasApiKey))
      } catch {
        setSeerrOk(false)
      }
    }
    void Promise.all([loadLatest(), loadSeerr()]).finally(() => setLoading(false))
  }, [loadLatest])

  const scanning = latest?.scanning === true
  useEffect(() => {
    if (!scanning) return
    const timer = setInterval(() => void loadLatest(), SCAN_POLL_MS)
    return () => clearInterval(timer)
  }, [scanning, loadLatest])

  // The last finished list stays up during a scan, so a half-read one can't hide it or
  // claim no gaps. Only a first scan, with nothing to keep showing, is listed as it goes.
  const hasFinishedRun = latest?.run != null
  const followsLiveRun = scanning && !hasFinishedRun
  useEffect(() => {
    if (!followsLiveRun) return
    const timer = setInterval(() => setListRefresh((n) => n + 1), LIVE_LIST_REFRESH_MS)
    return () => clearInterval(timer)
  }, [followsLiveRun])

  const displayRun = latest?.run ?? latest?.activeRun ?? null
  const displayRunId = displayRun?.id ?? null
  const displayRunFinishedAt = displayRun?.completedAt ?? null

  // `displayRunFinishedAt` and `listRefresh` only ask for a fresh copy of the list.
  useEffect(() => {
    if (displayRunId) {
      void loadResults(displayRunId)
    } else {
      latestLoad.current++
      setShows([])
      setLoadedRunId(null)
    }
  }, [displayRunId, displayRunFinishedAt, listRefresh, loadResults])

  const listReady = displayRunId != null && loadedRunId === displayRunId

  const runScan = async () => {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/gap-analysis/series/refresh', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || t('admin.gaps.errorRefreshFailed'))
      await loadLatest()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.gaps.errorRefreshFailed'))
    } finally {
      setStarting(false)
    }
  }

  const open = useMemo(
    () =>
      shows.map((show) => ({
        ...show,
        // A season requested from this page closes at once, without a full reload.
        seasons: show.seasons.map((s) =>
          s.requestable && locallyRequested.has(seasonKey(show.tmdbId, s.seasonNumber))
            ? { ...s, standing: 'requested' as const, requestable: false }
            : s
        ),
      })),
    [shows, locallyRequested]
  )

  const narrowedByAllButNetwork = useMemo(
    () =>
      open.filter(
        (s) =>
          matchesKind(s, kind) &&
          showMatchesSearch(s, search) &&
          (kind === 'numbering' || matchesMissingFilter(gapCount(s, kind), missingFilter))
      ),
    [open, kind, search, missingFilter]
  )

  const options = useMemo(() => networkOptions(narrowedByAllButNetwork, networks), [narrowedByAllButNetwork, networks])
  const optionCounts = useMemo(() => new Map(options.map((o) => [o.name, o.count])), [options])

  const filtered = useMemo(
    () => sortSeriesGaps(narrowedByAllButNetwork.filter((s) => matchesNetworks(s, networks)), sortBy, kind),
    [narrowedByAllButNetwork, networks, sortBy, kind]
  )
  const shown = filtered.slice(0, visibleCount)

  const totals = useMemo(() => {
    let missingShows = 0
    let missingSeasons = 0
    let partialSeasons = 0
    for (const s of shows) {
      if (s.missing > 0 || s.partial > 0) missingShows++
      missingSeasons += s.missing
      partialSeasons += s.partial
    }
    return { missingShows, missingSeasons, partialSeasons }
  }, [shows])

  const seasonsInView = filtered.reduce((sum, s) => sum + gapCount(s, kind), 0)

  const keysOf = useCallback(
    (show: SeriesGapShow) => requestableSeasons(show, kind).map((s) => seasonKey(show.tmdbId, s.seasonNumber)),
    [kind]
  )

  const toggleKeys = (keys: string[]) => {
    if (keys.length === 0) return
    const on = !keys.every((k) => selected.has(k))
    setSelected((prev) => {
      const next = new Set(prev)
      for (const k of keys) {
        if (on) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }

  const shownKeys = shown.flatMap(keysOf)
  const shownSelected = shownKeys.filter((k) => selected.has(k)).length

  const toggleExpand = (tmdbId: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(tmdbId)) next.delete(tmdbId)
      else next.add(tmdbId)
      return next
    })

  const askForOptions = (items: SeriesRequestItem[], title: string) => {
    if (seerrOk && items.length > 0) setOptionsFor({ items, title })
  }

  const describeItems = (items: SeriesRequestItem[]) =>
    items.length === 1
      ? t('admin.gaps.series.requestTitle', {
          count: items[0].seasons.length,
          name: items[0].title,
          seasons: items[0].seasons.join(', '),
        })
      : t('admin.gaps.selectedTitles', { count: items.length })

  const sendRequests = useCallback(
    async (items: SeriesRequestItem[], seerrOptions: SeerrRequestOptions) => {
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
          // `message` first: for an unlinked Seerr account it says what to do.
          if (!res.ok) throw new Error(data.message || data.error || t('admin.gaps.errorRequestFailed'))
          const errs = (data.errors || []) as { tmdbId: number; title: string; message: string }[]
          failures.push(...errs)
          const errored = new Set(errs.map((e) => e.tmdbId))
          setLocallyRequested((prev) => {
            const next = new Set(prev)
            for (const item of batch) {
              if (errored.has(item.tmdbId)) continue
              for (const n of item.seasons) next.add(seasonKey(item.tmdbId, n))
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
        setConfirm(null)
        setRequesting(false)
        // The server's counts and standings, with these requests applied.
        setListRefresh((n) => n + 1)
      }
    },
    [t]
  )

  const onOptionsConfirmed = (chosen: SeerrRequestOptions) => {
    const items = optionsFor?.items
    setOptionsFor(null)
    if (!items?.length) return
    if (items.length > BULK_CONFIRM_THRESHOLD) setConfirm({ items, options: chosen })
    else void sendRequests(items, chosen)
  }

  const describeRun = (r: SeriesGapRun): string => {
    const when = new Date(r.completedAt || r.startedAt)
    const { value, unit } = relativeTimeParts(when, new Date())
    return t('admin.gaps.scannedAt', {
      when: when.toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
      relative: new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }).format(value, unit),
    })
  }

  const renderSeason = (show: SeriesGapShow, season: SeriesGapSeason) => {
    const key = seasonKey(show.tmdbId, season.seasonNumber)
    const label = t('admin.gaps.series.seasonLabel', { number: season.seasonNumber })
    const poster = season.posterPath ?? show.posterPath
    const episodes = t('admin.gaps.series.episodesHeld', { held: season.heldEpisodes, aired: season.airedEpisodes })
    const actionable = season.standing === 'missing' || season.standing === 'partial'
    return (
      <Box key={key} sx={{ opacity: actionable ? 1 : 0.55, transition: 'opacity 0.2s', '&:hover': { opacity: 1 } }}>
        <MoviePoster
          title={label}
          year={season.airDate ? Number(season.airDate.slice(0, 4)) : null}
          posterUrl={poster ? `${TMDB_IMG}${poster}` : null}
          responsive
          titleLines={1}
          hideRating
          hideUserRating
          hideWatchingToggle
          hideExploreButton
          onClick={show.libraryId ? () => openMedia('series', show.libraryId as string) : undefined}
        >
          {season.standing === 'owned' && (
            <PosterStatusChip icon={<CheckCircleIcon />} label={t('admin.gaps.inLibrary')} color={theme.palette.success.main} />
          )}
          {season.standing === 'partial' && (
            <PosterStatusChip icon={<PieChartOutlineIcon />} label={episodes} color={theme.palette.warning.dark} />
          )}
          {season.standing === 'seerr' && (
            <PosterStatusChip
              icon={<HourglassEmptyIcon />}
              label={t('admin.gaps.series.inSeerrChip')}
              color={theme.palette.info.main}
            />
          )}
          {season.standing === 'requested' && (
            <PosterStatusChip icon={<HourglassEmptyIcon />} label={t('admin.gaps.requested')} color={theme.palette.secondary.main} />
          )}
          {season.standing === 'unclear' && (
            <PosterStatusChip icon={<HelpOutlineIcon />} label={episodes} color={theme.palette.warning.dark} />
          )}
          {season.requestable && (
            <>
              <Checkbox
                size="small"
                checked={selected.has(key)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleKeys([key])}
                inputProps={{ 'aria-label': t('admin.gaps.selectAria', { title: `${show.title}: ${label}` }) }}
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
                    bottom: season.standing === 'partial' ? 36 : 8,
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
                    const items: SeriesRequestItem[] = [
                      { tmdbId: show.tmdbId, mediaType: 'series', title: show.title, seasons: [season.seasonNumber] },
                    ]
                    askForOptions(items, describeItems(items))
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

  const renderExpanded = (show: SeriesGapShow) => (
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
          {show.numberingDiffers ? t('admin.gaps.series.numberingExplained') : t('admin.gaps.series.airedOrder')}
        </Typography>
        {show.libraryId && (
          <Button
            size="small"
            endIcon={<ArrowForwardIcon />}
            onClick={() => openMedia('series', show.libraryId as string)}
          >
            {t('admin.gaps.series.openShow')}
          </Button>
        )}
      </Box>
      <Box sx={SEASONS_GRID}>{show.seasons.map((s) => renderSeason(show, s))}</Box>
    </Box>
  )

  if (loading) {
    return (
      <>
        <Skeleton variant="rounded" height={170} sx={{ mb: 3 }} />
        <Stack spacing={1}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} variant="rounded" height={72} />
          ))}
        </Stack>
      </>
    )
  }

  const prereq = latest?.prerequisites
  const tmdbMissing = prereq != null && !prereq.tmdbConfigured
  const noShows = prereq != null && prereq.showsWithTmdbId === 0
  const activeRun = latest?.activeRun ?? null
  const scanTotal = activeRun?.showsTotal ?? 0
  const scanPct = activeRun && scanTotal > 0 ? (activeRun.showsScanned / scanTotal) * 100 : 0
  const coverage =
    displayRun && displayRun.airedSeasons > 0
      ? Math.round((displayRun.ownedSeasons / displayRun.airedSeasons) * 100)
      : 0
  const added = latest?.episodesAddedSinceRun ?? 0

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {latest?.failedRun && !scanning && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('admin.gaps.scanFailed', { detail: describeScanFailure(t, latest.failedRun) })}
        </Alert>
      )}
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
          {t('admin.gaps.series.tmdbMissing')}
        </Alert>
      )}
      {noShows && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('admin.gaps.series.noShows')}
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
          {t('admin.gaps.series.seerrMissing')}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3 }}>
        <Box
          sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography fontWeight={600}>{t('admin.gaps.analysisSnapshot')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {scanning
                ? t(hasFinishedRun ? 'admin.gaps.scanInProgressKeeping' : 'admin.gaps.series.scanInProgress')
                : latest?.run
                  ? describeRun(latest.run)
                  : t('admin.gaps.series.noRunYet')}
            </Typography>
          </Box>
          <Button
            variant="contained"
            onClick={() => void runScan()}
            disabled={starting || scanning || tmdbMissing || noShows}
            startIcon={starting || scanning ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {t('admin.gaps.runAnalysis')}
          </Button>
        </Box>

        {!scanning && added > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t('admin.gaps.series.staleEpisodes', { count: added, episodes: formatNumber(added) })}
          </Alert>
        )}

        {displayRun && (
          <Box
            sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: 1.5, mt: 2 }}
          >
            <SnapshotStat
              value={listReady ? formatNumber(totals.missingShows) : '–'}
              label={t('admin.gaps.series.statShows')}
              detail={t('admin.gaps.statCollectionsDetail', { scanned: formatNumber(displayRun.showsScanned) })}
            />
            <SnapshotStat
              value={listReady ? formatNumber(totals.missingSeasons) : '–'}
              label={t('admin.gaps.series.statMissing')}
              detail={t('admin.gaps.series.statMissingDetail')}
            />
            <SnapshotStat
              value={listReady ? formatNumber(totals.partialSeasons) : '–'}
              label={t('admin.gaps.series.statPartial')}
              detail={t('admin.gaps.series.statPartialDetail')}
            />
            <SnapshotStat
              value={`${coverage}%`}
              label={t('admin.gaps.series.statCoverage')}
              detail={t('admin.gaps.statCoverageDetail', {
                owned: formatNumber(displayRun.ownedSeasons),
                total: formatNumber(displayRun.airedSeasons),
              })}
            />
          </Box>
        )}

        {scanning && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
              {activeRun && scanTotal > 0
                ? t('admin.gaps.series.progressShows', {
                    processed: formatNumber(activeRun.showsScanned),
                    total: formatNumber(scanTotal),
                  })
                : t('admin.gaps.startingGapAnalysis')}
            </Typography>
            <LinearProgress variant={scanPct > 0 ? 'determinate' : 'indeterminate'} value={scanPct} />
          </Box>
        )}

        {displayRun &&
          (displayRun.lookupsFailed > 0 || displayRun.showsNotOnTmdb > 0 || displayRun.showsWithoutTmdbId > 0) && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
              {[
                displayRun.lookupsFailed > 0 &&
                  t('admin.gaps.series.lookupsFailed', {
                    count: displayRun.lookupsFailed,
                    shows: formatNumber(displayRun.lookupsFailed),
                  }),
                displayRun.showsNotOnTmdb > 0 &&
                  t('admin.gaps.series.notOnTmdb', {
                    count: displayRun.showsNotOnTmdb,
                    shows: formatNumber(displayRun.showsNotOnTmdb),
                  }),
                displayRun.showsWithoutTmdbId > 0 &&
                  t('admin.gaps.series.withoutTmdbId', {
                    count: displayRun.showsWithoutTmdbId,
                    shows: formatNumber(displayRun.showsWithoutTmdbId),
                  }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
          )}
      </Paper>

      {displayRunId && (
        <>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', mb: 2 }}>
            <TextField
              size="small"
              placeholder={t('admin.gaps.series.searchLabel')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setVisibleCount(PAGE_SIZE)
              }}
              sx={{ flex: '1 1 14rem', maxWidth: { sm: 300 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              inputProps={{ 'aria-label': t('admin.gaps.series.searchLabel') }}
            />
            <Autocomplete
              multiple
              size="small"
              limitTags={2}
              disableCloseOnSelect
              options={options.map((o) => o.name)}
              value={networks}
              onChange={(_e, value) => {
                setNetworks(value)
                setVisibleCount(PAGE_SIZE)
              }}
              getOptionLabel={(name) => {
                const label = name === NO_NETWORK ? t('admin.gaps.series.noNetwork') : name
                return `${label} (${formatNumber(optionCounts.get(name) ?? 0)})`
              }}
              renderInput={(params) => <TextField {...params} label={t('admin.gaps.series.networkFilter')} />}
              noOptionsText={t('admin.gaps.series.noNetworks')}
              sx={{ flex: '1 1 16rem', maxWidth: { sm: 360 } }}
            />
            <FormControl size="small" sx={{ minWidth: 190 }}>
              <InputLabel id="series-gap-kind">{t('admin.gaps.series.kindFilter')}</InputLabel>
              <Select
                labelId="series-gap-kind"
                label={t('admin.gaps.series.kindFilter')}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as SeriesGapKind)
                  setVisibleCount(PAGE_SIZE)
                }}
              >
                <MenuItem value="missing">{t('admin.gaps.series.kindMissing')}</MenuItem>
                <MenuItem value="partial">{t('admin.gaps.series.kindPartial')}</MenuItem>
                <MenuItem value="both">{t('admin.gaps.series.kindBoth')}</MenuItem>
                <MenuItem value="numbering">
                  {t('admin.gaps.series.kindNumbering', { count: displayRun?.showsNumberingDiffers ?? 0 })}
                </MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel id="series-gap-sort">{t('admin.gaps.sortBy')}</InputLabel>
              <Select
                labelId="series-gap-sort"
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
            {kind !== 'numbering' && (
              <FormControl size="small" sx={{ minWidth: 130 }}>
                <InputLabel id="series-gap-count">{t('admin.gaps.missingFilter')}</InputLabel>
                <Select
                  labelId="series-gap-count"
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
            )}
          </Box>

          <RequestSeerrOptionsDialog
            open={optionsFor != null}
            mediaType="series"
            title={optionsFor?.title || t('admin.gaps.requestOptionsDefault')}
            onClose={() => {
              if (!requesting) setOptionsFor(null)
            }}
            onConfirm={onOptionsConfirmed}
          />

          {!listReady ? (
            <Stack spacing={1}>
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} variant="rounded" height={72} />
              ))}
            </Stack>
          ) : filtered.length === 0 ? (
            followsLiveRun ? (
              // A first scan listing nothing yet has not found the library complete.
              <Alert severity="info">{t('admin.gaps.series.scanInProgress')}</Alert>
            ) : totals.missingShows === 0 && !shows.some((s) => s.numberingDiffers) ? (
              <Alert severity="success">{t('admin.gaps.series.noGaps')}</Alert>
            ) : (
              <Alert severity="info">{t('admin.gaps.series.noMatches')}</Alert>
            )
          ) : (
            <>
              {/* Same horizontal inset as a row, so this checkbox sits over theirs. */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, mb: 1 }}>
                {kind !== 'numbering' && (
                  <Checkbox
                    size="small"
                    checked={shownKeys.length > 0 && shownSelected === shownKeys.length}
                    indeterminate={shownSelected > 0 && shownSelected < shownKeys.length}
                    disabled={shownKeys.length === 0}
                    onChange={() => toggleKeys(shownKeys)}
                    inputProps={{ 'aria-label': t('admin.gaps.series.selectShownAria') }}
                    sx={{ p: 0.5 }}
                  />
                )}
                <Typography variant="body2" color="text.secondary">
                  {t('admin.gaps.series.showingShows', {
                    count: filtered.length,
                    shown: formatNumber(shown.length),
                    total: formatNumber(filtered.length),
                  })}
                  {kind !== 'numbering' && (
                    <>
                      {' · '}
                      {t('admin.gaps.series.seasonsInView', {
                        count: seasonsInView,
                        seasons: formatNumber(seasonsInView),
                      })}
                    </>
                  )}
                </Typography>
              </Box>

              <Stack spacing={1}>
                {shown.map((show) => {
                  const keys = keysOf(show)
                  const isExpanded = expanded.has(show.tmdbId)
                  return (
                    <GapSeriesRow
                      key={show.tmdbId}
                      show={show}
                      expanded={isExpanded}
                      onToggleExpand={() => toggleExpand(show.tmdbId)}
                      requestableCount={keys.length}
                      selectedCount={keys.filter((k) => selected.has(k)).length}
                      onToggleSelect={() => toggleKeys(keys)}
                      canRequest={seerrOk}
                      onRequestAll={() => {
                        const items = buildSeriesRequestItems([show], new Set(keys))
                        askForOptions(items, describeItems(items))
                      }}
                    >
                      {isExpanded ? renderExpanded(show) : null}
                    </GapSeriesRow>
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

      {selected.size > 0 && (
        <AppBar position="fixed" color="default" sx={{ top: 'auto', bottom: 0, borderTop: 1, borderColor: 'divider' }}>
          <Toolbar sx={{ justifyContent: 'space-between', gap: 2 }}>
            <Typography variant="body2">{t('admin.gaps.selectedCount', { count: selected.size })}</Typography>
            <Stack direction="row" spacing={1}>
              <Button onClick={() => setSelected(new Set())}>{t('admin.common.clear')}</Button>
              <Button
                variant="contained"
                disabled={!seerrOk || requesting}
                onClick={() => {
                  const items = buildSeriesRequestItems(open, selected)
                  askForOptions(items, describeItems(items))
                }}
              >
                {t('admin.gaps.requestSelectedSeerr')}
              </Button>
            </Stack>
          </Toolbar>
        </AppBar>
      )}

      <Dialog open={confirm != null} onClose={() => !requesting && setConfirm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('admin.gaps.dialogRequestTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('admin.gaps.series.dialogBulkBody', { count: confirm?.items.length ?? 0 })}
          </Typography>
          {requesting && <CircularProgress size={24} />}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)} disabled={requesting}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            disabled={requesting || !seerrOk || !confirm}
            onClick={() => {
              if (confirm) void sendRequests(confirm.items, confirm.options)
            }}
          >
            {t('admin.common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
