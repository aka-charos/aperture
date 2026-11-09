import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  TextField,
  InputAdornment,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Slider,
  Chip,
  Button,
  Alert,
  Paper,
  ToggleButton,
  ToggleButtonGroup,
  CircularProgress,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import FilterListIcon from '@mui/icons-material/FilterList'
import ClearAllIcon from '@mui/icons-material/ClearAll'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import { MoviePoster } from '@aperture/ui'
import { useUserRatings } from '../hooks/useUserRatings'
import { useWatchStatus } from '../hooks/useWatchStatus'
import { useWatching } from '../hooks/useWatching'
import { PageHeading } from '@/components/PageHeading'
import { MissingTitlesBanner } from '@/components/MissingTitlesBanner'
import { useMissingTitles } from '@/hooks/useMissingTitles'
import { genreLabel } from '@/lib/genreLabel'
import { runSearchPasses, type ReadResult } from './searchPasses'
import {
  adoptsAddress,
  readSearchState,
  searchStateParams,
  type SearchType,
  type SearchUrlState,
} from '@/lib/searchUrlState'

interface SearchResult {
  id: string
  type: 'movie' | 'series'
  title: string
  year: number | null
  genres: string[]
  overview: string | null
  poster_url: string | null
  community_rating: number | null
  rt_critic_score: number | null
  collection_name: string | null
  network: string | null
  combined_score: number
}

interface FilterOptions {
  genres: { name: string; count: number }[]
  collections: { name: string; count: number }[]
  networks: { name: string; count: number }[]
  yearRange: { min: number; max: number }
}

