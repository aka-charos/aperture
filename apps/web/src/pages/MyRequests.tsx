import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useLocation, useSearchParams } from 'react-router-dom'
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  Alert,
  Button,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  Divider,
  TablePagination,
  Snackbar,
  FormControlLabel,
  Switch,
  Tabs,
  Tab,
  TableSortLabel,
} from '@mui/material'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import {
  TmdbExternalDetailModal,
  type TmdbExternalDetailPayload,
} from '../components/TmdbExternalDetailModal'
import {
  ContentSearchPanel,
  type ContentSearchItem,
} from '../components/ContentSearchPanel'
import { MyIssuesPanel } from '../components/MyIssuesPanel'
import { MediaDetailModalProvider } from '../hooks/MediaDetailModalProvider'
import { useMediaDetailModal } from '../hooks/useMediaDetailModal'
import { PageHeading } from '@/components/PageHeading'
import { useAuth } from '@/hooks/useAuth'
import { useIsPhone } from '@/hooks/useIsPhone'

type SeerrLive = {
  status: 'pending' | 'approved' | 'declined' | 'completed'
  mediaStatus: 'unknown' | 'pending' | 'processing' | 'partially_available' | 'available'
} | null

interface DiscoveryRequestRow {
  id: string
  userId: string
  mediaType: 'movie' | 'series'
  tmdbId: number
  title: string
  seerrRequestId: number | null
  seerrMediaId: number | null
  status: string
  statusMessage: string | null
  discoveryCandidateId: string | null
  source?: 'discovery' | 'gap_analysis'
  /** Series only: the seasons asked for. Null or absent = the whole show. */
  seasons?: number[] | null
  /** Decided by the API: pending because Seerr never said whether it made the request. */
  awaitingSeerr?: boolean
  /** Decided by the API. Absent from an older server: the stored status is shown as is. */
  statusKey?: RequestStatusKey | null
  createdAt: string
  updatedAt: string
  seerrLive: SeerrLive
  libraryMediaId?: string | null
  /** Present only in the admin scope, where rows belong to other people. */
  requestedByUsername?: string | null
  requestedByDisplayName?: string | null
}

/** Decided by the API (routes/seerr/requestStatus.ts); the page only words and colours it. */
type RequestStatusKey =
  | 'inLibrary'
  | 'downloaded'
  | 'partiallyAvailable'
  | 'processing'
  | 'approved'
  | 'pendingApproval'
  | 'awaitingSeerr'
  | 'submitted'
  | 'pending'
  | 'declined'
  | 'failed'

type ChipColor = 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'

/** Colour and fill per status. Downloaded is the success colour unfilled: arrived, not yet playable here. */
function statusTone(key: RequestStatusKey | null | undefined): { color: ChipColor; variant: 'filled' | 'outlined' } {
  switch (key) {
    case 'inLibrary':
      return { color: 'success', variant: 'filled' }
    case 'downloaded':
      return { color: 'success', variant: 'outlined' }
    case 'partiallyAvailable':
    case 'processing':
    case 'approved':
      return { color: 'info', variant: 'filled' }
    case 'pendingApproval':
    case 'pending':
    case 'submitted':
    case 'awaitingSeerr':
      return { color: 'warning', variant: 'filled' }
    case 'declined':
    case 'failed':
      return { color: 'error', variant: 'filled' }
    default:
      return { color: 'default', variant: 'outlined' }
  }
}

/** The groups the API filters by (core discover/requestListing.ts). */
const STATUS_FILTERS = ['waiting', 'approved', 'downloaded', 'inLibrary', 'declined', 'failed'] as const
type StatusFilter = 'all' | (typeof STATUS_FILTERS)[number]

const SORTS = ['newest', 'oldest', 'titleAsc', 'titleDesc', 'recentChange'] as const
type RequestSort = (typeof SORTS)[number]

type SourceFilter = 'all' | 'discovery' | 'gap_analysis' | 'direct'

/** Label and tone for a request's origin, in one place so the chip and the filter agree. */
function sourceChip(source: string | undefined): { key: string; color: 'default' | 'secondary' | 'primary' } {
  if (source === 'gap_analysis') return { key: 'myRequests.sourceGapAnalysis', color: 'secondary' }
  if (source === 'direct') return { key: 'myRequests.sourceDirect', color: 'primary' }
  return { key: 'myRequests.sourceDiscovery', color: 'default' }
}

