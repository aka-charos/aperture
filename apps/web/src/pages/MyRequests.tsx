import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
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
  TablePagination,
  Snackbar,
  FormControlLabel,
  Switch,
  Tabs,
  Tab,
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

type SeerrLive = {
  status: 'pending' | 'approved' | 'declined'
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
  createdAt: string
  updatedAt: string
  seerrLive: SeerrLive
  libraryMediaId?: string | null
  /** Present only in the admin scope, where rows belong to other people. */
  requestedByUsername?: string | null
  requestedByDisplayName?: string | null
}

function getRequestStatusKey(row: DiscoveryRequestRow): string | null {
  const live = row.seerrLive
  if (live) {
    if (live.mediaStatus === 'available') return 'available'
    if (live.status === 'declined') return 'declined'
    if (live.status === 'pending') return 'pendingApproval'
    if (live.mediaStatus === 'processing' || live.mediaStatus === 'partially_available') {
      return 'processing'
    }
    if (live.status === 'approved') return 'approved'
  }
  const s = row.status
  if (s === 'submitted') return 'submitted'
  if (s === 'pending') return 'pending'
  if (s === 'approved') return 'approved'
  if (s === 'declined') return 'declined'
  if (s === 'available') return 'available'
  if (s === 'failed') return 'failed'
  return null
}

function isRowAvailable(row: DiscoveryRequestRow): boolean {
  return getRequestStatusKey(row) === 'available'
}

function statusColor(row: DiscoveryRequestRow): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' {
  const key = getRequestStatusKey(row)
  if (key === 'available') return 'success'
  if (key === 'declined' || key === 'failed' || row.status === 'failed') return 'error'
  if (key === 'pendingApproval' || key === 'pending' || key === 'submitted') return 'warning'
  if (key === 'approved' || key === 'processing') return 'info'
  return 'default'
}

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
  const key = getRequestStatusKey(row)
  return key === 'pendingApproval' || key === 'submitted' || key === 'pending'
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
  const [allUsers, setAllUsers] = useState(false)
  const [tab, setTab] = useState<'requests' | 'issues'>('requests')
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
  }, [sourceFilter, allUsers, isAdmin, page, rowsPerPage, t])

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
    const key = getRequestStatusKey(row)
    if (key) return t(`myRequests.requestStatus.${key}`)
    return t('myRequests.requestStatus.fallback', { status: row.status })
  }

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

  const showRequesterColumn = isAdmin && allUsers

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto', p: { xs: 2, md: 3 } }}>
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
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tabs value={tab} onChange={(_, next: 'requests' | 'issues') => setTab(next)}>
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
              {t('myRequests.empty')}
            </Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('myRequests.tableTitle')}</TableCell>
                  <TableCell width={100}>{t('myRequests.tableType')}</TableCell>
                  {showRequesterColumn && (
                    <TableCell width={150}>{t('myRequests.tableRequestedBy')}</TableCell>
                  )}
                  <TableCell width={130}>{t('myRequests.tableSource')}</TableCell>
                  <TableCell width={140}>{t('myRequests.tableRequested')}</TableCell>
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
                      {r.seerrRequestId != null && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {t('myRequests.seerrRequest', { id: r.seerrRequestId })}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={r.mediaType === 'movie' ? t('myRequests.typeMovie') : t('myRequests.typeSeries')}
                        variant="outlined"
                      />
                    </TableCell>
                    {showRequesterColumn && (
                      <TableCell>
                        <Typography variant="body2">
                          {r.requestedByDisplayName ||
                            r.requestedByUsername ||
                            t('myRequests.unknownUser')}
                        </Typography>
                      </TableCell>
                    )}
                    <TableCell>
                      <Chip
                        size="small"
                        label={t(sourceChip(r.source).key)}
                        variant="outlined"
                        color={sourceChip(r.source).color}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {new Date(r.createdAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Tooltip
                        title={
                          r.seerrLive
                            ? t('myRequests.tooltipLive', {
                                reqStatus: r.seerrLive.status,
                                mediaStatus: r.seerrLive.mediaStatus,
                              })
                            : ''
                        }
                      >
                        <Chip
                          size="small"
                          label={formatRequestStatus(r)}
                          color={statusColor(r)}
                          variant={statusColor(r) === 'default' ? 'outlined' : 'filled'}
                        />
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
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
                        {isRowAvailable(r) && r.libraryMediaId ? (
                          <Button
                            size="small"
                            variant="outlined"
                            component={RouterLink}
                            to={
                              r.mediaType === 'movie'
                                ? `/movies/${r.libraryMediaId}`
                                : `/series/${r.libraryMediaId}`
                            }
                          >
                            {t('myRequests.openInLibrary')}
                          </Button>
                        ) : (
                          <Button size="small" variant="outlined" onClick={() => openTmdbModal(r)}>
                            {t('myRequests.details')}
                          </Button>
                        )}
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
