import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Card,
  CardActionArea,
  Box,
  Typography,
  Chip,
  IconButton,
  CircularProgress,
  Tooltip,
  Skeleton,
  Button,
  alpha,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import RefreshIcon from '@mui/icons-material/Refresh'
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay'
import MovieIcon from '@mui/icons-material/Movie'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { getProxiedImageUrl } from '@aperture/ui'
import type { Channel, PlaylistItem } from '../types'

interface PlaylistCardProps {
  channel: Channel
  generatingChannelId: string | null
  onEdit: (channel: Channel) => void
  onDelete: (channelId: string, channelName: string) => void
  onGenerate: (channelId: string) => void
  onView: (channel: Channel) => void
  i18nNamespace?: string
}

export function PlaylistCard({
  channel,
  generatingChannelId,
  onEdit,
  onDelete,
  onGenerate,
  onView,
  i18nNamespace = 'playlists',
}: PlaylistCardProps) {
  const { t, i18n } = useTranslation()
  const pt = (key: string, options?: Record<string, unknown>) => t(`${i18nNamespace}.${key}`, options)
  const [previewItems, setPreviewItems] = useState<PlaylistItem[]>([])
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [itemCount, setItemCount] = useState<number | null>(null)

  // AI-written descriptions run long, so the card clamps them. Measured rather than guessed from
  // a character count: the same card is much narrower on a phone than in the 3-up desktop grid.
  const descriptionRef = useRef<HTMLSpanElement>(null)
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const [descriptionOverflowing, setDescriptionOverflowing] = useState(false)

  const isGenerating = generatingChannelId === channel.id
  // The output lives in playlist_id or collection_id depending on the channel's target.
  const outputId = channel.output_type === 'collection' ? channel.collection_id : channel.playlist_id
  const hasPlaylist = !!outputId

  // Fetch preview items when the card mounts (if the output has been generated)
  useEffect(() => {
    if (!outputId) return

    const fetchPreview = async () => {
      setLoadingPreview(true)
      try {
        const response = await fetch(`/api/channels/${channel.id}/items`, {
          credentials: 'include',
        })
        if (response.ok) {
          const data = await response.json()
          setPreviewItems((data.items || []).slice(0, 5))
          setItemCount(data.items?.length || 0)
        }
      } catch {
        // Silent fail - preview is nice to have
      } finally {
        setLoadingPreview(false)
      }
    }

    fetchPreview()
  }, [channel.id, outputId, channel.last_generated_at])

  // Skipped while expanded — nothing is clamped then, and the last measurement is what keeps the
  // "show less" control on screen.
  useEffect(() => {
    if (descriptionExpanded) return
    const element = descriptionRef.current
    if (!element) return

    const measure = () => setDescriptionOverflowing(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [descriptionExpanded, channel.description])

  const handleCardClick = () => {
    if (hasPlaylist) {
      onView(channel)
    }
  }

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onEdit(channel)
  }

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete(channel.id, channel.name)
  }

  const handleGenerateClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onGenerate(channel.id)
  }

  return (
    <Card
      sx={{
        backgroundColor: 'background.paper',
        borderRadius: 3,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'transform 0.2s, box-shadow 0.2s',
        '&:hover': {
          transform: hasPlaylist ? 'translateY(-4px)' : 'none',
          boxShadow: hasPlaylist ? 8 : 1,
        },
      }}
    >
      {/* Poster Preview Header */}
      <CardActionArea
        onClick={handleCardClick}
        disabled={!hasPlaylist}
        sx={{ 
          flexGrow: 1, 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'stretch',
          borderRadius: '12px 12px 0 0',
        }}
      >
        <Box
          sx={{
            height: 140,
            position: 'relative',
            background: (theme) =>
              `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.primary.dark, 0.2)} 100%)`,
            overflow: 'hidden',
            borderRadius: '12px 12px 0 0',
          }}
        >
          {loadingPreview ? (
            <Box display="flex" gap={0.5} p={1} height="100%">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton
                  key={i}
                  variant="rectangular"
                  sx={{
                    flex: 1,
                    height: '100%',
                    borderRadius: 1,
                  }}
                />
              ))}
            </Box>
          ) : previewItems.length > 0 ? (
            <Box
              sx={{
                display: 'flex',
                gap: 0.5,
                p: 1,
                height: '100%',
              }}
            >
              {previewItems.map((item, index) => (
                <Box
                  key={item.id}
                  sx={{
                    flex: 1,
                    height: '100%',
                    borderRadius: 1,
                    overflow: 'hidden',
                    position: 'relative',
                    opacity: 1 - index * 0.05,
                  }}
                >
                  {item.posterUrl ? (
                    <Box
                      component="img"
                      src={getProxiedImageUrl(item.posterUrl)}
                      alt={item.title}
                      sx={{
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
                        bgcolor: 'action.hover',
                      }}
                    >
                      <MovieIcon sx={{ color: 'text.disabled' }} />
                    </Box>
                  )}
                </Box>
              ))}
              {/* Show more indicator */}
              {itemCount && itemCount > 5 && (
                <Box
                  sx={{
                    position: 'absolute',
                    right: 8,
                    bottom: 8,
                    bgcolor: 'rgba(0,0,0,0.7)',
                    color: 'white',
                    px: 1,
                    py: 0.25,
                    borderRadius: 1,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                  }}
                >
                  +{itemCount - 5} more
                </Box>
              )}
            </Box>
          ) : (
            <Box
              sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
              }}
            >
              {hasPlaylist ? (
                <>
                  <PlaylistPlayIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
                  <Typography variant="caption" color="text.disabled">
                    {pt('cardEmptyPlaylist')}
                  </Typography>
                </>
              ) : (
                <>
                  <AutoAwesomeIcon sx={{ fontSize: 40, color: 'primary.main', opacity: 0.5 }} />
                  <Typography variant="caption" color="text.secondary">
                    {pt('cardGeneratePrompt')}
                  </Typography>
                </>
              )}
            </Box>
          )}

          {/* Overlay for generating state */}
          {isGenerating && (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                bgcolor: 'rgba(0,0,0,0.6)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
              }}
            >
              <CircularProgress size={32} sx={{ color: 'white' }} />
              <Typography variant="caption" sx={{ color: 'white' }}>
                {pt('cardGenerating')}
              </Typography>
            </Box>
          )}
        </Box>

        {/* Content */}
        <Box sx={{ p: 2, flexGrow: 1 }}>
          <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={1} mb={1}>
            <Typography variant="h6" fontWeight={600} sx={{ lineHeight: 1.3 }}>
              {channel.name}
            </Typography>
            {itemCount !== null && (
              <Chip
                label={pt('cardMoviesCount', { count: itemCount })}
                size="small"
                sx={{
                  bgcolor: 'action.selected',
                  fontWeight: 500,
                  fontSize: '0.7rem',
                  height: 22,
                }}
              />
            )}
          </Box>

          {channel.description && (
            <Box mb={1.5}>
              <Typography
                ref={descriptionRef}
                variant="body2"
                color="text.secondary"
                sx={{
                  lineHeight: 1.4,
                  ...(descriptionExpanded
                    ? {}
                    : {
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }),
                }}
              >
                {channel.description}
              </Typography>
              {/* Only shown once something is actually cut off. stopPropagation/preventDefault so
                  reading the blurb doesn't also open the card's view dialog. */}
              {(descriptionOverflowing || descriptionExpanded) && (
                <Button
                  size="small"
                  component="span"
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation()
                    e.preventDefault()
                    setDescriptionExpanded((prev) => !prev)
                  }}
                  endIcon={
                    <ExpandMoreIcon
                      sx={{
                        fontSize: 14,
                        transition: 'transform 0.2s',
                        transform: descriptionExpanded ? 'rotate(180deg)' : 'none',
                      }}
                    />
                  }
                  sx={{ minWidth: 0, px: 0.5, py: 0, fontSize: 11, textTransform: 'none' }}
                >
                  {descriptionExpanded ? t('common.showLess') : t('common.showMore')}
                </Button>
              )}
            </Box>
          )}

          {/* Genres */}
          {channel.genre_filters && channel.genre_filters.length > 0 && (
            <Box display="flex" gap={0.5} flexWrap="wrap" mb={1}>
              {channel.genre_filters.slice(0, 3).map((genre) => (
                <Chip
                  key={genre}
                  label={genre}
                  size="small"
                  variant="outlined"
                  sx={{ height: 20, fontSize: '0.7rem' }}
                />
              ))}
              {channel.genre_filters.length > 3 && (
                <Chip
                  label={`+${channel.genre_filters.length - 3}`}
                  size="small"
                  sx={{ height: 20, fontSize: '0.7rem' }}
                />
              )}
            </Box>
          )}

          {/* Example movies indicator */}
          {channel.example_movie_ids && channel.example_movie_ids.length > 0 && (
            <Typography variant="caption" color="text.secondary" display="flex" alignItems="center" gap={0.5}>
              <MovieIcon sx={{ fontSize: 14 }} />
              {pt('cardSeedMovies', { count: channel.example_movie_ids.length })}
            </Typography>
          )}
        </Box>
      </CardActionArea>

      {/* Action Bar */}
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderTop: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          bgcolor: 'action.hover',
        }}
      >
        <Box display="flex" alignItems="center" gap={1}>
          {channel.last_generated_at ? (
            <Typography variant="caption" color="text.secondary">
              {pt('cardUpdated', {
                date: new Date(channel.last_generated_at).toLocaleDateString(i18n.language),
              })}
            </Typography>
          ) : (
            <Typography variant="caption" color="warning.main">
              {pt('cardNotGenerated')}
            </Typography>
          )}
        </Box>

        <Box display="flex" gap={0.5}>
          <Tooltip title={hasPlaylist ? pt('tooltipRefreshPlaylist') : pt('tooltipGeneratePlaylist')}>
            <IconButton
              size="small"
              onClick={handleGenerateClick}
              disabled={isGenerating}
              color="primary"
            >
              {isGenerating ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <RefreshIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip title={pt('tooltipEditSettings')}>
            <IconButton size="small" onClick={handleEditClick}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={pt('tooltipDeletePlaylist')}>
            <IconButton size="small" onClick={handleDeleteClick} color="error">
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </Card>
  )
}