/** Whether an admin can still act on this row — Seerr has it and it is undecided. */
function isActionable(row: DiscoveryRequestRow): boolean {
  if (row.seerrRequestId == null) return false
  const key = row.statusKey
  return key === 'pendingApproval' || key === 'submitted' || key === 'pending'
}

/** The library holds the title, so the row opens it there. */
function opensInLibrary(row: DiscoveryRequestRow): boolean {
  return row.libraryMediaId != null && (row.statusKey === 'inLibrary' || row.statusKey === 'partiallyAvailable')
}

export function MyRequestsPage() {
  // Search results reach into two different detail views, and one of them is a
  // library page. Opening it in place keeps the query and its results, which is
  // the whole reason someone is on this page — routing away to a title they
  // already own would throw away the search they just typed.
  return (
    <MediaDetailModalProvider>
      <MyRequestsContent />
    </MediaDetailModalProvider>
  )
}

function MyRequestsContent() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const openMediaDetail = useMediaDetailModal()
  const isAdmin = user?.isAdmin ?? false
  const [rows, setRows] = useState<DiscoveryRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<RequestSort>('newest')
  const [allUsers, setAllUsers] = useState(false)
  // `?tab=issues` is where an issue notification opens, so it lands on the right list.
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const [tab, setTab] = useState<'requests' | 'issues'>(searchParams.get('tab') === 'issues' ? 'issues' : 'requests')
  /**
   * `?q=` is the search banner's hand-over: the request panel starts with that
   * text. Read once and taken out of the address, so a reload after the viewer
   * has searched for something else does not bring the old text back. Each
   * hand-over is keyed by the navigation that brought it, which remounts the
   * panel, and lands on the Requests tab even when this page was already open
   * on Issues (the same page instance stays mounted across that navigation).
   */
  const handoverQuery = searchParams.get('q')
  const [handover, setHandover] = useState<{ query: string; key: string } | null>(() => {
    const query = handoverQuery?.trim()
    return query ? { query, key: location.key } : null
  })
  useEffect(() => {
    if (handoverQuery == null) return
    const query = handoverQuery.trim()
    if (query) {
      setHandover((prev) => (prev?.key === location.key ? prev : { query, key: location.key }))
      setTab('requests')
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('q')
        return next
      },
      { replace: true }
    )
  }, [handoverQuery, location.key, setSearchParams])
  const [deciding, setDeciding] = useState<string | null>(null)
  const [snackbar, setSnackbar] = useState<{
    open: boolean
    message: string
    severity: 'success' | 'error'
  }>({ open: false, message: '', severity: 'success' })
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)
  const [total, setTotal] = useState(0)

  const [tmdbModalOpen, setTmdbModalOpen] = useState(false)
  const [tmdbModalLoading, setTmdbModalLoading] = useState(false)
  const [tmdbModalError, setTmdbModalError] = useState<string | null>(null)
  const [tmdbModalData, setTmdbModalData] = useState<TmdbExternalDetailPayload | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const u = new URL('/api/seerr/requests', window.location.origin)
      if (sourceFilter !== 'all') u.searchParams.set('source', sourceFilter)
      if (statusFilter !== 'all') u.searchParams.set('statusGroup', statusFilter)
      if (sort !== 'newest') u.searchParams.set('sort', sort)
      if (allUsers && isAdmin) u.searchParams.set('scope', 'all')
      u.searchParams.set('limit', String(rowsPerPage))
      u.searchParams.set('offset', String(page * rowsPerPage))
      const res = await fetch(u.toString(), { credentials: 'include' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || data.message || t('myRequests.errorLoad'))
      }
      const data = (await res.json()) as {
        requests?: DiscoveryRequestRow[]
        total?: number
      }
      const list = data.requests || []
      setRows(list)
      setTotal(typeof data.total === 'number' ? data.total : list.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('myRequests.errorLoad'))
    } finally {
      setLoading(false)
    }
  }, [sourceFilter, statusFilter, sort, allUsers, isAdmin, page, rowsPerPage, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (total === 0) return
    const maxPage = Math.max(0, Math.ceil(total / rowsPerPage) - 1)
    if (page > maxPage) setPage(maxPage)
  }, [total, rowsPerPage, page])

  const openTmdbModal = (r: { mediaType: 'movie' | 'series'; tmdbId: number }) => {
    setTmdbModalOpen(true)
    setTmdbModalLoading(true)
    setTmdbModalError(null)
    setTmdbModalData(null)
    const path = r.mediaType === 'movie' ? 'movie' : 'tv'
    void fetch(`/api/discover/tmdb/${path}/${r.tmdbId}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(j.error || t('myRequests.errorLoadDetails'))
        }
        return res.json() as Promise<TmdbExternalDetailPayload>
      })
      .then((payload) => setTmdbModalData(payload))
      .catch((e: unknown) => {
        setTmdbModalError(e instanceof Error ? e.message : t('myRequests.errorLoadDetails'))
      })
      .finally(() => setTmdbModalLoading(false))
  }

  const closeTmdbModal = () => {
    setTmdbModalOpen(false)
    setTmdbModalError(null)
    setTmdbModalData(null)
  }

  const formatRequestStatus = (row: DiscoveryRequestRow) => {
    const key = row.statusKey
    if (key) return t(`myRequests.requestStatus.${key}`)
    return t('myRequests.requestStatus.fallback', { status: row.status })
  }

  const filtersActive = sourceFilter !== 'all' || statusFilter !== 'all'

  /** A column header sorts by its own two orders; a second click turns it round. */
  const sortHeader = (label: string, asc: RequestSort, desc: RequestSort, firstClick: RequestSort) => (
    <TableSortLabel
      active={sort === asc || sort === desc}
      direction={sort === asc ? 'asc' : 'desc'}
      onClick={() => {
        setPage(0)
        setSort(sort === firstClick ? (firstClick === asc ? desc : asc) : firstClick)
      }}
    >
      {label}
    </TableSortLabel>
  )

  const decide = async (row: DiscoveryRequestRow, decision: 'approve' | 'decline') => {
    setDeciding(row.id)
    try {
      const res = await fetch(`/api/seerr/requests/${row.id}/${decision}`, {
        method: 'POST',
        credentials: 'include',
      })
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
      if (!res.ok) {
        // Seerr's own sentence where it sent one, so a refusal explains itself.
        throw new Error(body.message || body.error || t('myRequests.decisionFailed'))
      }
      setSnackbar({
        open: true,
        message: t(decision === 'approve' ? 'myRequests.approved' : 'myRequests.declined', {
          title: row.title,
        }),
        severity: 'success',
      })
      await load()
    } catch (e) {
      setSnackbar({
        open: true,
        message: e instanceof Error ? e.message : t('myRequests.decisionFailed'),
        severity: 'error',
      })
    } finally {
      setDeciding(null)
    }
  }

  const isPhone = useIsPhone()
  const showRequesterColumn = isAdmin && allUsers

  // Each cell's content is built once and placed twice: in a table row on a
  // wide screen, and in a stacked card on a phone, where seven fixed-width
  // columns pushed status and actions off screen and left the title its
  // minimum width.
  const requesterName = (r: DiscoveryRequestRow) =>
    r.requestedByDisplayName || r.requestedByUsername || t('myRequests.unknownUser')
  const seasonsLabel = (r: DiscoveryRequestRow) =>
    r.seasons?.length
      ? t('myRequests.seasons', { count: r.seasons.length, list: r.seasons.join(', ') })
      : null
  const typeChip = (r: DiscoveryRequestRow) => (
    <Chip
      size="small"
      label={r.mediaType === 'movie' ? t('myRequests.typeMovie') : t('myRequests.typeSeries')}
      variant="outlined"
    />
  )
  const sourceChipEl = (r: DiscoveryRequestRow) => (
    <Chip
      size="small"
      label={t(sourceChip(r.source).key)}
      variant="outlined"
      color={sourceChip(r.source).color}
    />
  )
  const requestedDate = (r: DiscoveryRequestRow) =>
    new Date(r.createdAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  const statusHint = (r: DiscoveryRequestRow) => {
    if (r.statusKey === 'downloaded') return t('myRequests.statusHint.downloaded')
    if (r.statusKey === 'inLibrary') return t('myRequests.statusHint.inLibrary')
    if (r.seerrLive) {
      return t('myRequests.tooltipLive', {
        reqStatus: r.seerrLive.status,
        mediaStatus: r.seerrLive.mediaStatus,
      })
    }
    return ''
  }
  const statusChip = (r: DiscoveryRequestRow) => {
    const tone = statusTone(r.statusKey)
    return (
      <Tooltip title={statusHint(r)}>
        <Chip size="small" label={formatRequestStatus(r)} color={tone.color} variant={tone.variant} />
      </Tooltip>
    )
  }
  const actions = (r: DiscoveryRequestRow) => (
    <>
      {isAdmin && isActionable(r) && (
        <>
          <Tooltip title={t('myRequests.approve')}>
            <span>
              <Button
                size="small"
                variant="outlined"
                color="success"
                disabled={deciding === r.id}
                onClick={() => void decide(r, 'approve')}
                startIcon={<CheckIcon />}
              >
                {t('myRequests.approve')}
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={t('myRequests.decline')}>
            <span>
              <Button
                size="small"
                variant="outlined"
                color="error"
                disabled={deciding === r.id}
                onClick={() => void decide(r, 'decline')}
                startIcon={<CloseIcon />}
              >
                {t('myRequests.decline')}
              </Button>
            </span>
          </Tooltip>
        </>
      )}
      {opensInLibrary(r) ? (
        <Button
          size="small"
          variant="outlined"
          component={RouterLink}
          to={r.mediaType === 'movie' ? `/movies/${r.libraryMediaId}` : `/series/${r.libraryMediaId}`}
        >
          {t('myRequests.openInLibrary')}
        </Button>
      ) : (
        <Button size="small" variant="outlined" onClick={() => openTmdbModal(r)}>
          {t('myRequests.details')}
        </Button>
      )}
    </>
  )

  return (
    // Layout already pads the page on a phone; a second 16px here left the
    // content 32px in from each edge.
    <Box sx={{ maxWidth: 1400, mx: 'auto', p: { xs: 0, md: 3 } }}>
      <PageHeading
        title={t('nav.myRequests')}
        description={t('myRequests.pageSubtitle')}
        icon={<PlaylistAddCheckIcon color="primary" />}
      />

      {/* The admin scope sits above the tabs because it applies to both
          lists, not to the requests table alone. */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tabs variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile value={tab} onChange={(_, next: 'requests' | 'issues') => setTab(next)}>
          <Tab value="requests" label={t('myRequests.tabRequests')} />
          <Tab value="issues" label={t('myRequests.tabIssues')} />
        </Tabs>
        {isAdmin && (
          <FormControlLabel
            sx={{ mr: 0 }}
            control={
              <Switch
                checked={allUsers}
                onChange={(e) => {
                  setPage(0)
                  setAllUsers(e.target.checked)
                }}
              />
            }
            label={t('myRequests.showAllUsers')}
          />
        )}
      </Stack>

      {/* Both panels are unmounted when inactive rather than hidden: each
          owns a fetch, and a hidden one would keep refetching on every
          filter change the other made. */}
      {tab === 'issues' && <MyIssuesPanel scope={isAdmin && allUsers ? 'all' : 'mine'} />}

      {tab === 'requests' && (
      <>
      <ContentSearchPanel
        // A new hand-over from the search banner starts the panel over with it.
        key={handover?.key ?? 'no-handover'}
        initialQuery={handover?.query}
        onShowDetails={(item: ContentSearchItem) => {
          if (item.mediaType === 'person') return

          // A title the library already holds gets the LIBRARY view, not the
          // TMDb one. Search results carry both identities -- `libraryMediaId`
          // is Aperture's own row, resolved server-side from our tables rather
          // than the search backend's (F-105) -- and the card is already greyed
          // out to say so, so opening a stranger's summary of a film sitting on
          // the server reads as a bug.
          //
          // The card wraps a library item in a real <Link> to that page, which
          // is what makes ctrl-click work; this intercepts the plain click so
          // the search survives.
          if (item.inLibrary && item.libraryMediaId) {
            openMediaDetail?.(item.mediaType, item.libraryMediaId)
            return
          }

          openTmdbModal({ mediaType: item.mediaType, tmdbId: item.tmdbId })
        }}
        onRequested={() => void load()}
        onNotify={(message, severity) => setSnackbar({ open: true, message, severity })}
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={3} alignItems={{ sm: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel id="req-source-filter">{t('myRequests.source')}</InputLabel>
          <Select
            labelId="req-source-filter"
            label={t('myRequests.source')}
            value={sourceFilter}
            onChange={(e) => {
              setPage(0)
              setSourceFilter(e.target.value as SourceFilter)
            }}
          >
            <MenuItem value="all">{t('myRequests.sourceAll')}</MenuItem>
            <MenuItem value="direct">{t('myRequests.sourceDirect')}</MenuItem>
            <MenuItem value="discovery">{t('myRequests.sourceDiscovery')}</MenuItem>
            <MenuItem value="gap_analysis">{t('myRequests.sourceGapAnalysis')}</MenuItem>
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 240 }}>
          <InputLabel id="req-status-filter">{t('myRequests.status')}</InputLabel>
          <Select
            labelId="req-status-filter"
            label={t('myRequests.status')}
            value={statusFilter}
            onChange={(e) => {
              setPage(0)
              setStatusFilter(e.target.value as StatusFilter)
            }}
          >
            <MenuItem value="all">{t('myRequests.statusAll')}</MenuItem>
            {STATUS_FILTERS.map((f) => (
              <MenuItem key={f} value={f}>
                {t(`myRequests.statusFilter.${f}`)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel id="req-sort">{t('myRequests.sortBy')}</InputLabel>
          <Select
            labelId="req-sort"
            label={t('myRequests.sortBy')}
            value={sort}
            onChange={(e) => {
              setPage(0)
              setSort(e.target.value as RequestSort)
            }}
          >
            {SORTS.map((option) => (
              <MenuItem key={option} value={option}>
                {t(`myRequests.sort.${option}`)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ borderRadius: 2 }}>
        {loading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : total === 0 ? (
          <Box py={6} px={2} textAlign="center">
            <Typography color="text.secondary">
              {filtersActive ? t('myRequests.emptyFiltered') : t('myRequests.empty')}
            </Typography>
          </Box>
        ) : isPhone ? (
          <Stack divider={<Divider flexItem />}>
            {rows.map((r) => (
              <Box key={r.id} sx={{ p: 2 }}>
                <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                  {r.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {[
                    seasonsLabel(r),
                    requestedDate(r),
                    showRequesterColumn ? requesterName(r) : null,
                    r.seerrRequestId != null
                      ? t('myRequests.seerrRequest', { id: r.seerrRequestId })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
                <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1} sx={{ mt: 1 }}>
                  {statusChip(r)}
                  {typeChip(r)}
                  {sourceChipEl(r)}
                </Stack>
                <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1} sx={{ mt: 1.5 }}>
                  {actions(r)}
                </Stack>
              </Box>
            ))}
          </Stack>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sortDirection={sort === 'titleAsc' ? 'asc' : sort === 'titleDesc' ? 'desc' : false}>
                    {sortHeader(t('myRequests.tableTitle'), 'titleAsc', 'titleDesc', 'titleAsc')}
                  </TableCell>
                  <TableCell width={100}>{t('myRequests.tableType')}</TableCell>
                  {showRequesterColumn && (
                    <TableCell width={150}>{t('myRequests.tableRequestedBy')}</TableCell>
                  )}
                  <TableCell width={130}>{t('myRequests.tableSource')}</TableCell>
                  <TableCell width={140} sortDirection={sort === 'oldest' ? 'asc' : sort === 'newest' ? 'desc' : false}>
                    {sortHeader(t('myRequests.tableRequested'), 'oldest', 'newest', 'newest')}
                  </TableCell>
                  <TableCell width={180}>{t('myRequests.tableStatus')}</TableCell>
                  <TableCell width={isAdmin ? 340 : 180} align="right">
                    {t('myRequests.tableActions')}
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Typography fontWeight={600}>{r.title}</Typography>
                      {seasonsLabel(r) && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {seasonsLabel(r)}
                        </Typography>
                      )}
                      {r.seerrRequestId != null && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {t('myRequests.seerrRequest', { id: r.seerrRequestId })}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{typeChip(r)}</TableCell>
                    {showRequesterColumn && (
                      <TableCell>
                        <Typography variant="body2">{requesterName(r)}</Typography>
                      </TableCell>
                    )}
                    <TableCell>{sourceChipEl(r)}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{requestedDate(r)}</Typography>
                    </TableCell>
                    <TableCell>{statusChip(r)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        {actions(r)}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {!loading && total > 0 && (
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10))
              setPage(0)
            }}
            rowsPerPageOptions={[10, 25, 50, 100]}
            labelRowsPerPage={t('common.rowsPerPage')}
            // The rows-per-page picker does not fit beside the range and the
            // arrows on a phone; the default page size stands there.
            sx={{
              '& .MuiTablePagination-selectLabel, & .MuiTablePagination-input': {
                display: { xs: 'none', sm: 'inline-flex' },
              },
            }}
          />
        )}
      </Paper>
      </>
      )}

      <TmdbExternalDetailModal
        open={tmdbModalOpen}
        onClose={closeTmdbModal}
        loading={tmdbModalLoading}
        error={tmdbModalError}
        data={tmdbModalData}
        sourceLabel="TMDb"
        canRequest={false}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snackbar.severity}
          variant="filled"
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
