import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Alert,
  CircularProgress,
  Slider,
  Chip,
  Switch,
  Paper,
  Stack,
  Grid,
  Autocomplete,
  TextField,
  Fade,
  Select,
  MenuItem,
  FormControl,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Tooltip,
} from '@mui/material'
import HistoryIcon from '@mui/icons-material/History'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import LockIcon from '@mui/icons-material/Lock'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import LocalMoviesIcon from '@mui/icons-material/LocalMovies'
import RefreshIcon from '@mui/icons-material/Refresh'
import AddIcon from '@mui/icons-material/Add'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { WatcherIdentityCard } from '@/components/WatcherIdentityCard'
import { useAuth } from '@/hooks/useAuth'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@mui/material/styles'

// Types
interface TasteProfile {
  id: string
  mediaType: 'movie' | 'series'
  hasEmbedding: boolean
  embeddingModel: string | null
  autoUpdatedAt: string | null
  isLocked: boolean
  refreshIntervalDays: number
  minFranchiseItems: number
  minFranchiseSize: number
}

interface FranchisePreference {
  id: string
  franchiseName: string
  preferenceScore: number
  itemsWatched: number
}

interface GenreWeight {
  id: string
  genre: string
  weight: number
}

interface CustomInterest {
  id: string
  interestText: string
}

interface TasteProfileData {
  profile: TasteProfile | null
  franchises: FranchisePreference[]
  genres: GenreWeight[]
  customInterests: CustomInterest[]
  refreshIntervalOptions: number[]
  minFranchiseItemsOptions: number[]
  minFranchiseSizeOptions: number[]
}

interface AccessibleLibrary {
  id: string
  name: string
  collectionType: string | null
  isExcluded: boolean
}

const REFRESH_INTERVAL_VALUES = [7, 14, 30, 60, 90, 180, 365] as const

interface WatcherIdentitySectionProps {
  mediaType: 'movie' | 'series'
  /**
   * Genre weights are stored per user, not per media type, so they are edited
   * in one shared card outside these sub-tabs (see GenreWeightingCard). An
   * analyze run here still detects them, so the result is handed upward rather
   * than rendered locally.
   */
  onGenresDetected?: (genres: GenreWeight[], newGenres: string[]) => void
}

