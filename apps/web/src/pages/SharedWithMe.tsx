/**
 * Watch This (route `/watch-this`; the file keeps its first name, Shared with
 * me) — what the viewer's connections recommended to them (Received) and what
 * the viewer recommended to them (Sent), one card per person
 * (docs/plans/social-connections.md §7.7 and its 2026-09-29 notes).
 *
 * The heading is its own key (`sharedWithMe.title`), not the sidebar label:
 * it may carry an exclamation mark the sidebar does not, per language.
 *
 * Received: a title leaves when the viewer finishes it (decided server-side by
 * the poster badge's own rule), dismisses it, can no longer open it, or when
 * the person who sent it is no longer connected.
 *
 * Sent: every title the viewer sent to someone still connected, with where it
 * stands with that person — decided server-side. A dismissal is never
 * disclosed; it reads as waiting. The posters there carry the RECIPIENT's
 * status and none of the viewer's own badges, so the two cannot be confused.
 *
 * Nothing here writes on read. Grids size off their container, not the
 * window: the assistant dock and the media dialog both shrink the pane below
 * what a breakpoint assumes.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  IconButton,
  Skeleton,
  Snackbar,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import RecommendIcon from '@mui/icons-material/Recommend'
import MoveToInboxIcon from '@mui/icons-material/MoveToInbox'
import SendIcon from '@mui/icons-material/Send'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { MoviePoster } from '@aperture/ui'
import { PageHeading } from '@/components/PageHeading'
import { useConnections } from '@/hooks/useConnections'
import { useUserRatings } from '@/hooks/useUserRatings'
import { useWatchStatus } from '@/hooks/useWatchStatus'
import { formatRelativeTime } from '@/lib/relativeTime'
import { withServerMessageDetail } from '@/lib/withServerMessageDetail'
import { MetricTile } from './watch-stats/MetricTile'
import { PersonSection } from './sharedWithMe/PersonSection'
import { SentStatusCount, SentStatusPill } from './sharedWithMe/SentStatusPill'
import {
  countStatuses,
  defaultSharedTab,
  latestSharedAt,
  parseSharedTab,
  STATUS_ORDER,
  type SentStatus,
  type SharedTab,
} from './sharedWithMe/sharedView'

interface SharedItem {
  id: string
  mediaType: 'movie' | 'series'
  itemId: string
  title: string
  year: number | null
  posterUrl: string | null
  genres: string[]
  recommendedAt: string
}

interface SentItem extends SharedItem {
  status: SentStatus
  progress?: { watched: number; total: number }
}

interface Person {
  id: string
  name: string
  avatarUrl: string
}

interface ReceivedGroup {
  recommender: Person
  items: SharedItem[]
}

interface SentGroup {
  recipient: Person
  items: SentItem[]
}

type Loaded<G> = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; groups: G[] }

const GRID_SX = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: 2,
} as const

async function serverMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown }
    const text = body.error ?? body.message
    return typeof text === 'string' && text.trim() ? text : null
  } catch {
    return null
  }
}

/**
 * Items across every group; null while loading. A failed list counts as empty
 * here, which only the opening-tab choice reads — the tiles show "—" for it.
 */
function itemCount<G extends { items: unknown[] }>(list: Loaded<G>): number | null {
  if (list.state === 'loading') return null
  if (list.state === 'failed') return 0
  return list.groups.reduce((n, group) => n + group.items.length, 0)
}

function GridSkeleton() {
  return (
    <Box>
      <Skeleton width={220} height={36} sx={{ mb: 2 }} />
      <Box sx={GRID_SX}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} variant="rectangular" sx={{ borderRadius: 2, aspectRatio: '2 / 3' }} />
        ))}
      </Box>
    </Box>
  )
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 8, px: 2 }}>
      <RecommendIcon sx={{ fontSize: 56, color: 'text.disabled', mb: 2 }} />
      <Typography variant="h6" gutterBottom>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480, mx: 'auto' }}>
        {hint}
      </Typography>
    </Box>
  )
}

