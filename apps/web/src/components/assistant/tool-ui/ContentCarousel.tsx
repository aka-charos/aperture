/**
 * Content list for Tool UI
 * Vertical stack of rich content cards (poster + synopsis + "why it fits").
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Typography, Button, Snackbar, Alert } from '@mui/material'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd'
import { ContentCard } from './ContentCard'
import { CreatePlaylistFromSuggestionsDialog } from './CreatePlaylistFromSuggestionsDialog'
import type { ContentCarouselData, ContentItem } from './types'

interface ContentCarouselProps {
  data: ContentCarouselData
  onPlay?: (id: string, href: string) => void
}

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
  const { resolvedTitle, resolvedDescription } = useCarouselHeaderText(data)

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

  // Optimistically toggle one suggestion in/out of the user's media-server favorites.
  const handleToggleFavorite = async (item: ContentItem) => {
    if (pendingFavorites.has(item.id)) return
    const makeFavorite = !favorited.has(item.id)

    const revert = () =>
      setFavorited((prev) => {
        const next = new Set(prev)
        if (makeFavorite) next.delete(item.id)
        else next.add(item.id)
        return next
      })

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

  const hasHeader = Boolean(resolvedTitle || resolvedDescription)
  const isEmpty = data.items.length === 0

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
    <Box sx={{ my: 2, width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      {/* Header row: title/description + create-playlist action */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
          mb: 1.5,
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
            borderColor: '#3a3a3a',
            color: '#a1a1aa',
            '&:hover': { borderColor: '#6366f1', bgcolor: 'rgba(99, 102, 241, 0.1)' },
          }}
        >
          {t('assistantToolUi.createPlaylist')}
        </Button>
      </Box>

      {/* Vertical stacked list of cards */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {data.items.map((item) => (
          <ContentCard
            key={item.id}
            item={item}
            onPlay={onPlay}
            isFavorite={favorited.has(item.id)}
            favoritePending={pendingFavorites.has(item.id)}
            onToggleFavorite={handleToggleFavorite}
          />
        ))}
      </Box>

      <CreatePlaylistFromSuggestionsDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        items={data.items}
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
