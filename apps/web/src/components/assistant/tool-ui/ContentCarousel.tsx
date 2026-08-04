/**
 * Content list for Tool UI.
 *
 * Renders either:
 * - a horizontal scrollable carousel (default) — semantic "Also worth checking"
 *   and every library/search result; or
 * - a vertical stack of rich cards (when `data.layout === 'list'`) — the
 *   web-search "Recommendations", where each card carries a synopsis + reason.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Typography, IconButton, Button, Snackbar, Alert, useTheme } from '@mui/material'
import { alpha } from '@mui/material/styles'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd'
import { ContentCard } from './ContentCard'
import { CreatePlaylistFromSuggestionsDialog } from './CreatePlaylistFromSuggestionsDialog'
import { COMPACT_THREAD } from '../density'
import { extraColors } from '@/theme'
import type { ContentCarouselData, ContentItem } from './types'

interface ContentCarouselProps {
  data: ContentCarouselData
  onPlay?: (id: string, href: string) => void
}

/**
 * Favorite status shared by every carousel on the page, keyed `type:id`.
 *
 * Each status lookup costs a media-server round trip, and the chat remounts
 * carousels constantly (conversation switches, re-renders, historical messages),
 * so without this a reopened conversation would re-ask for every card it has
 * ever shown. Session-scoped on purpose: favorites rarely change elsewhere while
 * the tab is open, and toggling here keeps it current.
 */
const favoriteStatusCache = new Map<string, boolean>()

const favoriteKey = (item: Pick<ContentItem, 'id' | 'type'>) => `${item.type}:${item.id}`

function useCarouselHeaderText(data: ContentCarouselData) {
  const { t } = useTranslation()
  const title = data.titleKey
    ? t(`assistantToolUi.${data.titleKey}`, {
        ...(data.titleParams ?? {}),
        defaultValue: data.title,
      })
    : data.title
  const description = data.descriptionKey
    ? t(`assistantToolUi.${data.descriptionKey}`, {
        ...(data.descriptionParams ?? {}),
        defaultValue: data.description,
      })
    : data.description
  const resolvedTitle = typeof title === 'string' && title.length > 0 ? title : undefined
  const resolvedDescription = typeof description === 'string' && description.length > 0 ? description : undefined
  return { resolvedTitle, resolvedDescription }
}