export function SearchPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { getRating, setRating } = useUserRatings()
  const { isWatched, getEpisodeProgress } = useWatchStatus()
  const { isWatching, toggleWatching } = useWatching()

  /**
   * The query and every filter, as the address holds them
   * (`lib/searchUrlState.ts`). Read on mount, and again whenever a search
   * started elsewhere arrives while this page is open (the search dialog's
   * "view all", back/forward). The page's own writes are replace navigations
   * and are never read back: they hold what is already here, and one landing
   * late would undo a keystroke. Taken over during render, so no effect ever
   * runs with the new address and the old search.
   */
  const location = useLocation()
  const navigationType = useNavigationType()
  const [search, setSearch] = useState<SearchUrlState>(() => readSearchState(searchParams))
  const [adoptedKey, setAdoptedKey] = useState(location.key)
  if (adoptedKey !== location.key) {
    setAdoptedKey(location.key)
    if (adoptsAddress(navigationType)) setSearch(readSearchState(searchParams))
  }
  const update = useCallback((patch: Partial<SearchUrlState>) => setSearch((prev) => ({ ...prev, ...patch })), [])
  const {
    q: query,
    type,
    genre,
    collection,
    network,
    minRtScore,
    semantic: useSemantic,
    yearMin,
    yearMax,
  } = search
  // Its own request; the library results never wait for it.
  const missing = useMissingTitles(query)
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  // Title matches are on screen and the semantic answer is still coming: the
  // grid is dimmed and takes no clicks, since that answer reorders it.
  const [provisional, setProvisional] = useState(false)
  // Which pass the results on screen came from, so the caption never calls
  // title matches semantic.
  const [rankedBySemantic, setRankedBySemantic] = useState(false)
  // Semantic was asked for and failed; the title matches are shown instead.
  const [semanticFailed, setSemanticFailed] = useState(false)
  // inert, not just pointer-events: a keyboard user must not open a
  // provisional poster either (Enter on a card the re-rank is about to move).
  const resultsGridRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (resultsGridRef.current) resultsGridRef.current.inert = provisional
  }, [provisional, results])
  const [error, setError] = useState<string | null>(null)
  const [totalResults, setTotalResults] = useState(0)
  // The API answers one list of at most this many, best first; there is no
  // second page to ask for.
  const pageSize = 24

  // Filter options the library offers
  const [filters, setFilters] = useState<FilterOptions | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  // Fetch filter options
  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const response = await fetch('/api/search/filters', { credentials: 'include' })
        if (response.ok) {
          const data = await response.json()
          setFilters(data)
        }
      } catch {
        // Ignore filter fetch errors
      }
    }
    fetchFilters()
  }, [])

  // Perform search. Every run takes its own signal and is aborted when the
  // query or a filter moves on, so a slow answer for earlier text (a semantic
  // one above all) can never land over the results for what is in the box.
  // With semantic on, the order of the two passes is searchPasses.ts's.
  const performSearch = useCallback(
    async (signal: AbortSignal) => {
      if (!query || query.trim().length < 2) {
        setResults([])
        setTotalResults(0)
        setLoading(false)
        setProvisional(false)
        setSemanticFailed(false)
        return
      }

      setLoading(true)
      setProvisional(false)
      setSemanticFailed(false)
      setError(null)

      const params = new URLSearchParams({
        q: query,
        limit: String(pageSize),
      })
      if (type !== 'all') params.set('type', type)
      if (genre) params.set('genre', genre)
      if (collection) params.set('collection', collection)
      if (network) params.set('network', network)
      if (minRtScore > 0) params.set('minRtScore', String(minRtScore))
      if (yearMin != null) params.set('yearMin', String(yearMin))
      if (yearMax != null) params.set('yearMax', String(yearMax))

      type Answer = { results: SearchResult[]; total: number }
      // 'failed' is an answer that came back refused; 'unreachable' never came.
      const read = async (values: URLSearchParams): Promise<ReadResult<Answer>> => {
        try {
          const response = await fetch(`/api/search?${values}`, { credentials: 'include', signal })
          return response.ok ? ((await response.json()) as Answer) : 'failed'
        } catch {
          return 'unreachable'
        }
      }

      const outcome = await runSearchPasses<Answer>({
        readTitle: () => read(params),
        readSemantic: useSemantic
          ? () => read(new URLSearchParams([...params, ['semantic', 'true']]))
          : null,
        aborted: () => signal.aborted,
        show: (answer, ranking, isProvisional) => {
          setResults(answer.results)
          setTotalResults(answer.total)
          setRankedBySemantic(ranking === 'semantic')
          setProvisional(isProvisional)
          setLoading(false)
          setError(null)
        },
      })
      if (outcome.status === 'aborted') return
      if (outcome.status !== 'shown') {
        setError(t(outcome.status === 'failed' ? 'search.errors.searchFailed' : 'search.errors.connect'))
      }
      setSemanticFailed(outcome.status === 'shown' && outcome.semanticFailed)
      setProvisional(false)
      setLoading(false)
    },
    [query, type, genre, collection, network, minRtScore, useSemantic, yearMin, yearMax, t]
  )

  // Debounced search
  useEffect(() => {
    const controller = new AbortController()
    const debounce = setTimeout(() => void performSearch(controller.signal), query ? 300 : 0)
    return () => {
      clearTimeout(debounce)
      controller.abort()
    }
  }, [performSearch, query])

  // Write the search back into the address, in place, only when it differs.
  useEffect(() => {
    const next = searchStateParams(search)
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true })
  }, [search, searchParams, setSearchParams])

  const handleRate = useCallback(
    async (itemId: string, itemType: 'movie' | 'series', rating: number | null) => {
      try {
        await setRating(itemType, itemId, rating)
      } catch (err) {
        console.error('Failed to rate:', err)
      }
    },
    [setRating]
  )

  const clearFilters = () =>
    setSearch((prev) => ({ ...readSearchState(new URLSearchParams()), q: prev.q }))

  const hasYearFilter = yearMin != null || yearMax != null

  const hasActiveFilters =
    type !== 'all' ||
    genre ||
    collection ||
    network ||
    minRtScore > 0 ||
    useSemantic ||
    hasYearFilter

  const filterPanelCount = useMemo(
    () =>
      [type !== 'all', genre, collection, network, minRtScore > 0, useSemantic, hasYearFilter].filter(
        Boolean
      ).length,
    [type, genre, collection, network, minRtScore, useSemantic, hasYearFilter]
  )

  return (
    <Box>
      <PageHeading
        title={t('search.title')}
        description={t('search.subtitle')}
        sx={{ mb: 4 }}
      />

      {/* Search Input */}
      <Box mb={3}>
        <TextField
          fullWidth
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(e) => update({ q: e.target.value })}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
            endAdornment: (loading || provisional) && (
              <InputAdornment position="end">
                <CircularProgress size={20} />
              </InputAdornment>
            ),
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 3,
              fontSize: '1.1rem',
            },
          }}
        />
      </Box>

      <MissingTitlesBanner found={missing} variant="page" />

      {/* Filter Toggle */}
      <Box display="flex" gap={2} mb={3} flexWrap="wrap" alignItems="center">
        <Button
          variant={showFilters ? 'contained' : 'outlined'}
          startIcon={<FilterListIcon />}
          onClick={() => setShowFilters(!showFilters)}
          size="small"
        >
          {hasActiveFilters
            ? t('search.filtersButtonWithCount', { count: filterPanelCount })
            : t('search.filtersButton')}
        </Button>

        <ToggleButtonGroup
          value={type}
          exclusive
          onChange={(_, value: SearchType | null) => value && update({ type: value })}
          size="small"
        >
          <ToggleButton value="all">{t('search.typeAll')}</ToggleButton>
          <ToggleButton value="movie">
            <MovieIcon sx={{ mr: 0.5, fontSize: 18 }} /> {t('search.typeMovies')}
          </ToggleButton>
          <ToggleButton value="series">
            <TvIcon sx={{ mr: 0.5, fontSize: 18 }} /> {t('search.typeSeries')}
          </ToggleButton>
        </ToggleButtonGroup>

        <Button
          variant={useSemantic ? 'contained' : 'outlined'}
          color={useSemantic ? 'secondary' : 'inherit'}
          startIcon={<AutoAwesomeIcon />}
          onClick={() => update({ semantic: !useSemantic })}
          size="small"
        >
          {t('search.aiSearch')}
        </Button>

        {hasActiveFilters && (
          <Button
            variant="text"
            startIcon={<ClearAllIcon />}
            onClick={clearFilters}
            size="small"
          >
            {t('search.clearFilters')}
          </Button>
        )}
      </Box>

      {/* Expanded Filters */}
      {showFilters && filters && (
        <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 3, borderRadius: 2 }}>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('browse.labels.genre')}</InputLabel>
                <Select
                  value={genre}
                  label={t('browse.labels.genre')}
                  onChange={(e) => update({ genre: e.target.value })}
                >
                  <MenuItem value="">{t('browse.labels.allGenres')}</MenuItem>
                  {filters.genres.map((g) => (
                    <MenuItem key={g.name} value={g.name}>
                      {genreLabel(g.name)} ({g.count})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('browse.labels.franchise')}</InputLabel>
                <Select
                  value={collection}
                  label={t('browse.labels.franchise')}
                  onChange={(e) => update({ collection: e.target.value })}
                  disabled={type === 'series'}
                >
                  <MenuItem value="">{t('browse.labels.allFranchises')}</MenuItem>
                  {filters.collections.map((c) => (
                    <MenuItem key={c.name} value={c.name}>
                      {c.name} ({c.count})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('browse.labels.network')}</InputLabel>
                <Select
                  value={network}
                  label={t('browse.labels.network')}
                  onChange={(e) => update({ network: e.target.value })}
                  disabled={type === 'movie'}
                >
                  <MenuItem value="">{t('browse.labels.allNetworks')}</MenuItem>
                  {filters.networks.map((n) => (
                    <MenuItem key={n.name} value={n.name}>
                      {n.name} ({n.count})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="caption" color="text.secondary" gutterBottom display="block">
                {t('search.minRtCaption', {
                  value: minRtScore > 0 ? `${minRtScore}%` : t('search.minRtAny'),
                })}
              </Typography>
              <Slider
                value={minRtScore}
                onChange={(_, value) => update({ minRtScore: value as number })}
                min={0}
                max={100}
                step={10}
                size="small"
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <Typography variant="caption" color="text.secondary" gutterBottom display="block">
                {t('search.yearRangeCaption', {
                  min: yearMin ?? filters.yearRange.min,
                  max: yearMax ?? filters.yearRange.max,
                })}
              </Typography>
              <Slider
                value={[yearMin ?? filters.yearRange.min, yearMax ?? filters.yearRange.max]}
                onChange={(_, value) => {
                  // At the library's own end of the range, that side is no limit.
                  const [min, max] = value as [number, number]
                  update({
                    yearMin: min > filters.yearRange.min ? min : null,
                    yearMax: max < filters.yearRange.max ? max : null,
                  })
                }}
                min={filters.yearRange.min}
                max={filters.yearRange.max}
                valueLabelDisplay="auto"
                size="small"
              />
            </Grid>
          </Grid>
        </Paper>
      )}

      {/* Active Filter Chips */}
      {hasActiveFilters && (
        <Box display="flex" gap={1} mb={3} flexWrap="wrap">
          {genre && (
            <Chip
              label={t('search.chipGenre', { value: genre })}
              onDelete={() => update({ genre: '' })}
              size="small"
            />
          )}
          {collection && (
            <Chip
              label={t('search.chipFranchise', { value: collection })}
              onDelete={() => update({ collection: '' })}
              size="small"
            />
          )}
          {network && (
            <Chip
              label={t('search.chipNetwork', { value: network })}
              onDelete={() => update({ network: '' })}
              size="small"
            />
          )}
          {hasYearFilter && (
            <Chip
              label={t('search.yearRangeCaption', {
                min: yearMin ?? filters?.yearRange.min ?? '…',
                max: yearMax ?? filters?.yearRange.max ?? '…',
              })}
              onDelete={() => update({ yearMin: null, yearMax: null })}
              size="small"
            />
          )}
          {minRtScore > 0 && (
            <Chip
              label={t('search.chipRt', { value: minRtScore })}
              onDelete={() => update({ minRtScore: 0 })}
              size="small"
            />
          )}
          {useSemantic && (
            <Chip
              icon={<AutoAwesomeIcon />}
              label={t('search.aiSearch')}
              onDelete={() => update({ semantic: false })}
              size="small"
              color="secondary"
            />
          )}
        </Box>
      )}

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}
      {semanticFailed && !error && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {t('search.semanticFailed')}
        </Alert>
      )}

      {/* Results */}
      {!query && (
        <Box textAlign="center" py={8}>
          <SearchIcon sx={{ fontSize: 64, opacity: 0.2, mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            {t('search.emptyTitle')}
          </Typography>
          <Typography variant="body2" color="text.disabled" mt={1}>
            {t('search.emptyHint')}
          </Typography>
        </Box>
      )}

      {query && !loading && !provisional && !error && results.length === 0 && (
        <Box textAlign="center" py={8}>
          <Typography variant="h6" color="text.secondary">
            {t('search.noResults', { query })}
          </Typography>
          <Typography variant="body2" color="text.disabled" mt={1}>
            {t('search.noResultsHint')}
          </Typography>
        </Box>
      )}

      {results.length > 0 && (
        <>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('search.foundResults', {
              count: totalResults,
              query,
            })}
            {rankedBySemantic
              ? t('search.semanticSuffix')
              : provisional
                ? t('search.semanticPendingSuffix')
                : ''}
          </Typography>

          {/* Provisional title matches take no clicks or keys (inert, set
              above): the semantic answer reorders them, and an activation
              could land on the poster moved there. */}
          <Grid
            ref={resultsGridRef}
            container
            spacing={2}
            aria-busy={provisional}
            sx={{ opacity: provisional ? 0.55 : 1, transition: 'opacity 150ms' }}
          >
            {results.map((result) => (
              <Grid item xs={6} sm={4} md={3} lg={2} key={`${result.type}-${result.id}`}>
                <MoviePoster
                  title={result.title}
                  year={result.year}
                  posterUrl={result.poster_url}
                  rating={result.community_rating}
                  genres={result.genres}
                  overview={result.overview}
                  titleRef={{ mediaType: result.type, id: result.id }}
                  userRating={getRating(result.type, result.id)}
                  watched={isWatched(result.type, result.id)}
                  episodeProgress={getEpisodeProgress(result.type, result.id)}
                  onRate={(rating) => handleRate(result.id, result.type, rating)}
                  isWatching={result.type === 'series' ? isWatching(result.id) : undefined}
                  onWatchingToggle={result.type === 'series' ? () => toggleWatching(result.id) : undefined}
                  hideWatchingToggle={result.type !== 'series'}
                  // Movies and series share this grid; keep the cards one height.
                  reserveWatchingToggleSpace
                  responsive
                  onClick={() => navigate(`/${result.type === 'movie' ? 'movies' : 'series'}/${result.id}`)}
                />
              </Grid>
            ))}
          </Grid>
        </>
      )}
    </Box>
  )
}


