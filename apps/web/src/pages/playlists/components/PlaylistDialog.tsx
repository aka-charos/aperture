import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  TextField,
  Chip,
  IconButton,
  Autocomplete,
  CircularProgress,
  InputAdornment,
  Avatar,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Button,
  Switch,
  FormControlLabel,
  alpha,
  useTheme,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import CloseIcon from '@mui/icons-material/Close'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay'
import CategoryIcon from '@mui/icons-material/Category'
import TuneIcon from '@mui/icons-material/Tune'
import TitleIcon from '@mui/icons-material/Title'
import DescriptionIcon from '@mui/icons-material/Description'
import AddIcon from '@mui/icons-material/Add'
import { getProxiedImageUrl } from '@aperture/ui'
import { useMediaSearch } from '../hooks'
import { withServerMessageDetail } from '../../../lib/withServerMessageDetail'
import type { Channel, MediaSummary, MediaType, FormData, SnackbarState } from '../types'
import type { Theme } from '@mui/material'
import type { TFunction } from 'i18next'

/**
 * The AI routes answer a failure with a sentence worth reading ("Your Google API key is missing
 * or invalid. Check your API key in Settings > AI."). Show that instead of the flat fallback —
 * without it, the only signal is "Failed to generate name" and the button gets re-clicked.
 */
async function aiFailureMessage(
  t: TFunction,
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const data = await response.json()
    return typeof data?.error === 'string' && data.error
      ? withServerMessageDetail(t, data.error)
      : fallback
  } catch {
    return fallback
  }
}

// AI button component - defined outside to prevent re-renders
function AIButton({
  onClick,
  loading,
  disabled,
  tooltip,
  theme,
}: {
  onClick: () => void
  loading: boolean
  disabled: boolean
  tooltip: string
  theme: Theme
}) {
  return (
    <Tooltip title={tooltip}>
      <span>
        <IconButton
          size="small"
          onClick={onClick}
          disabled={loading || disabled}
          sx={{
            bgcolor: alpha(theme.palette.primary.main, 0.1),
            color: 'primary.main',
            '&:hover': {
              bgcolor: 'primary.main',
              color: 'white',
            },
            '&.Mui-disabled': {
              bgcolor: alpha(theme.palette.action.disabled, 0.1),
            },
            transition: 'all 0.2s',
          }}
        >
          {loading ? (
            <CircularProgress size={18} color="inherit" />
          ) : (
            <AutoAwesomeIcon fontSize="small" />
          )}
        </IconButton>
      </span>
    </Tooltip>
  )
}

// Section wrapper component - defined outside to prevent re-renders
function Section({
  icon,
  title,
  subtitle,
  children,
  aiButton,
  theme,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  children: React.ReactNode
  aiButton?: React.ReactNode
  theme: Theme
}) {
  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 2,
        bgcolor: alpha(theme.palette.background.default, 0.5),
        border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
      }}
    >
      <Box display="flex" alignItems="flex-start" justifyContent="space-between" mb={1.5}>
        <Box display="flex" alignItems="center" gap={1.5}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: 1,
              bgcolor: alpha(theme.palette.primary.main, 0.15),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'primary.main',
            }}
          >
            {icon}
          </Box>
          <Box>
            <Typography variant="subtitle2" fontWeight={600}>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
        </Box>
        {aiButton}
      </Box>
      {children}
    </Box>
  )
}

/**
 * Search-and-select strip for a channel's seed titles. Identical behaviour for movies and series —
 * only the endpoint (via the caller's search hook) and the placeholder icons differ.
 */