export function ContentCarousel({ data, onPlay }: ContentCarouselProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const rtl = theme.direction === 'rtl'
  const scrollRef = useRef<HTMLDivElement>(null)
  const { resolvedTitle, resolvedDescription } = useCarouselHeaderText(data)

  // 'list' = vertical rich cards (web-search recs). Anything else = carousel.
  const isList = data.layout === 'list'

  const [favorited, setFavorited] = useState<Set<string>>(new Set())
  const [pendingFavorites, setPendingFavorites] = useState<Set<string>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [snackbar, setSnackbar] = useState<{
    open: boolean
    message: string
    severity: 'success' | 'error' | 'info'
  }>({ open: false, message: '', severity: 'success' })

  const notify = (message: string, severity: 'success' | 'error' | 'info' = 'success') =>
    setSnackbar({ open: true, message, severity })

  // Seed which hearts are already filled. Without this every card renders as
  // un-favorited on mount, so an item the user already favorited looks like it
  // isn't — one bulk request for the whole list, and only for items whose status
  // isn't cached yet. Failure is non-critical: hearts stay empty until clicked.
  const itemsKey = data.items.map(favoriteKey).join(',')
  useEffect(() => {
    if (data.items.length === 0) return
    let cancelled = false

    const seedFromCache = () => {
      const known = data.items.filter((item) => favoriteStatusCache.get(favoriteKey(item)))
      if (known.length > 0) setFavorited(new Set(known.map((item) => item.id)))
    }

    const unknown = data.items.filter((item) => !favoriteStatusCache.has(favoriteKey(item)))
    if (unknown.length === 0) {
      seedFromCache()
      return
    }

    fetch('/api/favorites/status/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        movieIds: unknown.filter((i) => i.type === 'movie').map((i) => i.id),
        seriesIds: unknown.filter((i) => i.type === 'series').map((i) => i.id),
      }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (!result) return
        const favorites = new Set<string>([
          ...(result.movieIds ?? []),
          ...(result.seriesIds ?? []),
        ])
        // Cache even if this carousel unmounted — the next one benefits.
        for (const item of unknown) {
          favoriteStatusCache.set(favoriteKey(item), favorites.has(item.id))
        }
        if (!cancelled) seedFromCache()
      })
      .catch(() => {
        /* leave hearts empty */
      })

    return () => {
      cancelled = true
    }
    // data.items is re-created on every render; itemsKey is its stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey])

  // Optimistically toggle one suggestion in/out of the user's media-server favorites.
  const handleToggleFavorite = async (item: ContentItem) => {
    if (pendingFavorites.has(item.id)) return
    const makeFavorite = !favorited.has(item.id)

    const revert = () => {
      favoriteStatusCache.set(favoriteKey(item), !makeFavorite)
      setFavorited((prev) => {
        const next = new Set(prev)
        if (makeFavorite) next.delete(item.id)
        else next.add(item.id)
        return next
      })
    }

    favoriteStatusCache.set(favoriteKey(item), makeFavorite)

    setFavorited((prev) => {
      const next = new Set(prev)
      if (makeFavorite) next.add(item.id)
      else next.delete(item.id)
      return next
    })
    setPendingFavorites((prev) => new Set(prev).add(item.id))

    try {
      const body =
        item.type === 'movie'
          ? { movieIds: [item.id], favorite: makeFavorite }
          : { seriesIds: [item.id], favorite: makeFavorite }
      const response = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error('request failed')
      const result = await response.json()
      if (result.updated === 0) {
        // Item could not be resolved to a library item — undo the optimistic toggle.
        revert()
        notify(t('assistantToolUi.favoriteNotInLibrary'), 'info')
      } else {
        notify(
          makeFavorite ? t('assistantToolUi.favoriteAdded') : t('assistantToolUi.favoriteRemoved'),
          'success'
        )
      }
    } catch {
      revert()
      notify(t('assistantToolUi.favoriteFailed'), 'error')
    } finally {
      setPendingFavorites((prev) => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
    }
  }

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 300
      let delta = direction === 'left' ? -scrollAmount : scrollAmount
      if (rtl) delta = -delta
      scrollRef.current.scrollBy({
        left: delta,
        behavior: 'smooth',
      })
    }
  }

  const hasHeader = Boolean(resolvedTitle || resolvedDescription)
  const isEmpty = data.items.length === 0

  const renderHeader = () => (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 1,
        mb: 1.5,
        [COMPACT_THREAD]: { mb: 1 },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        {resolvedTitle && (
          <Typography variant="subtitle1" fontWeight={600} sx={{ color: '#e4e4e7' }}>
            {resolvedTitle}
          </Typography>
        )}
        {resolvedDescription && (
          <Typography variant="caption" color="text.secondary">
            {resolvedDescription}
          </Typography>
        )}
      </Box>
      {!isEmpty && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<PlaylistAddIcon sx={{ fontSize: 16 }} />}
          onClick={() => setDialogOpen(true)}
          sx={{
            flexShrink: 0,
            fontSize: 11,
            py: 0.25,
            whiteSpace: 'nowrap',
            borderColor: extraColors.subtleBorder,
            color: '#a1a1aa',
            '&:hover': { borderColor: theme.palette.primary.main, bgcolor: alpha(theme.palette.primary.main, 0.1) },
          }}
        >
          {t('assistantToolUi.createPlaylist')}
        </Button>
      )}
    </Box>
  )

  if (isEmpty) {
    if (!hasHeader) return null
    return (
      <Box sx={{ my: 2, width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
        <Box sx={{ mb: 1.5 }}>
          {resolvedTitle && (
            <Typography variant="subtitle1" fontWeight={600} sx={{ color: '#e4e4e7' }}>
              {resolvedTitle}
            </Typography>
          )}
          {resolvedDescription && (
            <Typography variant="caption" color="text.secondary">
              {resolvedDescription}
            </Typography>
          )}
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ my: 2, [COMPACT_THREAD]: { my: 1.25 }, width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      {/* Header row: title/description + create-playlist action */}
      {renderHeader()}

      {isList ? (
        /* Vertical stacked list of rich cards (web-search recommendations) */
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, [COMPACT_THREAD]: { gap: 1 } }}>
          {data.items.map((item) => (
            <ContentCard
              key={item.id}
              item={item}
              variant="list"
              onPlay={onPlay}
              isFavorite={favorited.has(item.id)}
              favoritePending={pendingFavorites.has(item.id)}
              onToggleFavorite={handleToggleFavorite}
            />
          ))}
        </Box>
      ) : (
        /* Horizontal scrollable carousel (default) */
        <Box sx={{ position: 'relative', overflow: 'hidden' }}>
          {/* Scroll buttons */}
          {data.items.length > 2 && (
            <>
              <IconButton
                onClick={() => scroll('left')}
                aria-label={t('assistantToolUi.scrollCarouselLeft')}
                sx={{
                  position: 'absolute',
                  insetInlineStart: 4,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 2,
                  bgcolor: 'rgba(0, 0, 0, 0.8)',
                  backdropFilter: 'blur(4px)',
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, 0.8),
                  },
                }}
                size="small"
              >
                <ChevronLeftIcon />
              </IconButton>
              <IconButton
                onClick={() => scroll('right')}
                aria-label={t('assistantToolUi.scrollCarouselRight')}
                sx={{
                  position: 'absolute',
                  insetInlineEnd: 4,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 2,
                  bgcolor: 'rgba(0, 0, 0, 0.8)',
                  backdropFilter: 'blur(4px)',
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, 0.8),
                  },
                }}
                size="small"
              >
                <ChevronRightIcon />
              </IconButton>
            </>
          )}

          {/* Scrollable content */}
          <Box
            ref={scrollRef}
            sx={{
              display: 'flex',
              gap: 1.5,
              overflowX: 'auto',
              overflowY: 'hidden',
              px: 1,
              py: 0.5,
              scrollSnapType: 'x mandatory',
              scrollBehavior: 'smooth',
              // Hide scrollbar but keep functionality
              scrollbarWidth: 'none', // Firefox
              msOverflowStyle: 'none', // IE/Edge
              '&::-webkit-scrollbar': {
                display: 'none', // Chrome/Safari
              },
            }}
          >
            {data.items.map((item) => (
              <Box key={item.id} sx={{ scrollSnapAlign: 'start', flexShrink: 0 }}>
                <ContentCard
                  item={item}
                  onPlay={onPlay}
                  isFavorite={favorited.has(item.id)}
                  favoritePending={pendingFavorites.has(item.id)}
                  onToggleFavorite={handleToggleFavorite}
                />
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <CreatePlaylistFromSuggestionsDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        items={data.items}
        request={data.request}
        onCreated={(name) => notify(t('playlists.createdInLibrary', { name }), 'success')}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
