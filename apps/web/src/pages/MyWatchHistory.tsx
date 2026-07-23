import React, { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Typography,
  Grid,
  Skeleton,
  Alert,
  ToggleButton,
  ToggleButtonGroup,
  Chip,
  Pagination,
  CircularProgress,
  TextField,
  InputAdornment,
  Tabs,
  Tab,
  LinearProgress,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Tooltip,
  Snackbar,
  useTheme,
  useMediaQuery,
} from '@mui/material'
import GridViewIcon from '@mui/icons-material/GridView'
import ViewListIcon from '@mui/icons-material/ViewList'
import FavoriteIcon from '@mui/icons-material/Favorite'
import SearchIcon from '@mui/icons-material/Search'
import HistoryIcon from '@mui/icons-material/History'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import SortByAlphaIcon from '@mui/icons-material/SortByAlpha'
import AllInclusiveIcon from '@mui/icons-material/AllInclusive'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import AddToQueueIcon from '@mui/icons-material/AddToQueue'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import { MoviePoster } from '@aperture/ui'
import { useAuth } from '@/hooks/useAuth'
import { useWatching } from '@/hooks/useWatching'
import { useUserRatings } from '@/hooks/useUserRatings'
import { useViewMode } from '@/hooks/useViewMode'
import { formatWatchHistoryRelativeDate, formatWatchHistoryExactDate } from '@/lib/formatWatchHistoryRelativeDate'
import { WatchHistoryMovieListItem, WatchHistorySeriesListItem } from './watch-history/components'

interface MovieWatchHistoryItem {
  movie_id: string
  play_count: number
  is_favorite: boolean
  played: boolean
  progress_percent: number | null
  last_played_at: string | null
  title: string
  year: number | null
  poster_url: string | null
  genres: string[]
  community_rating: number | null
  overview: string | null
}

interface SeriesWatchHistoryItem {
  series_id: string
  title: string
  year: number | null
  poster_url: string | null
  genres: string[]
  community_rating: number | null
  overview: string | null
  episodes_watched: number
  total_episodes: number
  total_plays: number
  last_played_at: string | null
  is_favorite: boolean
}

interface WatchHistoryResponse<T> {
  history: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export function MyWatchHistoryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const { user } = useAuth()
  const { isWatching, toggleWatching } = useWatching()
  const { getRating, setRating } = useUserRatings()
  const [tabValue, setTabValue] = useState(0) // 0 = Movies, 1 = Series
  
