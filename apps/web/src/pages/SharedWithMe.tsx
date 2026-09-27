/**
 * Shared with me — titles the viewer's connections recommended to them, one
 * section per person (docs/plans/social-connections.md §7.7).
 *
 * A title leaves this page when the viewer finishes it (decided server-side by
 * the poster badge's own rule), dismisses it, can no longer open it, or when the
 * person who sent it is no longer connected. Nothing here writes on read.
 *
 * The grid sizes off its container, not the window: the assistant dock and the
 * media dialog both shrink the pane below what a breakpoint assumes.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Avatar,
  Box,
  IconButton,
  Skeleton,
  Snackbar,
  Tooltip,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import RecommendIcon from '@mui/icons-material/Recommend'
import { MoviePoster } from '@aperture/ui'
import { PageHeading } from '@/components/PageHeading'
import { useConnections } from '@/hooks/useConnections'
import { useUserRatings } from '@/hooks/useUserRatings'
import { useWatchStatus } from '@/hooks/useWatchStatus'
import { withServerMessageDetail } from '@/lib/withServerMessageDetail'

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

interface SharedGroup {
  recommender: { id: string; name: string; avatarUrl: string }
  items: SharedItem[]
}

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

export function SharedWithMePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { refresh } = useConnections()
  const { getRating, setRating } = useUserRatings()
  const { isWatched, getEpisodeProgress } = useWatchStatus()
  const [groups, setGroups] = useState<SharedGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [snackbar, setSnackbar] = useState<{ message: string; severity: 'success' | 'error' } | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch('/api/social/recommendations', { credentials: 'include' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = (await response.json()) as { groups?: SharedGroup[] }
        if (!cancelled) setGroups(data.groups ?? [])
      } catch (err) {
        console.error('Failed to load shared-with-me:', err)
        if (!cancelled) setLoadFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

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
        setGroups((prev) =>
          prev
            .map((group) => ({ ...group, items: group.items.filter((i) => i.id !== item.id) }))
            .filter((group) => group.items.length > 0)
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

  return (
    <Box>
      <PageHeading
        title={t('nav.sharedWithMe')}
        description={t('sharedWithMe.subtitle')}
        sx={{ mb: 4 }}
      />

      {loading && (
        <Box>
          <Skeleton width={220} height={36} sx={{ mb: 2 }} />
          <Box sx={GRID_SX}>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} variant="rectangular" sx={{ borderRadius: 2, aspectRatio: '2 / 3' }} />
            ))}
          </Box>
        </Box>
      )}

      {!loading && loadFailed && <Alert severity="error">{t('sharedWithMe.loadFailed')}</Alert>}

      {!loading && !loadFailed && groups.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8, px: 2 }}>
          <RecommendIcon sx={{ fontSize: 56, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            {t('sharedWithMe.empty')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480, mx: 'auto' }}>
            {t('sharedWithMe.emptyHint')}
          </Typography>
        </Box>
      )}

      {!loading &&
        groups.map((group) => (
          <Box component="section" key={group.recommender.id} sx={{ mb: 5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <Avatar src={group.recommender.avatarUrl} alt="" sx={{ width: 36, height: 36 }}>
                {group.recommender.name.charAt(0).toUpperCase()}
              </Avatar>
              <Typography variant="h6" component="h2">
                {t('sharedWithMe.recommendedBy', { name: group.recommender.name })}
              </Typography>
            </Box>
            <Box sx={GRID_SX}>
              {group.items.map((item) => (
                <MoviePoster
                  key={item.id}
                  title={item.title}
                  year={item.year}
                  posterUrl={item.posterUrl}
                  genres={item.genres}
                  responsive
                  titleLines={2}
                  userRating={getRating(item.mediaType, item.itemId)}
                  onRate={(rating) => handleRate(item.mediaType, item.itemId, rating)}
                  watched={isWatched(item.mediaType, item.itemId)}
                  episodeProgress={getEpisodeProgress(item.mediaType, item.itemId)}
                  hideWatchingToggle
                  onClick={() =>
                    navigate(`/${item.mediaType === 'movie' ? 'movies' : 'series'}/${item.itemId}`)
                  }
                >
                  {/* Top-left: the top-right corner is the poster's badge stack,
                      and this page draws no rank badge. */}
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
          </Box>
        ))}

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
