import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Alert,
  CircularProgress,
  Slider,
  Chip,
  Fade,
  IconButton,
  Tooltip,
} from '@mui/material'
import TheaterComedyIcon from '@mui/icons-material/TheaterComedy'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@mui/material/styles'

export interface GenreWeight {
  id: string
  genre: string
  weight: number
}

/**
 * Genres detected by an analyze run, pushed down from whichever media-type
 * sub-tab ran it. Both sub-tabs write the same rows, so either one's result is
 * the current state of this card.
 */
export interface GenreWeightingUpdate {
  genres: GenreWeight[]
  newGenres: string[]
}

interface GenreWeightingCardProps {
  /** Latest analyze result, or null if none has run this session. */
  update?: GenreWeightingUpdate | null
}

/**
 * Genre weights, which are stored per user and NOT per media type
 * (`user_genre_weights` is unique on `(user_id, genre)` alone, unlike
 * `user_franchise_preferences`, which carries a `media_type`).
 *
 * This card used to live inside WatcherIdentitySection, so it rendered once
 * under Movies and once under TV Series while both panels read and wrote the
 * same rows — moving a slider under Movies silently moved the identical slider
 * under TV Series. The counts gave it away: franchises showed different totals
 * per sub-tab, genres showed the same total twice. It is now rendered once,
 * outside the sub-tabs, which is what the data has always been.
 */