function SeedPicker({
  searchPlaceholder,
  query,
  onQueryChange,
  searching,
  results,
  selected,
  onAdd,
  onRemove,
  fallbackIcon,
  emptyPosterIcon,
  theme,
}: {
  searchPlaceholder: string
  query: string
  onQueryChange: (value: string) => void
  searching: boolean
  results: MediaSummary[]
  selected: MediaSummary[]
  onAdd: (item: MediaSummary) => void
  onRemove: (itemId: string) => void
  fallbackIcon: React.ReactNode
  emptyPosterIcon: React.ReactNode
  theme: Theme
}) {
  return (
    <>
      <TextField
        fullWidth
        size="small"
        placeholder={searchPlaceholder}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" color="action" />
            </InputAdornment>
          ),
          endAdornment: searching ? (
            <InputAdornment position="end">
              <CircularProgress size={16} />
            </InputAdornment>
          ) : null,
        }}
      />

      {/* Search Results */}
      {results.length > 0 && (
        <Box
          sx={{
            mt: 1,
            maxHeight: 180,
            overflow: 'auto',
            borderRadius: 1,
            bgcolor: 'background.default',
          }}
        >
          {results.map((item) => (
            <Box
              key={item.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                p: 1,
                cursor: 'pointer',
                borderRadius: 1,
                '&:hover': { bgcolor: 'action.hover' },
              }}
              onClick={() => onAdd(item)}
            >
              <Avatar
                src={getProxiedImageUrl(item.poster_url)}
                variant="rounded"
                sx={{ width: 36, height: 54 }}
              >
                {fallbackIcon}
              </Avatar>
              <Box flex={1}>
                <Typography variant="body2" fontWeight={500}>
                  {item.title}
                </Typography>
                {item.year && (
                  <Typography variant="caption" color="text.secondary">
                    {item.year}
                  </Typography>
                )}
              </Box>
              <IconButton size="small" color="primary">
                <AddIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      {/* Selected - Visual Strip */}
      {selected.length > 0 && (
        <Box
          sx={{
            mt: 2,
            display: 'flex',
            gap: 1,
            overflowX: 'auto',
            pb: 1,
            '&::-webkit-scrollbar': { height: 4 },
            '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
            '&::-webkit-scrollbar-thumb': {
              bgcolor: alpha(theme.palette.text.primary, 0.2),
              borderRadius: 2,
            },
          }}
        >
          {selected.map((item) => (
            <Tooltip key={item.id} title={`${item.title}${item.year ? ` (${item.year})` : ''}`}>
              <Box
                sx={{
                  position: 'relative',
                  flexShrink: 0,
                  width: 52,
                  height: 78,
                  borderRadius: 1,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  '&:hover .remove-btn': { opacity: 1 },
                }}
                onClick={() => onRemove(item.id)}
              >
                {item.poster_url ? (
                  <img
                    src={getProxiedImageUrl(item.poster_url)}
                    alt={item.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <Box
                    sx={{
                      width: '100%',
                      height: '100%',
                      bgcolor: 'action.hover',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {emptyPosterIcon}
                  </Box>
                )}
                <Box
                  className="remove-btn"
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    bgcolor: 'rgba(0,0,0,0.6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0,
                    transition: 'opacity 0.2s',
                  }}
                >
                  <CloseIcon sx={{ color: 'white', fontSize: 20 }} />
                </Box>
              </Box>
            </Tooltip>
          ))}
        </Box>
      )}
    </>
  )
}

interface PlaylistDialogProps {
  open: boolean
  editingChannel: Channel | null
  formData: FormData
  setFormData: React.Dispatch<React.SetStateAction<FormData>>
  availableGenres: string[]
  loadingGenres: boolean
  setSnackbar: React.Dispatch<React.SetStateAction<SnackbarState>>
  onClose: () => void
  onSubmit: () => void
  onAddExampleMovie: (movie: MediaSummary) => void
  onRemoveExampleMovie: (movieId: string) => void
  onAddExampleSeries: (series: MediaSummary) => void
  onRemoveExampleSeries: (seriesId: string) => void
  i18nNamespace?: string
}

/** The three selectable media combinations, mapped to the channel's media_types array. */
const MEDIA_TYPE_CHOICES: { value: string; mediaTypes: MediaType[] }[] = [
  { value: 'movie', mediaTypes: ['movie'] },
  { value: 'series', mediaTypes: ['series'] },
  { value: 'both', mediaTypes: ['movie', 'series'] },
]

function mediaChoiceValue(mediaTypes: MediaType[]): string {
  const wantsMovies = mediaTypes.includes('movie')
  const wantsSeries = mediaTypes.includes('series')
  if (wantsMovies && wantsSeries) return 'both'
  return wantsSeries ? 'series' : 'movie'
}

export function PlaylistDialog({
  open,
  editingChannel,
  formData,
  setFormData,
  availableGenres,
  loadingGenres,
  setSnackbar,
  onClose,
  onSubmit,
  onAddExampleMovie,
  onRemoveExampleMovie,
  onAddExampleSeries,
  onRemoveExampleSeries,
  i18nNamespace = 'playlists',
}: PlaylistDialogProps) {
  const { t } = useTranslation()
  const pt = (key: string, options?: Record<string, unknown>) => t(`${i18nNamespace}.${key}`, options)
  const theme = useTheme()

  const showMovies = formData.mediaTypes.includes('movie')
  const showSeries = formData.mediaTypes.includes('series')

  // Seed search state, one debounced search per media type
  const {
    query: movieQuery,
    setQuery: setMovieQuery,
    results: movieResults,
    isSearching: searchingMovies,
    clear: clearMovieSearch,
  } = useMediaSearch('movie', { enabled: showMovies })
  const {
    query: seriesQuery,
    setQuery: setSeriesQuery,
    results: seriesResults,
    isSearching: searchingSeries,
    clear: clearSeriesSearch,
  } = useMediaSearch('series', { enabled: showSeries })

  // AI generation state
  const [generatingAIPreferences, setGeneratingAIPreferences] = useState(false)
  const [generatingAIName, setGeneratingAIName] = useState(false)
  const [generatingAIDescription, setGeneratingAIDescription] = useState(false)

  // Reset searches when dialog closes
  useEffect(() => {
    if (!open) {
      clearMovieSearch()
      clearSeriesSearch()
    }
  }, [open, clearMovieSearch, clearSeriesSearch])

  const handleAddMovie = (movie: MediaSummary) => {
    onAddExampleMovie(movie)
    clearMovieSearch()
  }

  const handleAddSeries = (series: MediaSummary) => {
    onAddExampleSeries(series)
    clearSeriesSearch()
  }

  const handleMediaTypeChange = (value: string | null) => {
    const choice = MEDIA_TYPE_CHOICES.find((c) => c.value === value)
    if (!choice) return
    setFormData({ ...formData, mediaTypes: choice.mediaTypes })
  }

  const canGenerate =
    formData.genreFilters.length > 0 ||
    formData.exampleMovies.length > 0 ||
    formData.exampleSeries.length > 0

  // Generate AI-powered text preferences
  const handleGenerateAIPreferences = async () => {
    if (!canGenerate) {
      setSnackbar({
        open: true,
        message: pt('snackbarNeedGenresOrMovies'),
        severity: 'error',
      })
      return
    }

    setGeneratingAIPreferences(true)
    try {
      const response = await fetch('/api/channels/ai-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          genres: formData.genreFilters,
          exampleMovieIds: formData.exampleMovies.map((m) => m.id),
          exampleSeriesIds: formData.exampleSeries.map((s) => s.id),
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setFormData({ ...formData, textPreferences: data.preferences })
        setSnackbar({ open: true, message: pt('snackbarAIPreferencesOk'), severity: 'success' })
      } else {
        setSnackbar({
          open: true,
          message: await aiFailureMessage(t, response, pt('snackbarAIPreferencesFail')),
          severity: 'error',
        })
      }
    } catch {
      setSnackbar({ open: true, message: pt('snackbarAIPreferencesFail'), severity: 'error' })
    } finally {
      setGeneratingAIPreferences(false)
    }
  }

  // Generate AI-powered playlist name
  const handleGenerateAIName = async () => {
    if (!canGenerate) {
      setSnackbar({
        open: true,
        message: pt('snackbarNeedGenresOrMovies'),
        severity: 'error',
      })
      return
    }

    setGeneratingAIName(true)
    try {
      const response = await fetch('/api/channels/ai-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          genres: formData.genreFilters,
          exampleMovieIds: formData.exampleMovies.map((m) => m.id),
          exampleSeriesIds: formData.exampleSeries.map((s) => s.id),
          textPreferences: formData.textPreferences || undefined,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setFormData({ ...formData, name: data.name })
        setSnackbar({ open: true, message: pt('snackbarAINameOk'), severity: 'success' })
      } else {
        setSnackbar({
          open: true,
          message: await aiFailureMessage(t, response, pt('snackbarAINameFail')),
          severity: 'error',
        })
      }
    } catch {
      setSnackbar({ open: true, message: pt('snackbarAINameFail'), severity: 'error' })
    } finally {
      setGeneratingAIName(false)
    }
  }

  // Generate AI-powered playlist description
  const handleGenerateAIDescription = async () => {
    if (!canGenerate) {
      setSnackbar({
        open: true,
        message: pt('snackbarNeedGenresOrMovies'),
        severity: 'error',
      })
      return
    }

    setGeneratingAIDescription(true)
    try {
      const response = await fetch('/api/channels/ai-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          genres: formData.genreFilters,
          exampleMovieIds: formData.exampleMovies.map((m) => m.id),
          exampleSeriesIds: formData.exampleSeries.map((s) => s.id),
          textPreferences: formData.textPreferences || undefined,
          playlistName: formData.name || undefined,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setFormData({ ...formData, description: data.description })
        setSnackbar({ open: true, message: pt('snackbarAIDescriptionOk'), severity: 'success' })
      } else {
        setSnackbar({
          open: true,
          message: await aiFailureMessage(t, response, pt('snackbarAIDescriptionFail')),
          severity: 'error',
        })
      }
    } catch {
      setSnackbar({ open: true, message: pt('snackbarAIDescriptionFail'), severity: 'error' })
    } finally {
      setGeneratingAIDescription(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          overflow: 'hidden',
          bgcolor: 'background.paper',
        },
      }}
    >
      {/* Gradient Header */}
      <Box
        sx={{
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.15)} 0%, ${alpha(theme.palette.secondary.main, 0.1)} 100%)`,
          p: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box display="flex" alignItems="center" gap={2}>
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: 2,
              bgcolor: alpha(theme.palette.primary.main, 0.2),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PlaylistPlayIcon sx={{ fontSize: 28, color: 'primary.main' }} />
          </Box>
          <Box>
            <Typography variant="h5" fontWeight={700}>
              {editingChannel ? pt('dialogEditTitle') : pt('dialogNewTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {editingChannel ? pt('dialogEditSubtitle') : pt('dialogNewSubtitle')}
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={onClose} sx={{ color: 'text.secondary' }}>
          <CloseIcon />
        </IconButton>
      </Box>

      <DialogContent sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Genres Section */}
        <Section
          icon={<CategoryIcon fontSize="small" />}
          title={pt('sectionGenres')}
          subtitle={pt('sectionGenresSubtitle')}
          theme={theme}
        >
          <Autocomplete
            multiple
            filterSelectedOptions
            options={availableGenres}
            value={formData.genreFilters}
            onChange={(_, newValue) => setFormData({ ...formData, genreFilters: newValue })}
            loading={loadingGenres}
            size="small"
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={formData.genreFilters.length === 0 ? pt('searchGenresPlaceholder') : ''}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loadingGenres ? <CircularProgress color="inherit" size={18} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip
                  variant="filled"
                  label={option}
                  size="small"
                  {...getTagProps({ index })}
                  key={option}
                  sx={{ bgcolor: alpha(theme.palette.primary.main, 0.15) }}
                />
              ))
            }
          />
        </Section>

        {/* Media Types Section */}
        <Section
          icon={<TvIcon fontSize="small" />}
          title={pt('sectionMediaTypes')}
          subtitle={pt('sectionMediaTypesSubtitle')}
          theme={theme}
        >
          <ToggleButtonGroup
            exclusive
            size="small"
            value={mediaChoiceValue(formData.mediaTypes)}
            onChange={(_, value) => handleMediaTypeChange(value)}
          >
            <ToggleButton value="movie">{pt('mediaTypeMovies')}</ToggleButton>
            <ToggleButton value="series">{pt('mediaTypeSeries')}</ToggleButton>
            <ToggleButton value="both">{pt('mediaTypeBoth')}</ToggleButton>
          </ToggleButtonGroup>
        </Section>

        {/* Example Movies Section */}
        {showMovies && (
          <Section
            icon={<MovieIcon fontSize="small" />}
            title={pt('sectionSeedMovies')}
            subtitle={pt('sectionSeedMoviesSubtitle')}
            theme={theme}
          >
            <SeedPicker
              searchPlaceholder={pt('searchMoviesPlaceholder')}
              query={movieQuery}
              onQueryChange={setMovieQuery}
              searching={searchingMovies}
              results={movieResults}
              selected={formData.exampleMovies}
              onAdd={handleAddMovie}
              onRemove={onRemoveExampleMovie}
              fallbackIcon={<MovieIcon fontSize="small" />}
              emptyPosterIcon={<MovieIcon sx={{ color: 'text.disabled' }} />}
              theme={theme}
            />
          </Section>
        )}

        {/* Example Series Section */}
        {showSeries && (
          <Section
            icon={<TvIcon fontSize="small" />}
            title={pt('sectionSeedSeries')}
            subtitle={pt('sectionSeedSeriesSubtitle')}
            theme={theme}
          >
            <SeedPicker
              searchPlaceholder={pt('searchSeriesPlaceholder')}
              query={seriesQuery}
              onQueryChange={setSeriesQuery}
              searching={searchingSeries}
              results={seriesResults}
              selected={formData.exampleSeries}
              onAdd={handleAddSeries}
              onRemove={onRemoveExampleSeries}
              fallbackIcon={<TvIcon fontSize="small" />}
              emptyPosterIcon={<TvIcon sx={{ color: 'text.disabled' }} />}
              theme={theme}
            />
          </Section>
        )}

        {/* Seed inclusion — the seeds steer the picks either way; this decides whether they also
            ship inside the result. Off by default, so existing channels are unchanged. */}
        <Box sx={{ px: 0.5 }}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={formData.includeSeeds}
                onChange={(e) => setFormData({ ...formData, includeSeeds: e.target.checked })}
              />
            }
            label={
              <Box>
                <Typography variant="body2" fontWeight={500}>
                  {pt('includeSeedsLabel')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {pt('includeSeedsHint')}
                </Typography>
              </Box>
            }
            sx={{ alignItems: 'center', m: 0 }}
          />
        </Box>

        {/* Text Preferences Section */}
        <Section
          icon={<TuneIcon fontSize="small" />}
          title={pt('sectionPreferences')}
          subtitle={pt('sectionPreferencesSubtitle')}
          theme={theme}
          aiButton={
            <AIButton
              onClick={handleGenerateAIPreferences}
              loading={generatingAIPreferences}
              disabled={!canGenerate}
              tooltip={pt('tooltipAIPreferences')}
              theme={theme}
            />
          }
        >
          <TextField
            fullWidth
            multiline
            rows={2}
            size="small"
            value={formData.textPreferences}
            onChange={(e) => setFormData({ ...formData, textPreferences: e.target.value })}
            placeholder={pt('preferencesPlaceholder')}
          />
        </Section>

        {/* Name Section */}
        <Section
          icon={<TitleIcon fontSize="small" />}
          title={pt('sectionNameTitle')}
          theme={theme}
          aiButton={
            <AIButton
              onClick={handleGenerateAIName}
              loading={generatingAIName}
              disabled={!canGenerate}
              tooltip={pt('tooltipGenerateName')}
              theme={theme}
            />
          }
        >
          <TextField
            fullWidth
            size="small"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder={pt('nameExamplePlaceholder')}
          />
        </Section>

        {/* Description Section */}
        <Section
          icon={<DescriptionIcon fontSize="small" />}
          title={pt('sectionDescriptionTitle')}
          subtitle={pt('sectionDescriptionSubtitle')}
          theme={theme}
          aiButton={
            <AIButton
              onClick={handleGenerateAIDescription}
              loading={generatingAIDescription}
              disabled={!canGenerate}
              tooltip={pt('tooltipGenerateDescription')}
              theme={theme}
            />
          }
        >
          <TextField
            fullWidth
            multiline
            rows={2}
            size="small"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder={pt('descriptionCuratedPlaceholder')}
          />
        </Section>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
        <Button onClick={onClose} variant="outlined" color="inherit">
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={onSubmit}
          disabled={!formData.name}
          startIcon={<PlaylistPlayIcon />}
        >
          {editingChannel ? pt('saveChanges') : pt('createPlaylist')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
