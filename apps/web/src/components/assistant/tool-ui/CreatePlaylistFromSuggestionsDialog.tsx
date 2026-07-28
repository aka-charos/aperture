/**
 * Create a media-server playlist from a set of chat-assistant suggestions.
 * All suggestions start selected; the user deselects the ones they don't want.
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  TextField,
  Button,
  IconButton,
  CircularProgress,
  Tooltip,
  Alert,
  Checkbox,
  Menu,
  MenuItem,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd'
import { getProxiedImageUrl } from '@aperture/ui'
import type { ContentItem } from './types'

interface CreatePlaylistFromSuggestionsDialogProps {
  open: boolean
  onClose: () => void
  items: ContentItem[]
  /** The request these suggestions answered; grounds the AI name/description. */
  request?: string
  onCreated?: (name: string) => void
}

export function CreatePlaylistFromSuggestionsDialog({
  open,
  onClose,
  items,
  request,
  onCreated,
}: CreatePlaylistFromSuggestionsDialogProps) {
  const { t } = useTranslation()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [generatingName, setGeneratingName] = useState(false)
  const [generatingDescription, setGeneratingDescription] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [descriptionMenuAnchor, setDescriptionMenuAnchor] = useState<HTMLElement | null>(null)

  // Pre-select every suggestion whenever the dialog opens ("add all" by default).
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(items.map((i) => i.id)))
      setName('')
      setDescription('')
      setError(null)
      setDescriptionMenuAnchor(null)
    }
  }, [open, items])

  const selectedItems = items.filter((i) => selectedIds.has(i.id))
  const movieIds = selectedItems.filter((i) => i.type === 'movie').map((i) => i.id)
  const seriesIds = selectedItems.filter((i) => i.type === 'series').map((i) => i.id)

  /**
   * What the chat knows that the title list doesn't: the request these picks
   * answered, and the note shown on each card. Without it the namer sees eleven
   * horror films and has no way to tell that the thread is "reality comes apart"
   * rather than "horror". Built from the SELECTED items, so deselecting a film
   * also drops its rationale. Omitted entirely when there is nothing to say —
   * the server then falls back to describing the titles alone.
   */
  const chatContext = () => {
    const reasons = selectedItems
      .filter((i) => i.reason)
      .map((i) => ({ title: i.name, reason: i.reason as string }))
    if (!request && reasons.length === 0) return undefined
    return { ...(request ? { request } : {}), ...(reasons.length > 0 ? { reasons } : {}) }
  }

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleGenerateName = async () => {
    setGeneratingName(true)
    setError(null)
    try {
      const response = await fetch('/api/graph-playlists/ai-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ movieIds, seriesIds, chatContext: chatContext() }),
      })
      if (!response.ok) throw new Error('Failed to generate name')
      const data = await response.json()
      setName(data.name)
    } catch {
      setError(t('playlists.errGenerateName'))
    } finally {
      setGeneratingName(false)
    }
  }

  /**
   * The result always replaces the box, so `useNotes` decides whether what's in there survives:
   * it feeds the text back as the strongest signal in the prompt, keeping an angle the titles and
   * the request would never surface on their own. Off — the pre-existing behaviour — ignores the
   * box, which is the only way to get a different take once it already holds a generated draft.
   */
  const handleGenerateDescription = async (useNotes = false) => {
    const notes = useNotes ? description.trim() : ''
    setGeneratingDescription(true)
    setError(null)
    try {
      const response = await fetch('/api/graph-playlists/ai-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          movieIds,
          seriesIds,
          name: name || undefined,
          chatContext: chatContext(),
          userNotes: notes || undefined,
        }),
      })
      if (!response.ok) throw new Error('Failed to generate description')
      const data = await response.json()
      setDescription(data.description)
    } catch {
      setError(t('playlists.errGenerateDescription'))
    } finally {
      setGeneratingDescription(false)
    }
  }

  const handleCreate = async () => {
    if (!name.trim()) {
      setError(t('playlists.errNameRequired'))
      return
    }
    if (selectedItems.length === 0) {
      setError(t('playlists.noItemsSelected'))
      return
    }

    setCreating(true)
    setError(null)
    try {
      const response = await fetch('/api/graph-playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          movieIds,
          seriesIds,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || t('playlists.errCreateFailed'))
      }
      const created = name.trim()
      onClose()
      onCreated?.(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('playlists.errCreateFailed'))
    } finally {
      setCreating(false)
    }
  }

  const handleClose = () => {
    if (!creating) onClose()
  }

  // Only offer the choice once there's something in the box worth keeping.
  const hasDescription = description.trim().length > 0

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { borderRadius: 2, bgcolor: 'background.paper' } }}
    >
      <DialogTitle
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PlaylistAddIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            {t('playlists.createFromSuggestionsTitle')}
          </Typography>
        </Box>
        <IconButton onClick={handleClose} disabled={creating} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Name input */}
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="subtitle2" color="text.secondary">
              {t('playlists.playlistName')}
            </Typography>
            <Tooltip title={t('playlists.tooltipGenerateName')}>
              <span>
                <IconButton
                  size="small"
                  onClick={handleGenerateName}
                  disabled={generatingName || selectedItems.length === 0}
                  color="primary"
                >
                  {generatingName ? (
                    <CircularProgress size={20} color="inherit" />
                  ) : (
                    <AutoAwesomeIcon fontSize="small" />
                  )}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
          <TextField
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('playlists.namePlaceholder')}
            disabled={creating}
            size="small"
          />
        </Box>

        {/* Description input */}
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="subtitle2" color="text.secondary">
              {t('playlists.descriptionOptional')}
            </Typography>
            <Tooltip
              title={t(
                hasDescription
                  ? 'playlists.tooltipGenerateDescriptionChoose'
                  : 'playlists.tooltipGenerateDescription'
              )}
            >
              <span>
                <IconButton
                  size="small"
                  onClick={(e) =>
                    hasDescription
                      ? setDescriptionMenuAnchor(e.currentTarget)
                      : handleGenerateDescription()
                  }
                  disabled={generatingDescription || selectedItems.length === 0}
                  color="primary"
                >
                  {generatingDescription ? (
                    <CircularProgress size={20} color="inherit" />
                  ) : (
                    <AutoAwesomeIcon fontSize="small" />
                  )}
                </IconButton>
                <Menu
                  anchorEl={descriptionMenuAnchor}
                  open={Boolean(descriptionMenuAnchor)}
                  onClose={() => setDescriptionMenuAnchor(null)}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                >
                  <MenuItem
                    onClick={() => {
                      setDescriptionMenuAnchor(null)
                      handleGenerateDescription(true)
                    }}
                  >
                    {t('playlists.aiDescriptionBuildOnNotes')}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setDescriptionMenuAnchor(null)
                      handleGenerateDescription(false)
                    }}
                  >
                    {t('playlists.aiDescriptionStartFresh')}
                  </MenuItem>
                </Menu>
              </span>
            </Tooltip>
          </Box>
          {/* Grows with the text: a generated description runs past two rows, and this box is
              also where a hand-written brief gets typed before asking for a rewrite. */}
          <TextField
            fullWidth
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('playlists.descriptionPlaceholder')}
            multiline
            minRows={2}
            maxRows={10}
            disabled={creating}
            size="small"
          />
        </Box>

        {/* Item checklist (all selected by default; deselect to exclude) */}
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
          {t('playlists.itemsSelected', { count: selectedItems.length })}
        </Typography>
        <Box
          sx={{
            maxHeight: 240,
            overflowY: 'auto',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          {items.map((item) => {
            const checked = selectedIds.has(item.id)
            return (
              <Box
                key={item.id}
                onClick={() => toggleItem(item.id)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1,
                  py: 0.5,
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
                }}
              >
                <Checkbox checked={checked} size="small" sx={{ p: 0.5 }} />
                <Box
                  sx={{
                    width: 32,
                    height: 48,
                    flexShrink: 0,
                    borderRadius: 0.5,
                    overflow: 'hidden',
                    bgcolor: 'rgba(0,0,0,0.3)',
                  }}
                >
                  {item.image && (
                    <img
                      src={getProxiedImageUrl(item.image)}
                      alt={item.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {item.name}
                  </Typography>
                  {item.subtitle && (
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                      {item.subtitle}
                    </Typography>
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={creating}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={creating || !name.trim() || selectedItems.length === 0}
          startIcon={creating ? <CircularProgress size={16} color="inherit" /> : <PlaylistAddIcon />}
        >
          {creating ? t('playlists.creating') : t('playlists.createPlaylist')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