export function WatcherIdentitySection({ mediaType, onGenresDetected }: WatcherIdentitySectionProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const theme = useTheme()
  
  // Data states
  const [data, setData] = useState<TasteProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  // Action states
  const [analyzing, setAnalyzing] = useState(false)
  const [, setSavingSettings] = useState(false)
  const [savingSlider, setSavingSlider] = useState<string | null>(null)
  
  // Editable states
  const [refreshInterval, setRefreshInterval] = useState(30)
  const [minFranchiseItems, setMinFranchiseItems] = useState(1)
  const [minFranchiseSize, setMinFranchiseSize] = useState(2)
  const [isLocked, setIsLocked] = useState(false)
  const [interests, setInterests] = useState<string[]>([])
  const [interestInput, setInterestInput] = useState('')
  
  // Modal state
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false)
  
  // New items tracking (for highlighting). Genres are not here: they live in
  // the shared GenreWeightingCard, which owns their highlighting too.
  const [newFranchises, setNewFranchises] = useState<string[]>([])

  // Refs for scrolling to new items
  const franchiseRefs = useRef<Record<string, HTMLDivElement | null>>({})
  
  // Library exclusions state
  const [accessibleLibraries, setAccessibleLibraries] = useState<AccessibleLibrary[]>([])
  const [loadingLibraries, setLoadingLibraries] = useState(false)
  const [savingLibrary, setSavingLibrary] = useState<string | null>(null)
  
  // Debounce refs
  const sliderDebounceRef = useRef<Record<string, NodeJS.Timeout>>({})

  const isMovie = mediaType === 'movie'
  const accentColor = isMovie ? theme.palette.primary.main : '#ec4899'

  // Fetch all data
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const prefsResponse = await fetch(
        `/api/settings/taste-profile?mediaType=${mediaType}`,
        { credentials: 'include' }
      )
      
      if (prefsResponse.ok) {
        const prefsData = await prefsResponse.json()
        setData(prefsData)
        setRefreshInterval(prefsData.profile?.refreshIntervalDays || 30)
        setMinFranchiseItems(prefsData.profile?.minFranchiseItems || 1)
        setMinFranchiseSize(prefsData.profile?.minFranchiseSize || 2)
        setIsLocked(prefsData.profile?.isLocked || false)
        setInterests(prefsData.customInterests?.map((i: CustomInterest) => i.interestText) || [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('watcherIdentity.errFetchData'))
    } finally {
      setLoading(false)
    }
  }, [mediaType, t])
  
  // Fetch accessible libraries (only once per component)
  const fetchLibraries = useCallback(async () => {
    if (!user?.id) return
    setLoadingLibraries(true)
    try {
      const response = await fetch(`/api/users/${user.id}/accessible-libraries`, { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        setAccessibleLibraries(data.libraries || [])
      }
    } catch (err) {
      console.error('Failed to fetch accessible libraries:', err)
    } finally {
      setLoadingLibraries(false)
    }
  }, [user?.id])

  useEffect(() => {
    if (user?.id) {
      fetchData()
    }
  }, [fetchData, user?.id])
  
  // Fetch libraries only once on mount (shared across movie/series)
  useEffect(() => {
    if (user?.id) {
      fetchLibraries()
    }
  }, [fetchLibraries, user?.id])

  // Check if user has existing preferences
  const hasExistingPreferences = (data?.franchises?.length || 0) > 0 || (data?.genres?.length || 0) > 0

  // Handle click on Analyze button
  const handleAnalyzeClick = () => {
    if (hasExistingPreferences) {
      setShowAnalyzeModal(true)
    } else {
      // No existing preferences, just run reset mode
      performAnalysis('reset')
    }
  }

  // Perform the actual analysis
  const performAnalysis = async (mode: 'reset' | 'merge') => {
    setShowAnalyzeModal(false)
    setAnalyzing(true)
    setError(null)
    setSuccess(null)
    setNewFranchises([])

    try {
      const response = await fetch('/api/settings/taste-profile/rebuild', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaType, mode }),
      })
      if (!response.ok) throw new Error(t('watcherIdentity.errAnalyzeWatchHistory'))
      const result = await response.json()
      
      // Track new franchises for highlighting
      if (result.newFranchises?.length > 0) {
        setNewFranchises(result.newFranchises)
      }

      // Update lists directly from response (no full page re-render)
      if (result.franchises || result.genres) {
        setData(prev => prev ? {
          ...prev,
          franchises: result.franchises || prev.franchises,
          genres: result.genres || prev.genres,
        } : null)
      }

      // Genres are stored per user, not per media type, so the detected list
      // goes to the one shared card rather than being rendered under whichever
      // sub-tab happened to run the analysis.
      if (result.genres) {
        onGenresDetected?.(result.genres, result.newGenres || [])
      }

      if (mode === 'merge') {
        const newCount = (result.newFranchises?.length || 0) + (result.newGenres?.length || 0)
        setSuccess(newCount > 0 
          ? t('watcherIdentity.successMergeNew', {
              franchiseCount: result.newFranchises?.length || 0,
              genreCount: result.newGenres?.length || 0,
            })
          : t('watcherIdentity.successMergeNone')
        )
      } else {
        setSuccess(t('watcherIdentity.successResetComplete', {
          franchiseCount: result.franchisesUpdated,
          genreCount: result.genresUpdated || 0,
        }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('watcherIdentity.errAnalyze'))
    } finally {
      setAnalyzing(false)
    }
  }

  // Save settings (lock/interval)
  const handleSaveSettings = async () => {
    setSavingSettings(true)
    try {
      await fetch('/api/settings/taste-profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaType, isLocked, refreshIntervalDays: refreshInterval, minFranchiseItems, minFranchiseSize }),
      })
    } catch {
      // Silent fail
    } finally {
      setSavingSettings(false)
    }
  }

  // Auto-save slider with debounce
  const handleSliderChange = (id: string, name: string, value: number) => {
    // Clear existing debounce
    const key = `franchise-${id}`
    if (sliderDebounceRef.current[key]) {
      clearTimeout(sliderDebounceRef.current[key])
    }

    // Remove from new items when user interacts
    setNewFranchises(prev => prev.includes(name) ? prev.filter(f => f !== name) : prev)

    // Update local state immediately
    setData(prev => prev ? {
      ...prev,
      franchises: prev.franchises.map(f => f.id === id ? { ...f, preferenceScore: value } : f)
    } : null)

    // Debounce API call
    sliderDebounceRef.current[key] = setTimeout(async () => {
      setSavingSlider(key)
      try {
        await fetch('/api/settings/taste-profile/franchises', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ franchises: [{ franchiseName: name, mediaType, preferenceScore: value }] }),
        })
      } catch {
        // Silent fail
      } finally {
        setSavingSlider(null)
      }
    }, 500)
  }

  // Scroll to a new franchise
  const scrollToFranchise = (name: string) => {
    franchiseRefs.current[name]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // Delete franchise
  const handleDeleteFranchise = async (franchiseName: string) => {
    // Optimistically remove from local state
    setData(prev => prev ? {
      ...prev,
      franchises: prev.franchises.filter(f => f.franchiseName !== franchiseName)
    } : null)
    
    // Also remove from new items if present
    setNewFranchises(prev => prev.filter(f => f !== franchiseName))

    try {
      await fetch(`/api/settings/taste-profile/franchises/${encodeURIComponent(franchiseName)}?mediaType=${mediaType}`, {
        method: 'DELETE',
        credentials: 'include',
      })
    } catch {
      // Revert on error - refetch data
      fetchData()
    }
  }

  // Handle interests
  const handleAddInterest = async (interest: string) => {
    if (!interest.trim() || interests.includes(interest.trim())) return
    
    const newInterest = interest.trim()
    setInterests(prev => [...prev, newInterest])
    setInterestInput('')
    setError(null)

    try {
      const response = await fetch('/api/settings/taste-profile/interests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interestText: newInterest }),
      })
      // fetch only rejects on network failure, so without this a 4xx/5xx looked
      // exactly like success: the chip stayed until the refetch below silently
      // replaced it with the server's (unchanged) list.
      if (!response.ok) throw new Error(String(response.status))
      await fetchData()
    } catch {
      // Revert on error
      setInterests(prev => prev.filter(i => i !== newInterest))
      setError(t('watcherIdentity.errSaveInterest'))
    }
  }

  const handleRemoveInterest = async (interest: string) => {
    const interestObj = data?.customInterests?.find(i => i.interestText === interest)
    if (!interestObj) return
    
    setInterests(prev => prev.filter(i => i !== interest))
    setError(null)

    try {
      const response = await fetch(`/api/settings/taste-profile/interests/${interestObj.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) throw new Error(String(response.status))
    } catch {
      // Revert on error
      setInterests(prev => [...prev, interest])
      setError(t('watcherIdentity.errRemoveInterest'))
    }
  }

  // Handle library exclusion toggle
  const handleToggleLibrary = async (libraryId: string, currentlyExcluded: boolean) => {
    if (!user?.id) return
    
    setSavingLibrary(libraryId)
    
    // Optimistically update UI
    setAccessibleLibraries(prev => 
      prev.map(lib => 
        lib.id === libraryId ? { ...lib, isExcluded: !currentlyExcluded } : lib
      )
    )
    
    try {
      await fetch(`/api/users/${user.id}/excluded-libraries/${libraryId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excluded: !currentlyExcluded }),
      })
    } catch {
      // Revert on error
      setAccessibleLibraries(prev =>
        prev.map(lib =>
          lib.id === libraryId ? { ...lib, isExcluded: currentlyExcluded } : lib
        )
      )
    } finally {
      setSavingLibrary(null)
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return t('watcherIdentity.analyzedNever')
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {/* Analyze Mode Selection Modal */}
      <Dialog 
        open={showAnalyzeModal} 
        onClose={() => setShowAnalyzeModal(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Box display="flex" alignItems="center" gap={1}>
            <HistoryIcon color="primary" />
            {t('watcherIdentity.analyzeModalTitle')}
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={3}>
            {t('watcherIdentity.analyzeModalBody')}
          </Typography>
          
          <Stack spacing={2}>
            {/* Reset All Option */}
            <Paper
              onClick={() => performAnalysis('reset')}
              sx={{
                p: 2,
                cursor: 'pointer',
                border: '2px solid',
                borderColor: 'divider',
                borderRadius: 2,
                transition: 'all 0.2s',
                '&:hover': {
                  borderColor: 'error.main',
                  bgcolor: 'error.main',
                  '& .MuiTypography-root': { color: 'white' },
                  '& .MuiSvgIcon-root': { color: 'white' },
                },
              }}
            >
              <Box display="flex" alignItems="center" gap={2}>
                <RefreshIcon color="error" sx={{ fontSize: 32 }} />
                <Box>
                  <Typography variant="subtitle1" fontWeight={600}>
                    {t('watcherIdentity.analyzeResetTitle')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('watcherIdentity.analyzeResetDescription')}
                  </Typography>
                </Box>
              </Box>
            </Paper>
            
            {/* Add New Only Option */}
            <Paper
              onClick={() => performAnalysis('merge')}
              sx={{
                p: 2,
                cursor: 'pointer',
                border: '2px solid',
                borderColor: 'divider',
                borderRadius: 2,
                transition: 'all 0.2s',
                '&:hover': {
                  borderColor: 'success.main',
                  bgcolor: 'success.main',
                  '& .MuiTypography-root': { color: 'white' },
                  '& .MuiSvgIcon-root': { color: 'white' },
                },
              }}
            >
              <Box display="flex" alignItems="center" gap={2}>
                <AddIcon color="success" sx={{ fontSize: 32 }} />
                <Box>
                  <Typography variant="subtitle1" fontWeight={600}>
                    {t('watcherIdentity.analyzeMergeTitle')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('watcherIdentity.analyzeMergeDescription')}
                  </Typography>
                </Box>
              </Box>
            </Paper>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAnalyzeModal(false)}>{t('watcherIdentity.dialogCancel')}</Button>
        </DialogActions>
      </Dialog>

      {/* Section 1: Identity Settings */}
      <Card sx={{ backgroundColor: 'background.default', borderRadius: 2 }}>
        <CardContent>
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={2.5}>
          <Typography variant="h6" fontWeight={600}>
            {t('watcherIdentity.identitySettingsTitle')}
          </Typography>
          <Box display="flex" alignItems="center" gap={1}>
            <Chip
              size="small"
              label={data?.profile?.hasEmbedding ? t('watcherIdentity.statusActive') : t('watcherIdentity.statusNotAnalyzed')}
              color={data?.profile?.hasEmbedding ? 'success' : 'warning'}
            />
            {data?.profile?.isLocked && (
              <Chip size="small" icon={<LockIcon />} label={t('watcherIdentity.lockedChip')} color="info" />
            )}
            {data?.profile?.autoUpdatedAt && (
              <Typography variant="caption" color="text.secondary">
                {t('watcherIdentity.analyzedOn', { date: formatDate(data.profile.autoUpdatedAt) })}
              </Typography>
            )}
          </Box>
        </Box>
        
        <Grid container spacing={2}>
          {/* Auto-refresh Card */}
          <Grid item xs={12} sm={6} md={4}>
            <Box
              sx={{
                bgcolor: 'background.default',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 2,
                height: '100%',
              }}
            >
              <Box display="flex" alignItems="center" gap={0.5} mb={1}>
                {isLocked ? <LockIcon fontSize="small" color="action" /> : <LockOpenIcon fontSize="small" color="action" />}
                <Typography variant="body2" fontWeight={600}>{t('watcherIdentity.autoRefresh')}</Typography>
              </Box>
              <Box display="flex" alignItems="center" gap={1.5} mb={1}>
                <Switch
                  checked={!isLocked}
                  onChange={(e) => {
                    setIsLocked(!e.target.checked)
                    setTimeout(handleSaveSettings, 100)
                  }}
                  size="small"
                />
                {!isLocked && (
                  <FormControl size="small" sx={{ minWidth: 100 }}>
                    <Select
                      value={refreshInterval}
                      onChange={(e) => {
                        setRefreshInterval(e.target.value as number)
                        setTimeout(handleSaveSettings, 100)
                      }}
                    >
                      {REFRESH_INTERVAL_VALUES.map((value) => (
                        <MenuItem key={value} value={value}>
                          {t(`watcherIdentity.refreshInterval.${value}`)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Box>
              <Typography variant="caption" color="text.secondary">
                {isLocked ? t('watcherIdentity.lockCaptionLocked') : t('watcherIdentity.lockCaptionUnlocked')}
              </Typography>
            </Box>
          </Grid>
          
          {/* Franchise Size Filter */}
          <Grid item xs={12} sm={6} md={4}>
            <Box
              sx={{
                bgcolor: 'background.default',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 2,
                height: '100%',
              }}
            >
              <Typography variant="body2" fontWeight={600} mb={1}>{t('watcherIdentity.minFranchiseSizeTitle')}</Typography>
              <FormControl size="small" fullWidth sx={{ mb: 1 }}>
                <Select
                  value={minFranchiseSize}
                  onChange={(e) => {
                    setMinFranchiseSize(e.target.value as number)
                    setTimeout(handleSaveSettings, 100)
                  }}
                >
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
                    <MenuItem key={value} value={value}>
                      {isMovie
                        ? t('watcherIdentity.minFranchiseSizeOptionMovies', { count: value })
                        : t('watcherIdentity.minFranchiseSizeOptionShows', { count: value })}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary">
                {isMovie
                  ? t('watcherIdentity.minFranchiseSizeCaptionMovies', { count: minFranchiseSize })
                  : t('watcherIdentity.minFranchiseSizeCaptionShows', { count: minFranchiseSize })}
              </Typography>
            </Box>
          </Grid>
          
          {/* Min Watched Filter */}
          <Grid item xs={12} sm={6} md={4}>
            <Box
              sx={{
                bgcolor: 'background.default',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 2,
                height: '100%',
              }}
            >
              <Typography variant="body2" fontWeight={600} mb={1}>{t('watcherIdentity.minWatchedTitle')}</Typography>
              <FormControl size="small" fullWidth sx={{ mb: 1 }}>
                <Select
                  value={minFranchiseItems}
                  onChange={(e) => {
                    setMinFranchiseItems(e.target.value as number)
                    setTimeout(handleSaveSettings, 100)
                  }}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
                    <MenuItem key={value} value={value}>
                      {t('watcherIdentity.minWatchedOption', { count: value })}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary">
                {t('watcherIdentity.minWatchedCaption', { count: minFranchiseItems })}
              </Typography>
            </Box>
          </Grid>
        </Grid>
        </CardContent>
      </Card>

      {/* Section 2: Specific Interests & Watch History Sources (2 columns) */}
      <Grid container spacing={3}>
        {/* Left Column: Specific Interests */}
        <Grid item xs={12} md={6}>
          <Card sx={{ backgroundColor: 'background.default', borderRadius: 2, height: '100%' }}>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={1}>
                <AutoAwesomeIcon sx={{ color: accentColor }} fontSize="small" />
                <Typography variant="h6" fontWeight={600}>
                  {t('watcherIdentity.specificInterestsTitle')}
                </Typography>
              </Box>
            <Typography variant="body2" color="text.secondary" mb={2}>
              {t('watcherIdentity.specificInterestsBody')}
            </Typography>
            
            <Autocomplete
              multiple
              freeSolo
              options={[]}
              value={interests}
              inputValue={interestInput}
              onInputChange={(_, value) => setInterestInput(value)}
              onChange={(_, newValue, reason, details) => {
                if (reason === 'createOption' && details?.option) {
                  handleAddInterest(details.option as string)
                } else if (reason === 'removeOption' && details?.option) {
                  handleRemoveInterest(details.option as string)
                }
              }}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    {...getTagProps({ index })}
                    key={option}
                    label={option}
                    onDelete={() => handleRemoveInterest(option)}
                    sx={{ m: 0.5 }}
                  />
                ))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder={t('watcherIdentity.interestPlaceholder')}
                  size="small"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && interestInput.trim()) {
                      e.preventDefault()
                      // Autocomplete's own Enter handler sits on the root above
                      // this one and would fire onChange with reason
                      // 'createOption' for the same keystroke, adding the
                      // interest twice. preventDefault doesn't stop that --
                      // only halting propagation does. Other keys still reach
                      // it, so arrows/Escape behave normally.
                      e.stopPropagation()
                      handleAddInterest(interestInput)
                    }
                  }}
                />
              )}
            />
            
            {interests.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                {t('watcherIdentity.interestExamples')}
              </Typography>
            )}
            </CardContent>
          </Card>
        </Grid>

        {/* Right Column: Watch History Sources */}
        <Grid item xs={12} md={6}>
          <Card sx={{ backgroundColor: 'background.default', borderRadius: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <Box display="flex" alignItems="center" gap={1} mb={1}>
                <VideoLibraryIcon sx={{ color: accentColor }} fontSize="small" />
                <Typography variant="h6" fontWeight={600}>
                  {isMovie ? t('watcherIdentity.librarySourcesMovie') : t('watcherIdentity.librarySourcesSeries')}
                </Typography>
              </Box>
            <Typography variant="body2" color="text.secondary" mb={2}>
              {isMovie ? t('watcherIdentity.librarySourcesDescMovie') : t('watcherIdentity.librarySourcesDescTv')}
            </Typography>
            
            {loadingLibraries ? (
              <Box display="flex" justifyContent="center" py={2}>
                <CircularProgress size={24} />
              </Box>
            ) : accessibleLibraries.filter(l => l.collectionType === (isMovie ? 'movies' : 'tvshows')).length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {isMovie ? t('watcherIdentity.noMovieLibraries') : t('watcherIdentity.noTvLibraries')}
              </Typography>
            ) : (
              <Box 
                sx={{ 
                  maxHeight: 280, 
                  overflowY: 'auto', 
                  flex: 1,
                  p: 1.5,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  '&::-webkit-scrollbar': { width: 6 },
                  '&::-webkit-scrollbar-thumb': { 
                    bgcolor: 'divider', 
                    borderRadius: 3,
                  },
                }}
              >
                <Grid container spacing={1}>
                  {accessibleLibraries
                    .filter(library => library.collectionType === (isMovie ? 'movies' : 'tvshows'))
                    .map((library) => (
                    <Grid item xs={12} sm={6} key={library.id}>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          p: 1.5,
                          borderRadius: 1,
                          border: '1px solid',
                          borderColor: library.isExcluded ? 'divider' : accentColor,
                          bgcolor: library.isExcluded ? 'action.disabledBackground' : 'background.paper',
                          opacity: library.isExcluded ? 0.7 : 1,
                          transition: 'all 0.2s',
                        }}
                      >
                        <Box display="flex" alignItems="center" gap={1} minWidth={0} flex={1}>
                          {isMovie ? (
                            <MovieIcon fontSize="small" color={library.isExcluded ? 'disabled' : 'action'} sx={{ flexShrink: 0 }} />
                          ) : (
                            <TvIcon fontSize="small" color={library.isExcluded ? 'disabled' : 'action'} sx={{ flexShrink: 0 }} />
                          )}
                          <Typography
                            variant="body2"
                            fontWeight={500}
                            noWrap
                            sx={{ 
                              color: library.isExcluded ? 'text.disabled' : 'text.primary',
                              minWidth: 0,
                            }}
                          >
                            {library.name}
                          </Typography>
                        </Box>
                        
                        <Switch
                          checked={!library.isExcluded}
                          onChange={() => handleToggleLibrary(library.id, library.isExcluded)}
                          disabled={savingLibrary === library.id}
                          size="small"
                          sx={{
                            flexShrink: 0,
                            ml: 0.5,
                            '& .MuiSwitch-switchBase.Mui-checked': {
                              color: accentColor,
                            },
                            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                              backgroundColor: accentColor,
                            },
                          }}
                        />
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            )}
            
            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
              {t('watcherIdentity.aiPicksExcludedCaption')}
            </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Analyze button - below the 2-column section */}
      <Card sx={{ backgroundColor: 'background.default', borderRadius: 2 }}>
        <CardContent sx={{ display: 'flex', justifyContent: 'flex-end', py: 2, '&:last-child': { pb: 2 } }}>
        <Box textAlign="right">
          <Button
            variant="contained"
            startIcon={analyzing ? <CircularProgress size={18} color="inherit" /> : <HistoryIcon />}
            onClick={handleAnalyzeClick}
            disabled={analyzing}
            sx={{ 
              bgcolor: accentColor,
              '&:hover': { bgcolor: accentColor, filter: 'brightness(1.1)' },
            }}
          >
            {analyzing ? t('watcherIdentity.analyzing') : t('watcherIdentity.analyzeWatchHistory')}
          </Button>
          
        </Box>
        </CardContent>
      </Card>

      {/* Section 3: Watch History Weights */}
      <Card sx={{ backgroundColor: 'background.default', borderRadius: 2 }}>
        <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Typography variant="h6" fontWeight={600}>
            {t('watcherIdentity.watchHistoryWeightsTitle')}
          </Typography>
          <Fade in={!!savingSlider}>
            <Typography variant="caption" color="text.secondary">
              {t('watcherIdentity.savingSlider')}
            </Typography>
          </Fade>
        </Box>
        
        <Grid container spacing={3}>
          {/* Franchise Weighting. Full width since genre weights moved out to
              their own card -- they are stored per user, not per media type. */}
          <Grid item xs={12}>
            <Box sx={{ 
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              p: 2,
            }}>
              <Box display="flex" alignItems="center" gap={1} mb={1}>
                <LocalMoviesIcon sx={{ color: accentColor }} fontSize="small" />
                <Typography variant="subtitle1" fontWeight={600}>
                  {t('watcherIdentity.franchiseWeightingTitle', { count: data?.franchises?.length || 0 })}
                </Typography>
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
                <Typography variant="caption" color="text.secondary">
                  {t('watcherIdentity.franchiseExplainerLead')}{' '}
                  <strong>{t('watcherIdentity.weightBoost')}</strong>
                  {t('watcherIdentity.franchiseExplainerAfterBoost')}
                  <strong>{t('watcherIdentity.weightAvoid')}</strong>
                  {t('watcherIdentity.franchiseExplainerAfterAvoid')}
                </Typography>
              </Box>
              
              {/* Legend */}
              <Box display="flex" justifyContent="space-between" mb={2} px={1}>
                <Typography variant="caption" color="error.main">{t('watcherIdentity.weightAvoid')}</Typography>
                <Typography variant="caption" color="text.secondary">{t('watcherIdentity.weightNeutral')}</Typography>
                <Typography variant="caption" color="success.main">{t('watcherIdentity.weightBoost')}</Typography>
              </Box>
              
              {/* Scrollable slider list */}
              <Box sx={{ maxHeight: 350, overflow: 'auto', pr: 1 }}>
                {data?.franchises && data.franchises.length > 0 ? (
                  [...data.franchises]
                    .sort((a, b) => a.franchiseName.localeCompare(b.franchiseName))
                    .map((franchise) => {
                    const isNew = newFranchises.includes(franchise.franchiseName)
                    return (
                      <Box 
                        key={franchise.id} 
                        ref={(el: HTMLDivElement | null) => { franchiseRefs.current[franchise.franchiseName] = el }}
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
                          <Box display="flex" alignItems="center" gap={1} sx={{ minWidth: 0, flex: 1 }}>
                            <Typography
                              variant="body2"
                              fontWeight={500}
                              sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {franchise.franchiseName}
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
                                franchise.preferenceScore > 0.3 ? t('watcherIdentity.weightBoost') :
                                franchise.preferenceScore < -0.3 ? t('watcherIdentity.weightAvoid') : t('watcherIdentity.weightNeutral')
                              }
                              sx={{
                                bgcolor: franchise.preferenceScore > 0.3 ? 'success.main' :
                                        franchise.preferenceScore < -0.3 ? 'error.main' : 'action.selected',
                                color: Math.abs(franchise.preferenceScore) > 0.3 ? 'white' : 'text.primary',
                                fontSize: '0.7rem',
                                height: 20,
                              }}
                            />
                            <Tooltip title={t('watcherIdentity.removeFromListTooltip')}>
                              <IconButton 
                                size="small" 
                                onClick={() => handleDeleteFranchise(franchise.franchiseName)}
                                sx={{ 
                                  p: 0.25,
                                  opacity: 0.5,
                                  '&:hover': { opacity: 1, color: 'error.main' }
                                }}
                              >
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </Box>
                        <Slider
                          value={franchise.preferenceScore}
                          onChange={(_, value) => handleSliderChange(franchise.id, franchise.franchiseName, value as number)}
                          min={-1}
                          max={1}
                          step={0.1}
                          size="small"
                          sx={{
                            '& .MuiSlider-track': {
                              background: franchise.preferenceScore > 0
                                ? `linear-gradient(to right, #9ca3af, ${theme.palette.success.main})`
                                : `linear-gradient(to right, ${theme.palette.error.main}, #9ca3af)`,
                            },
                            '& .MuiSlider-rail': {
                              background: `linear-gradient(to right, ${theme.palette.error.main}, #9ca3af, ${theme.palette.success.main})`,
                              opacity: 0.3,
                            },
                          }}
                        />
                      </Box>
                    )
                  })
                ) : (
                  <Typography variant="body2" color="text.secondary" textAlign="center" py={4}>
                    {t('watcherIdentity.noFranchisesHint', { action: t('watcherIdentity.analyzeWatchHistory') })}
                  </Typography>
                )}
              </Box>
              
              {/* New items alert */}
              {newFranchises.length > 0 && (
                <Alert
                  severity="info"
                  icon={<AutoFixHighIcon />}
                  sx={{ mt: 2 }}
                >
                  <Typography variant="body2" fontWeight={500} mb={1}>
                    {t('watcherIdentity.newFranchisesDetected', { count: newFranchises.length })}
                  </Typography>
                  <Box display="flex" gap={0.5} flexWrap="wrap">
                    {newFranchises.map((name) => (
                      <Chip
                        key={name}
                        label={name}
                        size="small"
                        onClick={() => scrollToFranchise(name)}
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
            </Box>
          </Grid>
        </Grid>
        </CardContent>
      </Card>

      {/* Section 4: Identity Output — shared with the Watch Stats page, which
          shows the same account of your taste beside the charts that count it. */}
      <WatcherIdentityCard mediaType={mediaType} />
    </Box>
  )
}