  // Movies state
  const [movieHistory, setMovieHistory] = useState<MovieWatchHistoryItem[]>([])
  const [movieLoading, setMovieLoading] = useState(true)
  const [moviePagination, setMoviePagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 })
  const [movieSortBy, setMovieSortBy] = useState<'recent' | 'plays' | 'title'>('recent')
  
  // Series state
  const [seriesHistory, setSeriesHistory] = useState<SeriesWatchHistoryItem[]>([])
  const [seriesLoading, setSeriesLoading] = useState(true)
  const [seriesPagination, setSeriesPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 })
  const [seriesSortBy, setSeriesSortBy] = useState<'recent' | 'plays' | 'title'>('recent')
  
  // Shared state
  const { viewMode, setViewMode } = useViewMode('watchHistory')
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_progress' | 'completed'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  // Debounced term actually sent to the server so search spans the whole history, not just the loaded page
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Mark unwatched state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    type: 'movie' | 'series'
    id: string
    title: string
  } | null>(null)
  const [markingUnwatched, setMarkingUnwatched] = useState(false)
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success'
  })

  // Check if user can manage watch history (admin or has permission)
  const canManage = user?.isAdmin || user?.canManageWatchHistory

  const handleMarkUnwatched = async () => {
    if (!confirmDialog || !user) return

    setMarkingUnwatched(true)
    try {
      const endpoint = confirmDialog.type === 'movie'
        ? `/api/users/${user.id}/watch-history/movies/${confirmDialog.id}`
        : `/api/users/${user.id}/watch-history/series/${confirmDialog.id}`

      const response = await fetch(endpoint, {
        method: 'DELETE',
        credentials: 'include'
      })

      if (response.ok) {
        // Remove from local state
        if (confirmDialog.type === 'movie') {
          setMovieHistory(prev => prev.filter(m => m.movie_id !== confirmDialog.id))
          setMoviePagination(prev => ({ ...prev, total: prev.total - 1 }))
        } else {
          setSeriesHistory(prev => prev.filter(s => s.series_id !== confirmDialog.id))
          setSeriesPagination(prev => ({ ...prev, total: prev.total - 1 }))
        }
        setSnackbar({ open: true, message: t('watchHistoryPage.snackbarMarked', { title: confirmDialog.title }), severity: 'success' })
      } else {
        const error = await response.json()
        setSnackbar({ open: true, message: error.error || t('watchHistoryPage.snackbarError'), severity: 'error' })
      }
    } catch (err) {
      console.error('Failed to mark as unwatched:', err)
      setSnackbar({ open: true, message: t('watchHistoryPage.snackbarError'), severity: 'error' })
    } finally {
      setMarkingUnwatched(false)
      setConfirmDialog(null)
    }
  }

  const fetchMovieHistory = useCallback(async (page: number, sort: string, search: string, filter: string) => {
    if (!user) return

    setMovieLoading(true)
    try {
      const searchParam = search ? `&search=${encodeURIComponent(search)}` : ''
      const filterParam = filter && filter !== 'all' ? `&filter=${filter}` : ''
      const response = await fetch(
        `/api/users/${user.id}/watch-history?page=${page}&pageSize=50&sortBy=${sort}${searchParam}${filterParam}`,
        { credentials: 'include' }
      )
      if (response.ok) {
        const data: WatchHistoryResponse<MovieWatchHistoryItem> = await response.json()
        setMovieHistory(data.history)
        setMoviePagination(data.pagination)
      }
    } catch (err) {
      console.error('Failed to fetch movie watch history:', err)
    } finally {
      setMovieLoading(false)
    }
  }, [user])

  const fetchSeriesHistory = useCallback(async (page: number, sort: string, search: string, filter: string) => {
    if (!user) return

    setSeriesLoading(true)
    try {
      const searchParam = search ? `&search=${encodeURIComponent(search)}` : ''
      const filterParam = filter && filter !== 'all' ? `&filter=${filter}` : ''
      const response = await fetch(
        `/api/users/${user.id}/series-watch-history?page=${page}&pageSize=50&sortBy=${sort}${searchParam}${filterParam}`,
        { credentials: 'include' }
      )
      if (response.ok) {
        const data: WatchHistoryResponse<SeriesWatchHistoryItem> = await response.json()
        setSeriesHistory(data.history)
        setSeriesPagination(data.pagination)
      }
    } catch (err) {
      console.error('Failed to fetch series watch history:', err)
    } finally {
      setSeriesLoading(false)
    }
  }, [user])

  // Debounce the search box before hitting the server (300ms while typing, immediate when cleared)
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchQuery.trim()), searchQuery ? 300 : 0)
    return () => clearTimeout(handle)
  }, [searchQuery])

  // Refetch from page 1 whenever the search term, sort, or status filter changes (also covers initial mount)
  useEffect(() => {
    fetchMovieHistory(1, movieSortBy, debouncedSearch, statusFilter)
  }, [fetchMovieHistory, movieSortBy, debouncedSearch, statusFilter])

  useEffect(() => {
    fetchSeriesHistory(1, seriesSortBy, debouncedSearch, statusFilter)
  }, [fetchSeriesHistory, seriesSortBy, debouncedSearch, statusFilter])

  const handleMoviePageChange = (_: React.ChangeEvent<unknown>, page: number) => {
    fetchMovieHistory(page, movieSortBy, debouncedSearch, statusFilter)
  }

  const handleSeriesPageChange = (_: React.ChangeEvent<unknown>, page: number) => {
    fetchSeriesHistory(page, seriesSortBy, debouncedSearch, statusFilter)
  }

  const handleMovieSortChange = (_: React.MouseEvent<HTMLElement>, newSort: 'recent' | 'plays' | 'title' | null) => {
    if (newSort) {
      setMovieSortBy(newSort)
    }
  }

  const handleSeriesSortChange = (_: React.MouseEvent<HTMLElement>, newSort: 'recent' | 'plays' | 'title' | null) => {
    if (newSort) {
      setSeriesSortBy(newSort)
    }
  }

  // Search is applied server-side across the whole history; render results as-is.
  const filteredMovies = movieHistory
  const filteredSeries = seriesHistory

  const isLoading = tabValue === 0 ? movieLoading : seriesLoading

  if (movieLoading && seriesLoading && movieHistory.length === 0 && seriesHistory.length === 0) {
    return (
      <Box>
        <Skeleton variant="text" width={300} height={48} sx={{ mb: 1 }} />
        <Skeleton variant="text" width={200} height={24} sx={{ mb: 4 }} />
        <Grid container spacing={2}>
          {[...Array(12)].map((_, i) => (
            <Grid item xs={6} sm={4} md={3} lg={2} key={i}>
              <Skeleton variant="rectangular" sx={{ width: '100%', aspectRatio: '2/3', borderRadius: 1 }} />
            </Grid>
          ))}
        </Grid>
      </Box>
    )
  }

  return (
    <Box>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={3}>
        <Box>
          <Box display="flex" alignItems="center" gap={2} mb={{ xs: 0, sm: 1 }}>
            <HistoryIcon sx={{ color: 'primary.main', fontSize: 32 }} />
            <Typography variant="h4" fontWeight={700}>
              {t('watchHistoryPage.title')}
            </Typography>
          </Box>
          {!isMobile && (
            <Typography variant="body1" color="text.secondary">
              {t('watchHistoryPage.subtitleStats', {
                movies: moviePagination.total.toLocaleString(),
                series: seriesPagination.total.toLocaleString(),
              })}
            </Typography>
          )}
        </Box>
        {/* Grid/List toggle always in upper right */}
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={(_, v) => v && setViewMode(v)}
          size="small"
        >
          <ToggleButton value="grid"><GridViewIcon fontSize="small" /></ToggleButton>
          <ToggleButton value="list"><ViewListIcon fontSize="small" /></ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs 
          value={tabValue} 
          onChange={(_, v) => setTabValue(v)}
          sx={{
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 500,
              minHeight: 48,
            }
          }}
        >
          <Tab 
            icon={<MovieIcon />} 
            iconPosition="start" 
            label={t('watchHistoryPage.tabMovies', { total: moviePagination.total.toLocaleString() })}
            sx={{
              color: tabValue === 0 ? '#6366f1' : 'text.secondary',
              '&.Mui-selected': { color: '#6366f1' },
            }}
          />
          <Tab 
            icon={<TvIcon />} 
            iconPosition="start" 
            label={t('watchHistoryPage.tabSeries', { total: seriesPagination.total.toLocaleString() })}
            sx={{
              color: tabValue === 1 ? '#ec4899' : 'text.secondary',
              '&.Mui-selected': { color: '#ec4899' },
            }}
          />
        </Tabs>
      </Box>

      {/* Controls */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} flexWrap="wrap" gap={2}>
        <Box display="flex" alignItems="center" gap={2}>
          <TextField
            size="small"
            placeholder={tabValue === 0 ? t('watchHistoryPage.searchMovies') : t('watchHistoryPage.searchSeries')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ width: 250 }}
          />
          <ToggleButtonGroup
            value={tabValue === 0 ? movieSortBy : seriesSortBy}
            exclusive
            onChange={tabValue === 0 ? handleMovieSortChange : handleSeriesSortChange}
            size="small"
          >
            <ToggleButton value="recent">
              <AccessTimeIcon fontSize="small" sx={{ mr: isMobile ? 0 : 0.5 }} />
              {!isMobile && t('watchHistoryPage.sortRecent')}
            </ToggleButton>
            <ToggleButton value="plays">
              <TrendingUpIcon fontSize="small" sx={{ mr: isMobile ? 0 : 0.5 }} />
              {!isMobile && t('watchHistoryPage.sortMostPlayed')}
            </ToggleButton>
            <ToggleButton value="title">
              <SortByAlphaIcon fontSize="small" sx={{ mr: isMobile ? 0 : 0.5 }} />
              {!isMobile && t('watchHistoryPage.sortAZ')}
            </ToggleButton>
          </ToggleButtonGroup>
          <ToggleButtonGroup
            value={statusFilter}
            exclusive
            onChange={(_, v) => v && setStatusFilter(v)}
            size="small"
          >
            <ToggleButton value="all">
              <AllInclusiveIcon fontSize="small" sx={{ mr: isMobile ? 0 : 0.5 }} />
              {!isMobile && t('watchHistoryPage.filterAll')}
            </ToggleButton>
            <ToggleButton value="in_progress">
              <PlayCircleOutlineIcon fontSize="small" sx={{ mr: isMobile ? 0 : 0.5 }} />
              {!isMobile && t('watchHistoryPage.filterInProgress')}
            </ToggleButton>
            <ToggleButton value="completed">
              <CheckCircleIcon fontSize="small" sx={{ mr: isMobile ? 0 : 0.5 }} />
              {!isMobile && t('watchHistoryPage.filterCompleted')}
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
        {isLoading && <CircularProgress size={20} />}
      </Box>

      {/* Movies Tab Content */}
      {tabValue === 0 && (
        <>
          {filteredMovies.length === 0 ? (
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              {searchQuery
                ? t('watchHistoryPage.emptySearchMovies', { query: searchQuery })
                : t('watchHistoryPage.emptyMovies')}
            </Alert>
          ) : (
            <>
              {/* Grid View */}
              {viewMode === 'grid' && (
                <Grid container spacing={2}>
                  {filteredMovies.map((item) => (
                    <Grid item xs={6} sm={4} md={3} lg={2} key={item.movie_id}>
                      <Box 
                        position="relative"
                        sx={{
                          '&:hover .mark-unwatched-btn': {
                            opacity: 1,
                          }
                        }}
                      >
                        <MoviePoster
                          title={item.title}
                          year={item.year}
                          posterUrl={item.poster_url}
                          genres={item.genres}
                          rating={item.community_rating}
                          overview={item.overview}
                          userRating={getRating('movie', item.movie_id)}
                          onRate={(rating) => setRating('movie', item.movie_id, rating)}
                          responsive
                          onClick={() => navigate(`/movies/${item.movie_id}`)}
                        />
                        {/* Play count badge - cap display at 5x, show "Rewatched" for higher */}
                        {item.play_count > 1 && (
                          <Chip
                            label={item.play_count <= 5 ? t('dashboard.playCount', { count: item.play_count }) : t('dashboard.rewatched')}
                            size="small"
                            sx={{
                              position: 'absolute',
                              top: 8,
                              left: 8,
                              backgroundColor: 'primary.main',
                              color: 'white',
                              fontWeight: 600,
                              fontSize: '0.7rem',
                              height: 22,
                            }}
                          />
                        )}
                        {/* Favorite badge */}
                        {item.is_favorite && (
                          <FavoriteIcon
                            sx={{
                              position: 'absolute',
                              bottom: 8,
                              right: 8,
                              color: 'error.main',
                              fontSize: 20,
                              filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
                            }}
                          />
                        )}
                        {/* Mark Unwatched button */}
                        {canManage && (
                          <Tooltip title={t('watchHistoryPage.markUnwatchedTooltip')}>
                            <IconButton
                              className="mark-unwatched-btn"
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirmDialog({
                                  open: true,
                                  type: 'movie',
                                  id: item.movie_id,
                                  title: item.title
                                })
                              }}
                              sx={{
                                position: 'absolute',
                                top: 8,
                                right: 8,
                                backgroundColor: 'rgba(0,0,0,0.7)',
                                color: 'white',
                                opacity: 0,
                                transition: 'opacity 0.2s',
                                '&:hover': {
                                  backgroundColor: 'error.main',
                                },
                              }}
                            >
                              <VisibilityOffIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {/* In-progress resume bar overlaid on the poster */}
                        {!item.played && Math.min(99, item.progress_percent ?? 0) >= 1 && (
                          <Box
                            sx={{
                              position: 'absolute',
                              bottom: 0,
                              left: 0,
                              right: 0,
                              height: 5,
                              backgroundColor: 'rgba(0,0,0,0.55)',
                              zIndex: 2,
                            }}
                          >
                            <Box
                              sx={{
                                width: `${Math.min(99, item.progress_percent ?? 0)}%`,
                                height: '100%',
                                backgroundColor: 'warning.main',
                              }}
                            />
                          </Box>
                        )}
                      </Box>
                      {/* In-progress / resume indicator */}
                      {!item.played && Math.min(99, item.progress_percent ?? 0) >= 1 && (
                        <Tooltip title={t('watchHistoryPage.inProgressTooltip', { percent: Math.min(99, item.progress_percent ?? 0) })}>
                          <Box display="flex" alignItems="center" gap={0.5} sx={{ mt: 0.5, width: 'fit-content' }}>
                            <PlayCircleOutlineIcon sx={{ fontSize: 12, color: 'warning.main' }} />
                            <Typography variant="caption" color="warning.main" noWrap sx={{ fontSize: '0.7rem', fontWeight: 600 }}>
                              {Math.min(99, item.progress_percent ?? 0)}%
                            </Typography>
                          </Box>
                        </Tooltip>
                      )}
                      {/* Last watched date */}
                      <Tooltip title={formatWatchHistoryExactDate(item.last_played_at, t)}>
                        <Box display="flex" alignItems="center" gap={0.5} sx={{ mt: 0.5, width: 'fit-content' }}>
                          <AccessTimeIcon sx={{ fontSize: 12, color: 'text.secondary' }} />
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ fontSize: '0.7rem' }}>
                            {formatWatchHistoryRelativeDate(item.last_played_at, t)}
                          </Typography>
                        </Box>
                      </Tooltip>
                    </Grid>
                  ))}
                </Grid>
              )}

              {/* List View */}
              {viewMode === 'list' && (
                <Box display="flex" flexDirection="column" gap={2}>
                  {filteredMovies.map((item) => (
                    <WatchHistoryMovieListItem
                      key={item.movie_id}
                      movie={item}
                      userRating={getRating('movie', item.movie_id)}
                      onRate={(rating) => setRating('movie', item.movie_id, rating)}
                      canManage={canManage}
                      onMarkUnwatched={() => setConfirmDialog({
                        open: true,
                        type: 'movie',
                        id: item.movie_id,
                        title: item.title
                      })}
                    />
                  ))}
                </Box>
              )}

              {/* Pagination */}
              {moviePagination.totalPages > 1 && (
                <Box display="flex" justifyContent="center" mt={3}>
                  <Pagination
                    count={moviePagination.totalPages}
                    page={moviePagination.page}
                    onChange={handleMoviePageChange}
                    color="primary"
                    showFirstButton
                    showLastButton
                  />
                </Box>
              )}
            </>
          )}
        </>
      )}

      {/* Series Tab Content */}
      {tabValue === 1 && (
        <>
          {filteredSeries.length === 0 ? (
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              {searchQuery
                ? t('watchHistoryPage.emptySearchSeries', { query: searchQuery })
                : t('watchHistoryPage.emptySeries')}
            </Alert>
          ) : (
            <>
              {/* Grid View */}
              {viewMode === 'grid' && (
                <Grid container spacing={2}>
                  {filteredSeries.map((item) => (
                    <Grid item xs={6} sm={4} md={3} lg={2} key={item.series_id}>
                      <Box
                        sx={{
                          '&:hover .mark-unwatched-btn': {
                            opacity: 1,
                          },
                          '&:hover .watching-toggle-btn': {
                            opacity: 1,
                          },
                        }}
                      >
                        <Box position="relative">
                          <MoviePoster
                            title={item.title}
                            year={item.year}
                            posterUrl={item.poster_url}
                            genres={item.genres}
                            rating={item.community_rating}
                            overview={item.overview}
                            userRating={getRating('series', item.series_id)}
                            onRate={(rating) => setRating('series', item.series_id, rating)}
                            responsive
                            hideRating
                            // Replaced by a distinct hover-revealed toggle at the top-right (below).
                            hideWatchingToggle
                            onClick={() => navigate(`/series/${item.series_id}`)}
                          />
                          {/* Add/remove from watching list — hover-revealed, top-left */}
                          <Tooltip
                            title={isWatching(item.series_id) ? t('watching.removeTooltip') : t('watching.addTooltip')}
                            arrow
                          >
                            <IconButton
                              className="watching-toggle-btn"
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleWatching(item.series_id)
                              }}
                              sx={{
                                position: 'absolute',
                                top: 8,
                                left: 8,
                                zIndex: 4,
                                opacity: 0,
                                color: '#fff',
                                bgcolor: isWatching(item.series_id)
                                  ? 'rgba(99, 102, 241, 0.95)'
                                  : 'rgba(0, 0, 0, 0.7)',
                                border: '1.5px solid rgba(255, 255, 255, 0.75)',
                                boxShadow: '0 2px 10px rgba(0, 0, 0, 0.45)',
                                backdropFilter: 'blur(4px)',
                                transition: 'opacity 0.2s ease, transform 0.2s ease, background-color 0.2s ease',
                                '&:hover': {
                                  bgcolor: isWatching(item.series_id) ? 'rgba(99, 102, 241, 1)' : 'rgba(0, 0, 0, 0.9)',
                                  transform: 'scale(1.12)',
                                },
                              }}
                            >
                              {isWatching(item.series_id) ? (
                                <PlaylistAddCheckIcon fontSize="small" />
                              ) : (
                                <AddToQueueIcon fontSize="small" />
                              )}
                            </IconButton>
                          </Tooltip>
                          {/* Favorite badge — top-right */}
                          {item.is_favorite && (
                            <FavoriteIcon
                              sx={{
                                position: 'absolute',
                                top: 8,
                                right: 8,
                                color: 'error.main',
                                fontSize: 20,
                                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
                              }}
                            />
                          )}
                          {/* Mark Unwatched button */}
                          {canManage && (
                            <Tooltip title={t('watchHistoryPage.markAllUnwatchedTooltip')}>
                              <IconButton
                                className="mark-unwatched-btn"
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setConfirmDialog({
                                    open: true,
                                    type: 'series',
                                    id: item.series_id,
                                    title: item.title
                                  })
                                }}
                                sx={{
                                  position: 'absolute',
                                  top: 8,
                                  // Sits to the right of the watching toggle (top-left group).
                                  left: 48,
                                  zIndex: 4,
                                  backgroundColor: 'rgba(0,0,0,0.7)',
                                  color: 'white',
                                  opacity: 0,
                                  transition: 'opacity 0.2s',
                                  '&:hover': {
                                    backgroundColor: 'error.main',
                                  },
                                }}
                              >
                                <VisibilityOffIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                        {/* Episodes progress below poster */}
                        <Box sx={{ mt: 0.5 }}>
                          <Box display="flex" alignItems="center" justifyContent="space-between">
                            <Typography variant="caption" color="text.secondary" fontSize="0.7rem">
                              {t('watchHistoryPage.episodesProgress', {
                                watched: item.episodes_watched,
                                total: item.total_episodes,
                              })}
                            </Typography>
                            <Typography
                              variant="caption"
                              fontWeight={600}
                              fontSize="0.7rem"
                              sx={{
                                color: item.total_episodes > 0 && item.episodes_watched === item.total_episodes ? 'success.main' : 'text.secondary'
                              }}
                            >
                              {item.total_episodes > 0
                                ? Math.round((item.episodes_watched / item.total_episodes) * 100)
                                : 0}%
                            </Typography>
                          </Box>
                          <LinearProgress
                            variant="determinate"
                            value={item.total_episodes > 0
                              ? Math.min((item.episodes_watched / item.total_episodes) * 100, 100)
                              : 0}
                            sx={{
                              height: 3,
                              borderRadius: 1,
                              mt: 0.5,
                              backgroundColor: 'grey.800',
                              '& .MuiLinearProgress-bar': {
                                backgroundColor: item.total_episodes > 0 && item.episodes_watched === item.total_episodes ? 'success.main' : 'primary.main',
                              },
                            }}
                          />
                          {/* Last watched date */}
                          <Tooltip title={formatWatchHistoryExactDate(item.last_played_at, t)}>
                            <Box display="flex" alignItems="center" gap={0.5} sx={{ mt: 0.5, width: 'fit-content' }}>
                              <AccessTimeIcon sx={{ fontSize: 12, color: 'text.secondary' }} />
                              <Typography variant="caption" color="text.secondary" noWrap sx={{ fontSize: '0.7rem' }}>
                                {formatWatchHistoryRelativeDate(item.last_played_at, t)}
                              </Typography>
                            </Box>
                          </Tooltip>
                        </Box>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              )}

              {/* List View */}
              {viewMode === 'list' && (
                <Box display="flex" flexDirection="column" gap={2}>
                  {filteredSeries.map((item) => (
                    <WatchHistorySeriesListItem
                      key={item.series_id}
                      series={item}
                      userRating={getRating('series', item.series_id)}
                      onRate={(rating) => setRating('series', item.series_id, rating)}
                      canManage={canManage}
                      onMarkUnwatched={() => setConfirmDialog({
                        open: true,
                        type: 'series',
                        id: item.series_id,
                        title: item.title
                      })}
                    />
                  ))}
                </Box>
              )}

              {/* Pagination */}
              {seriesPagination.totalPages > 1 && (
                <Box display="flex" justifyContent="center" mt={3}>
                  <Pagination
                    count={seriesPagination.totalPages}
                    page={seriesPagination.page}
                    onChange={handleSeriesPageChange}
                    color="primary"
                    showFirstButton
                    showLastButton
                  />
                </Box>
              )}
            </>
          )}
        </>
      )}

      {/* Confirmation Dialog */}
      <Dialog
        open={!!confirmDialog?.open}
        onClose={() => setConfirmDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t('watchHistoryPage.confirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirmDialog?.type === 'movie'
              ? t('watchHistoryPage.confirmMovieBody', { title: confirmDialog?.title ?? '' })
              : t('watchHistoryPage.confirmSeriesBody', { title: confirmDialog?.title ?? '' })}
          </DialogContentText>
          <DialogContentText sx={{ mt: 1, fontWeight: 500, color: 'warning.main' }}>
            {t('watchHistoryPage.cannotUndo')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(null)} disabled={markingUnwatched}>
            {t('common.cancel')}
          </Button>
          <Button 
            onClick={handleMarkUnwatched} 
            color="error" 
            variant="contained"
            disabled={markingUnwatched}
          >
            {markingUnwatched ? t('watchHistoryPage.marking') : t('watchHistoryPage.markUnwatched')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar for feedback */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        message={snackbar.message}
      />
    </Box>
  )
}
