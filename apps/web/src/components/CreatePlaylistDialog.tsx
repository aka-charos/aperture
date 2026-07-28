import { useState, useCallback } from 'react'
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
  Menu,
  MenuItem,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd'
import { getProxiedImageUrl } from '@aperture/ui'

interface GraphNode {
  id: string
  title: string
  year: number | null
  type: 'movie' | 'series'
  poster_url: string | null
}

interface CreatePlaylistDialogProps {
  open: boolean
  onClose: () => void
  nodes: GraphNode[]
  sourceItemId?: string
  sourceItemType?: 'movie' | 'series'
  onSuccess?: () => void
}

export function CreatePlaylistDialog({
  open,
  onClose,
  nodes,
  sourceItemId,
  sourceItemType,
  onSuccess,
}: CreatePlaylistDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [generatingName, setGeneratingName] = useState(false)
  const [generatingDescription, setGeneratingDescription] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameMenuAnchor, setNameMenuAnchor] = useState<HTMLElement | null>(null)
  const [descriptionMenuAnchor, setDescriptionMenuAnchor] = useState<HTMLElement | null>(null)

  // Separate nodes by type
  const movieIds = nodes.filter((n) => n.type === 'movie').map((n) => n.id)
  const seriesIds = nodes.filter((n) => n.type === 'series').map((n) => n.id)

  /** `useNotes` keeps the drafted name as the thing to sharpen — see the description below. */
  const handleGenerateName = useCallback(
    async (useNotes = false) => {
      const notes = useNotes ? name.trim() : ''
      setGeneratingName(true)
      setError(null)

      try {
        const response = await fetch('/api/graph-playlists/ai-name', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ movieIds, seriesIds, userNotes: notes || undefined }),
        })

        if (!response.ok) {
          throw new Error('Failed to generate name')
        }

        const data = await response.json()
        setName(data.name)
      } catch {
        setError(t('playlists.errGenerateName'))
      } finally {
        setGeneratingName(false)
      }
    },
    [movieIds, seriesIds, name, t]
  )

  /**
   * The result always replaces the box, so `useNotes` decides whether what's in there survives:
   * it feeds the text back as the strongest signal in the prompt, keeping an angle the graph
   * exploration would never surface on its own. Off — the pre-existing behaviour — ignores the
   * box, which is the only way to get a different take once it already holds a generated draft.
   */
  const handleGenerateDescription = useCallback(
    async (useNotes = false) => {
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
            userNotes: notes || undefined,
          }),
        })

        if (!response.ok) {
          throw new Error('Failed to generate description')
        }

        const data = await response.json()
        setDescription(data.description)
      } catch {
        setError(t('playlists.errGenerateDescription'))
      } finally {
        setGeneratingDescription(false)
      }
    },
    [movieIds, seriesIds, name, description, t]
  )

  const handleCreate = useCallback(async () => {
    if (!name.trim()) {
      setError(t('playlists.errNameRequired'))
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
          sourceItemId,
          sourceItemType,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create playlist')
      }

      // Success - close dialog and notify parent
      onClose()
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create playlist')
    } finally {
      setCreating(false)
    }
  }, [name, description, movieIds, seriesIds, sourceItemId, sourceItemType, onClose, onSuccess, t])

  const handleClose = () => {
    if (!creating) {
      setName('')
      setDescription('')
      setError(null)
      setNameMenuAnchor(null)
      setDescriptionMenuAnchor(null)
      onClose()
    }
  }

  // Each sparkle only offers the choice once its own box has something worth keeping.
  const hasName = name.trim().length > 0
  const hasDescription = description.trim().length > 0

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          bgcolor: 'background.paper',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PlaylistAddIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            {t('playlists.createFromGraphTitle')}
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
            <Tooltip
              title={t(
                hasName ? 'playlists.tooltipGenerateNameChoose' : 'playlists.tooltipGenerateName'
              )}
            >
              <span>
                <IconButton
                  size="small"
                  onClick={(e) =>
                    hasName ? setNameMenuAnchor(e.currentTarget) : handleGenerateName()
                  }
                  disabled={generatingName || nodes.length === 0}
                  color="primary"
                >
                  {generatingName ? (
                    <CircularProgress size={20} color="inherit" />
                  ) : (
                    <AutoAwesomeIcon fontSize="small" />
                  )}
                </IconButton>
                <Menu
                  anchorEl={nameMenuAnchor}
                  open={Boolean(nameMenuAnchor)}
                  onClose={() => setNameMenuAnchor(null)}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                >
                  <MenuItem
                    onClick={() => {
                      setNameMenuAnchor(null)
                      handleGenerateName(true)
                    }}
                  >
                    {t('playlists.aiBuildOnNotes')}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setNameMenuAnchor(null)
                      handleGenerateName(false)
                    }}
                  >
                    {t('playlists.aiStartFresh')}
                  </MenuItem>
                </Menu>
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
                  disabled={generatingDescription || nodes.length === 0}
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
                    {t('playlists.aiBuildOnNotes')}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setDescriptionMenuAnchor(null)
                      handleGenerateDescription(false)
                    }}
                  >
                    {t('playlists.aiStartFresh')}
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

        {/* Items preview */}
        <Box>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            {t('playlists.itemsWillBeAdded', { count: nodes.length })}
          </Typography>
          <Box
            sx={{
              display: 'flex',
              gap: 1,
              overflowX: 'auto',
              pb: 1,
              '&::-webkit-scrollbar': {
                height: 6,
              },
              '&::-webkit-scrollbar-track': {
                bgcolor: 'rgba(255,255,255,0.1)',
                borderRadius: 3,
              },
              '&::-webkit-scrollbar-thumb': {
                bgcolor: 'rgba(255,255,255,0.3)',
                borderRadius: 3,
              },
            }}
          >
            {nodes.slice(0, 12).map((node) => (
              <Tooltip key={node.id} title={`${node.title} (${node.year ?? t('playlists.naYear')})`}>
                <Box
                  sx={{
                    flexShrink: 0,
                    width: 60,
                    height: 90,
                    borderRadius: 1,
                    overflow: 'hidden',
                    bgcolor: 'rgba(0,0,0,0.3)',
                  }}
                >
                  {node.poster_url ? (
                    <img
                      src={getProxiedImageUrl(node.poster_url)}
                      alt={node.title}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                  ) : (
                    <Box
                      sx={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.6rem',
                        color: 'text.secondary',
                        textAlign: 'center',
                        p: 0.5,
                      }}
                    >
                      {node.title}
                    </Box>
                  )}
                </Box>
              </Tooltip>
            ))}
            {nodes.length > 12 && (
              <Box
                sx={{
                  flexShrink: 0,
                  width: 60,
                  height: 90,
                  borderRadius: 1,
                  bgcolor: 'rgba(255,255,255,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  +{nodes.length - 12}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={creating}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={creating || !name.trim() || nodes.length === 0}
          startIcon={creating ? <CircularProgress size={16} color="inherit" /> : <PlaylistAddIcon />}
        >
          {creating ? t('playlists.creating') : t('playlists.createPlaylist')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

