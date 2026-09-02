import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Skeleton,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MoviePoster } from '@aperture/ui'
import { useAuth } from '@/hooks/useAuth'
import { useMediaDetailModal } from '@/hooks/useMediaDetailModal'
import type { BreakdownItem, BreakdownRequest } from './types'

interface StatBreakdownDialogProps {
  request: BreakdownRequest | null
  onClose: () => void
}

/**
 * The titles behind one number on the stats page.
 *
 * Every chart bucket is a population, and until this existed the page could
 * only report its size. The dialog re-asks the server for that same population
 * rather than filtering anything the page already holds, because the page holds
 * counts and not titles.
 */
export function StatBreakdownDialog({ request, onClose }: StatBreakdownDialogProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const openMediaDetail = useMediaDetailModal()

  const [items, setItems] = useState<BreakdownItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = request !== null

  useEffect(() => {
    if (!request || !user) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ dimension: request.dimension })
        if (request.value != null) params.set('value', request.value)
        if (request.value2 != null) params.set('value2', request.value2)
        const response = await fetch(
          `/api/users/${user.id}/watch-stats/breakdown?${params.toString()}`,
          { credentials: 'include' }
        )
        if (cancelled) return
        if (!response.ok) {
          setError(t('watchStats.breakdownError'))
          setItems([])
          setTotal(0)
          return
        }
        const data = await response.json()
        setItems(data.items ?? [])
        setTotal(data.total ?? 0)
      } catch {
        if (!cancelled) {
          setError(t('watchStats.breakdownError'))
          setItems([])
          setTotal(0)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [request, user, t])

  // The stats page hosts a detail modal, so a title opens in place and the
  // reader keeps the dialog they drilled from. Routing is the fallback for a
  // surface with no host.
  const openItem = (item: BreakdownItem) => {
    if (openMediaDetail) {
      openMediaDetail(item.mediaType, item.id)
      return
    }
    onClose()
    navigate(item.mediaType === 'movie' ? `/movies/${item.id}` : `/series/${item.id}`)
  }

  const shown = items.length
  const truncated = total > shown

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth scroll="paper">
      <DialogTitle sx={{ pr: 6, pb: 1 }}>
        <Typography variant="h6" fontWeight={700} component="div" noWrap>
          {request?.label ?? ''}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {loading
            ? t('watchStats.breakdownLoading')
            : truncated
              ? t('watchStats.breakdownShowingOf', { shown, total })
              : t('watchStats.breakdownCount', { count: total })}
        </Typography>
        {request?.moreHref && (
          <Button
            size="small"
            endIcon={<ArrowForwardIcon />}
            onClick={() => {
              onClose()
              navigate(request.moreHref!)
            }}
            sx={{ position: 'absolute', top: 14, insetInlineEnd: 52 }}
          >
            {request.moreLabel}
          </Button>
        )}
        <IconButton
          onClick={onClose}
          size="small"
          sx={{ position: 'absolute', top: 12, insetInlineEnd: 12 }}
          aria-label={t('common.close')}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ borderRadius: 2 }}>
            {error}
          </Alert>
        )}

        {!error && (
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              // Sized off the container, not the viewport: the dialog is
              // narrower than the window and a breakpoint-keyed grid would
              // keep its full-desktop column count inside it.
              gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
            }}
          >
            {loading &&
              Array.from({ length: 12 }, (_, i) => (
                <Skeleton key={i} variant="rectangular" sx={{ borderRadius: 2, aspectRatio: '2 / 3' }} />
              ))}

            {!loading &&
              items.map(item => (
                <Box key={`${item.mediaType}-${item.id}`} sx={{ position: 'relative' }}>
                  <MoviePoster
                    title={item.title}
                    year={item.year}
                    posterUrl={item.poster}
                    rating={item.rating}
                    responsive
                    hideUserRating
                    hideWatchingToggle
                    hideExploreButton
                    onClick={() => openItem(item)}
                  />
                  {(item.playCount ?? 0) > 1 && (
                    <Chip
                      label={t('watchStats.breakdownPlays', { count: item.playCount })}
                      size="small"
                      sx={{
                        position: 'absolute',
                        bottom: 44,
                        insetInlineStart: 6,
                        height: 20,
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                  {item.episodesWatched != null && (
                    <Chip
                      label={t('watchStats.breakdownEpisodes', { count: item.episodesWatched })}
                      size="small"
                      sx={{
                        position: 'absolute',
                        bottom: 44,
                        insetInlineStart: 6,
                        height: 20,
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                </Box>
              ))}
          </Box>
        )}

        {!loading && !error && items.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            {t('watchStats.breakdownEmpty')}
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  )
}