export function GenreWeightingCard({ update }: GenreWeightingCardProps) {
  const { t } = useTranslation()
  const theme = useTheme()

  const [genres, setGenres] = useState<GenreWeight[]>([])
  const [newGenres, setNewGenres] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [savingSlider, setSavingSlider] = useState<string | null>(null)

  const genreRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const sliderDebounceRef = useRef<Record<string, NodeJS.Timeout>>({})

  const accentColor = theme.palette.info.main

  const fetchGenres = useCallback(async () => {
    setLoading(true)
    try {
      // No mediaType: the endpoint's genre list is unfiltered by design, since
      // the rows it reads have no media type to filter on.
      const response = await fetch('/api/settings/taste-profile', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        setGenres(data.genres || [])
      }
    } catch {
      // Leave the list empty; the empty-state hint already tells the user what
      // to do, and this card is not where a profile fetch failure should shout.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchGenres()
  }, [fetchGenres])

  // Adopt an analyze result rather than refetching — the rebuild response
  // already carries the full genre list.
  useEffect(() => {
    if (!update) return
    setGenres(update.genres)
    setNewGenres(update.newGenres)
  }, [update])

  useEffect(() => {
    const timeouts = sliderDebounceRef.current
    return () => {
      for (const timeout of Object.values(timeouts)) clearTimeout(timeout)
    }
  }, [])

  const handleSliderChange = (id: string, genre: string, value: number) => {
    if (sliderDebounceRef.current[id]) {
      clearTimeout(sliderDebounceRef.current[id])
    }

    // Interacting with a highlighted genre acknowledges it.
    setNewGenres((prev) => (prev.includes(genre) ? prev.filter((g) => g !== genre) : prev))
    setGenres((prev) => prev.map((g) => (g.id === id ? { ...g, weight: value } : g)))

    sliderDebounceRef.current[id] = setTimeout(async () => {
      setSavingSlider(id)
      try {
        await fetch('/api/settings/taste-profile/genres', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ genres: [{ genre, weight: value }] }),
        })
      } catch {
        // Silent fail, matching the franchise sliders next door.
      } finally {
        setSavingSlider(null)
      }
    }, 500)
  }

  const handleDelete = async (genre: string) => {
    setGenres((prev) => prev.filter((g) => g.genre !== genre))
    setNewGenres((prev) => prev.filter((g) => g !== genre))

    try {
      await fetch(`/api/settings/taste-profile/genres/${encodeURIComponent(genre)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
    } catch {
      void fetchGenres()
    }
  }

  const scrollToGenre = (genre: string) => {
    genreRefs.current[genre]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <Card sx={{ backgroundColor: 'background.default', borderRadius: 2 }}>
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
          <Box display="flex" alignItems="center" gap={1}>
            <TheaterComedyIcon sx={{ color: accentColor }} fontSize="small" />
            <Typography variant="h6" fontWeight={600}>
              {t('watcherIdentity.genreWeightingTitle', { count: genres.length })}
            </Typography>
          </Box>
          <Fade in={!!savingSlider}>
            <Typography variant="caption" color="text.secondary">
              {t('watcherIdentity.savingSlider')}
            </Typography>
          </Fade>
        </Box>

        {/* Explainer */}
        <Box
          sx={{
            bgcolor: 'action.hover',
            borderRadius: 1,
            p: 1.5,
            mb: 2,
            borderLeft: '3px solid',
            borderColor: accentColor,
          }}
        >
          <Typography variant="caption" color="text.secondary" display="block">
            {t('watcherIdentity.genreExplainerLead')}{' '}
            <strong>{t('watcherIdentity.weightBoost')}</strong>
            {t('watcherIdentity.genreExplainerAfterBoost')}
            <strong>{t('watcherIdentity.weightHide')}</strong>
            {t('watcherIdentity.genreExplainerAfterHide')}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
            <strong>{t('watcherIdentity.genreSharedNote')}</strong>
          </Typography>
        </Box>

        {/* Legend */}
        <Box display="flex" justifyContent="space-between" mb={2} px={1}>
          <Typography variant="caption" color="text.secondary">
            {t('watcherIdentity.weightHide')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('watcherIdentity.weightNormal')}
          </Typography>
          <Typography variant="caption" color="info.main">
            {t('watcherIdentity.weightBoost')}
          </Typography>
        </Box>

        {/* Scrollable slider list */}
        <Box sx={{ maxHeight: 350, overflow: 'auto', pr: 1 }}>
          {loading ? (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress size={24} />
            </Box>
          ) : genres.length > 0 ? (
            [...genres]
              .sort((a, b) => a.genre.localeCompare(b.genre))
              .map((genre) => {
                const isNew = newGenres.includes(genre.genre)
                return (
                  <Box
                    key={genre.id}
                    ref={(el: HTMLDivElement | null) => {
                      genreRefs.current[genre.genre] = el
                    }}
                    sx={{
                      mb: 2,
                      p: isNew ? 1 : 0,
                      borderRadius: 1,
                      border: isNew ? '2px solid' : 'none',
                      borderColor: isNew ? theme.palette.warning.main : 'transparent',
                      animation: isNew ? 'pulse 2s infinite' : 'none',
                      '@keyframes pulse': {
                        '0%, 100%': { borderColor: theme.palette.warning.main },
                        '50%': { borderColor: theme.palette.warning.light },
                      },
                    }}
                  >
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                      <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="body2" fontWeight={500}>
                          {genre.genre}
                        </Typography>
                        {isNew && (
                          <Chip
                            size="small"
                            label={t('watcherIdentity.chipNew')}
                            sx={{
                              bgcolor: theme.palette.warning.main,
                              color: 'white',
                              fontSize: '0.6rem',
                              height: 18,
                              fontWeight: 700,
                            }}
                          />
                        )}
                      </Box>
                      <Box display="flex" alignItems="center" gap={0.5}>
                        <Chip
                          size="small"
                          label={
                            genre.weight > 1.3
                              ? t('watcherIdentity.weightBoost')
                              : genre.weight < 0.7
                                ? t('watcherIdentity.weightLess')
                                : t('watcherIdentity.weightNormal')
                          }
                          sx={{
                            bgcolor:
                              genre.weight > 1.3
                                ? 'info.main'
                                : genre.weight < 0.7
                                  ? 'action.hover'
                                  : 'action.selected',
                            color: genre.weight > 1.3 ? 'white' : 'text.primary',
                            fontSize: '0.7rem',
                            height: 20,
                          }}
                        />
                        <Tooltip title={t('watcherIdentity.removeFromListTooltip')}>
                          <IconButton
                            size="small"
                            onClick={() => void handleDelete(genre.genre)}
                            sx={{
                              p: 0.25,
                              opacity: 0.5,
                              '&:hover': { opacity: 1, color: 'error.main' },
                            }}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>
                    <Slider
                      value={genre.weight}
                      onChange={(_, value) =>
                        handleSliderChange(genre.id, genre.genre, value as number)
                      }
                      min={0}
                      max={2}
                      step={0.1}
                      size="small"
                      sx={{
                        '& .MuiSlider-track': {
                          background: `linear-gradient(to right, #9ca3af, ${accentColor})`,
                        },
                        '& .MuiSlider-rail': {
                          background: `linear-gradient(to right, #374151, #9ca3af, ${accentColor})`,
                          opacity: 0.3,
                        },
                      }}
                    />
                  </Box>
                )
              })
          ) : (
            <Typography variant="body2" color="text.secondary" textAlign="center" py={4}>
              {t('watcherIdentity.noGenresHint', {
                action: t('watcherIdentity.analyzeWatchHistory'),
              })}
            </Typography>
          )}
        </Box>

        {/* New items alert */}
        {newGenres.length > 0 && (
          <Alert severity="info" icon={<AutoFixHighIcon />} sx={{ mt: 2 }}>
            <Typography variant="body2" fontWeight={500} mb={1}>
              {t('watcherIdentity.newGenresDetected', { count: newGenres.length })}
            </Typography>
            <Box display="flex" gap={0.5} flexWrap="wrap">
              {newGenres.map((name) => (
                <Chip
                  key={name}
                  label={name}
                  size="small"
                  onClick={() => scrollToGenre(name)}
                  sx={{
                    cursor: 'pointer',
                    bgcolor: theme.palette.warning.main,
                    color: 'white',
                    '&:hover': { bgcolor: theme.palette.warning.dark },
                  }}
                />
              ))}
            </Box>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