export function SharedWithMePage() {
  const { t, i18n } = useTranslation()
  const theme = useTheme()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { refresh } = useConnections()
  const { getRating, setRating } = useUserRatings()
  const { isWatched, getEpisodeProgress } = useWatchStatus()
  const [received, setReceived] = useState<Loaded<ReceivedGroup>>({ state: 'loading' })
  const [sent, setSent] = useState<Loaded<SentGroup>>({ state: 'loading' })
  const [openingTab, setOpeningTab] = useState<SharedTab | null>(null)
  const [snackbar, setSnackbar] = useState<{ message: string; severity: 'success' | 'error' } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load<G>(url: string, set: (value: Loaded<G>) => void) {
      try {
        const response = await fetch(url, { credentials: 'include' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = (await response.json()) as { groups?: G[] }
        if (!cancelled) set({ state: 'ready', groups: data.groups ?? [] })
      } catch (err) {
        console.error(`Failed to load ${url}:`, err)
        if (!cancelled) set({ state: 'failed' })
      }
    }
    void Promise.all([
      load<ReceivedGroup>('/api/social/recommendations', setReceived),
      load<SentGroup>('/api/social/recommendations/sent', setSent),
    ]).then(() => {
      // The sidebar's counts are read from these same lists, so re-read them
      // now: something may have arrived, been finished or been scoped out since.
      if (!cancelled) void refresh()
    })
    return () => {
      cancelled = true
    }
  }, [refresh])

  const receivedCount = itemCount(received)
  const sentCount = itemCount(sent)
  const sentItems = sent.state === 'ready' ? sent.groups.flatMap((group) => group.items) : []
  const sentStatusCounts = countStatuses(sentItems)

  // Decided once, when both lists have answered (see defaultSharedTab).
  useEffect(() => {
    if (openingTab !== null || receivedCount === null || sentCount === null) return
    setOpeningTab(defaultSharedTab(receivedCount, sentCount))
  }, [openingTab, receivedCount, sentCount])

  const tab = parseSharedTab(searchParams.get('tab')) ?? openingTab

  const selectTab = useCallback(
    (next: SharedTab) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          params.set('tab', next)
          return params
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  const handleDismiss = useCallback(
    async (item: SharedItem) => {
      try {
        const response = await fetch(`/api/social/recommendations/${item.id}/dismiss`, {
          method: 'POST',
          credentials: 'include',
        })
        if (!response.ok) {
          const message = await serverMessage(response)
          setSnackbar({
            severity: 'error',
            message: message
              ? `${t('sharedWithMe.dismissFailed')}: ${withServerMessageDetail(t, message)}`
              : t('sharedWithMe.dismissFailed'),
          })
          return
        }
        setReceived((prev) =>
          prev.state !== 'ready'
            ? prev
            : {
                state: 'ready',
                groups: prev.groups
                  .map((group) => ({ ...group, items: group.items.filter((i) => i.id !== item.id) }))
                  .filter((group) => group.items.length > 0),
              }
        )
        setSnackbar({ severity: 'success', message: t('sharedWithMe.dismissed') })
        void refresh()
      } catch (err) {
        console.error('Failed to dismiss recommendation:', err)
        setSnackbar({ severity: 'error', message: t('sharedWithMe.dismissFailed') })
      }
    },
    [refresh, t]
  )

  const handleRate = useCallback(
    async (type: 'movie' | 'series', id: string, rating: number | null) => {
      try {
        await setRating(type, id, rating)
      } catch (err) {
        console.error('Failed to rate:', err)
      }
    },
    [setRating]
  )

  const now = new Date()
  const when = (iso: string) => formatRelativeTime(new Date(iso), now, i18n.language)
  const metaLine = (item: SharedItem) => (item.year ? `${item.year} · ${when(item.recommendedAt)}` : when(item.recommendedAt))
  const openItem = (item: SharedItem) =>
    navigate(`/${item.mediaType === 'movie' ? 'movies' : 'series'}/${item.itemId}`)

  // A list that failed to load is "—", never 0: zero is a claim about the
  // viewer, and the tab below says the load failed.
  const tileValue = (list: Loaded<unknown>, value: ReactNode) =>
    list.state === 'loading' ? <Skeleton width={32} /> : list.state === 'failed' ? '—' : value

  return (
    <Box>
      <PageHeading title={t('sharedWithMe.title')} description={t('sharedWithMe.subtitleBoth')} sx={{ mb: 3 }} />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 2,
          mb: 3,
        }}
      >
        <MetricTile
          value={tileValue(received, receivedCount)}
          label={t('sharedWithMe.tileWaiting')}
          icon={<MoveToInboxIcon />}
          color={theme.palette.primary.main}
          onClick={() => selectTab('received')}
        />
        <MetricTile
          value={tileValue(sent, sentCount)}
          label={t('sharedWithMe.tileSent')}
          icon={<SendIcon />}
          color={theme.palette.secondary.main}
          onClick={() => selectTab('sent')}
        />
        <MetricTile
          value={tileValue(
            sent,
            sentCount
              ? t('sharedWithMe.tileWatchedValue', { watched: sentStatusCounts.watched, total: sentCount })
              : '—'
          )}
          label={t('sharedWithMe.tileWatched')}
          icon={<CheckCircleIcon />}
          color={theme.palette.success.main}
          onClick={() => selectTab('sent')}
        />
      </Box>

      <Tabs
        value={tab ?? false}
        onChange={(_, next: SharedTab) => selectTab(next)}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab
          value="received"
          icon={<MoveToInboxIcon fontSize="small" />}
          iconPosition="start"
          label={t('sharedWithMe.tabReceived')}
          sx={{ minHeight: 48 }}
        />
        <Tab
          value="sent"
          icon={<SendIcon fontSize="small" />}
          iconPosition="start"
          label={t('sharedWithMe.tabSent')}
          sx={{ minHeight: 48 }}
        />
      </Tabs>

      {tab === null && <GridSkeleton />}

      {tab === 'received' && (
        <Box role="tabpanel">
          {received.state === 'loading' && <GridSkeleton />}
          {received.state === 'failed' && <Alert severity="error">{t('sharedWithMe.loadFailed')}</Alert>}
          {received.state === 'ready' && received.groups.length === 0 && (
            <EmptyState title={t('sharedWithMe.empty')} hint={t('sharedWithMe.emptyHint')} />
          )}
          {received.state === 'ready' &&
            received.groups.map((group) => {
              const latest = latestSharedAt(group.items)
              return (
                <PersonSection
                  key={group.recommender.id}
                  person={group.recommender}
                  heading={t('sharedWithMe.recommendedBy', { name: group.recommender.name })}
                  subheading={t('sharedWithMe.receivedSummary', {
                    count: group.items.length,
                    when: latest ? when(latest) : '',
                  })}
                >
                  <Box sx={GRID_SX}>
                    {group.items.map((item) => (
                      <MoviePoster
                        key={item.id}
                        title={item.title}
                        year={item.year}
                        posterUrl={item.posterUrl}
                        genres={item.genres}
                        metaLine={metaLine(item)}
                        responsive
                        titleLines={2}
                        userRating={getRating(item.mediaType, item.itemId)}
                        onRate={(rating) => handleRate(item.mediaType, item.itemId, rating)}
                        watched={isWatched(item.mediaType, item.itemId)}
                        episodeProgress={getEpisodeProgress(item.mediaType, item.itemId)}
                        hideWatchingToggle
                        onClick={() => openItem(item)}
                      >
                        {/* Top-left: the top-right corner is the poster's badge
                            stack, and this page draws no rank badge. */}
                        <Tooltip title={t('sharedWithMe.dismiss')}>
                          <IconButton
                            size="small"
                            aria-label={t('sharedWithMe.dismiss')}
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleDismiss(item)
                            }}
                            sx={{
                              position: 'absolute',
                              top: 6,
                              insetInlineStart: 6,
                              zIndex: 2,
                              width: 28,
                              height: 28,
                              backgroundColor: 'rgba(0, 0, 0, 0.6)',
                              color: 'common.white',
                              '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.8)' },
                            }}
                          >
                            <CloseIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      </MoviePoster>
                    ))}
                  </Box>
                </PersonSection>
              )
            })}
        </Box>
      )}

      {tab === 'sent' && (
        <Box role="tabpanel">
          {sent.state === 'loading' && <GridSkeleton />}
          {sent.state === 'failed' && <Alert severity="error">{t('sharedWithMe.sentLoadFailed')}</Alert>}
          {sent.state === 'ready' && sent.groups.length === 0 && (
            <EmptyState title={t('sharedWithMe.sentEmpty')} hint={t('sharedWithMe.sentEmptyHint')} />
          )}
          {sent.state === 'ready' &&
            sent.groups.map((group) => {
              const counts = countStatuses(group.items)
              return (
                <PersonSection
                  key={group.recipient.id}
                  person={group.recipient}
                  heading={t('sharedWithMe.sentTo', { name: group.recipient.name })}
                  subheading={t('sharedWithMe.sentSummary', { count: group.items.length })}
                  aside={STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => (
                    <SentStatusCount key={status} status={status} count={counts[status]} />
                  ))}
                >
                  <Box sx={GRID_SX}>
                    {group.items.map((item) => (
                      // A title they can no longer open is dimmed: it is not in
                      // their list, and the pill says why.
                      <Box key={item.id} sx={{ opacity: item.status === 'unavailable' ? 0.55 : 1 }}>
                        <MoviePoster
                          title={item.title}
                          year={item.year}
                          posterUrl={item.posterUrl}
                          genres={item.genres}
                          metaLine={metaLine(item)}
                          responsive
                          titleLines={2}
                          hideUserRating
                          hideWatchingToggle
                          onClick={() => openItem(item)}
                        >
                          <SentStatusPill
                            status={item.status}
                            progress={item.progress}
                            name={group.recipient.name}
                          />
                        </MoviePoster>
                      </Box>
                    ))}
                  </Box>
                </PersonSection>
              )
            })}
        </Box>
      )}

      <Snackbar
        open={snackbar !== null}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar?.severity ?? 'success'} onClose={() => setSnackbar(null)} variant="filled">
          {snackbar?.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
