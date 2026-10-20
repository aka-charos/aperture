import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import {
  Box,
  Typography,
  Paper,
  Divider,
  Switch,
  FormControlLabel,
  ToggleButtonGroup,
  ToggleButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  Chip,
  Tooltip,
  Button,
  Drawer,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import TuneIcon from '@mui/icons-material/Tune'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import HistoryIcon from '@mui/icons-material/History'
import {
  GraphLegend,
  useGraphData,
  useSimilarityData,
  type GraphNode,
  type GraphData,
  type LoadingStatus,
} from '../../components/SimilarityGraph'
import { GraphExplorer } from '../../components/GraphExplorer'
import { usePageHeader } from '@/hooks/usePageHeader'
import { MediaDetailModalProvider } from '@/hooks/MediaDetailModalProvider'
import { useOpenMedia } from '@/hooks/useOpenMedia'

type GraphSource = 'ai-movies' | 'ai-series' | 'watching' | 'top-movies' | 'top-series'

/** The heading of each browse graph, also its breadcrumb once the user drills in. */
const BROWSE_SOURCE_KEYS: Record<GraphSource, string> = {
  'ai-movies': 'mediaGraph.sourceAiMovies',
  'ai-series': 'mediaGraph.sourceAiSeries',
  watching: 'mediaGraph.sourceWatching',
  'top-movies': 'mediaGraph.sourceTopMovies',
  'top-series': 'mediaGraph.sourceTopSeries',
}
type MediaFilter = 'movie' | 'series' | 'both'

const RECENT_SEARCHES_KEY = 'aperture_recent_searches'
const MAX_RECENT_SEARCHES = 5

interface SemanticSearchState {
  query: string
  loading: boolean
  results: GraphData | null
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function ExplorePage() {
  // A poster opens over the graph, so closing it returns the reader to the
  // graph exactly as they left it instead of routing away from it.
  return (
    <MediaDetailModalProvider>
      <ExploreContent />
    </MediaDetailModalProvider>
  )
}

function ExploreContent() {
  const { t } = useTranslation()
  // No in-page block: the graph fills the viewport and breaks out of the
  // layout padding, so the bar is the only place a title fits.
  usePageHeader(t('nav.explore'))
  const theme = useTheme()
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'))
  const [controlsOpen, setControlsOpen] = useState(false)
  const openMedia = useOpenMedia()
  const [searchParams, setSearchParams] = useSearchParams()

  // Get initial state from URL params
  const initialType = searchParams.get('type') as 'movie' | 'series' | null
  const initialId = searchParams.get('id')
  const initialFocus = searchParams.get('focus')

  // Parse focus param (format: "movie:123" or "series:456")
  const parseFocus = (focus: string | null): { id: string; type: 'movie' | 'series' } | null => {
    if (!focus) return null
    const [type, id] = focus.split(':')
    if ((type === 'movie' || type === 'series') && id) {
      return { id, type }
    }
    return null
  }

  const initialFocusParsed = parseFocus(initialFocus)

  // State
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('both')
  const [crossMediaEnabled, setCrossMediaEnabled] = useState(false)
  const [hideWatched, setHideWatched] = useState(true) // Default to hiding watched content
  const [searchQuery, setSearchQuery] = useState('')
  const [browseSectionOpen, setBrowseSectionOpen] = useState(true)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [selectedBrowseSource, setSelectedBrowseSource] = useState<GraphSource | null>(null)

  // Focus state for rabbit-hole navigation
  const [focusedItemId, setFocusedItemId] = useState<string | null>(
    initialFocusParsed?.id || initialId || null
  )
  const [focusedItemType, setFocusedItemType] = useState<'movie' | 'series' | null>(
    initialFocusParsed?.type || initialType || null
  )

  // Breadcrumb history for drill-down navigation (tracks across search, browse
  // and focused modes). A 'browse' crumb is the browse graph the user left.
  const [breadcrumbHistory, setBreadcrumbHistory] = useState<Array<{
    id: string
    title: string
    type: 'movie' | 'series' | 'search' | 'browse'
  }>>([])

  // Semantic search state
  const [semanticSearch, setSemanticSearch] = useState<SemanticSearchState>({
    query: '',
    loading: false,
    results: null,
  })
  const [semanticLoadingStatus, setSemanticLoadingStatus] = useState<LoadingStatus | null>(null)
  const semanticLoadingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const semanticPhaseStartRef = useRef<number>(0)

  const semanticPhases = useMemo(
    () => ({
      searching: {
        messages: [
          t('mediaGraph.semanticSearchingMsg1'),
          t('mediaGraph.semanticSearchingMsg2'),
          t('mediaGraph.semanticSearchingMsg3'),
        ],
        details: [
          t('mediaGraph.semanticSearchingDetail1'),
          t('mediaGraph.semanticSearchingDetail2'),
          t('mediaGraph.semanticSearchingDetail3'),
        ],
      },
      clustering: {
        messages: [
          t('mediaGraph.semanticClusteringMsg1'),
          t('mediaGraph.semanticClusteringMsg2'),
          t('mediaGraph.semanticClusteringMsg3'),
        ],
        details: [
          t('mediaGraph.semanticClusteringDetail1'),
          t('mediaGraph.semanticClusteringDetail2'),
          t('mediaGraph.semanticClusteringDetail3'),
        ],
      },
      building: {
        messages: [
          t('mediaGraph.semanticBuildingMsg1'),
          t('mediaGraph.semanticBuildingMsg2'),
          t('mediaGraph.semanticBuildingMsg3'),
        ],
        details: [t('mediaGraph.semanticBuildingDetail1'), t('mediaGraph.semanticBuildingDetail2')],
      },
    }),
    [t]
  )

  // Start semantic search loading animation
  const startSemanticLoadingProgress = useCallback(() => {
    semanticPhaseStartRef.current = Date.now()
    setSemanticLoadingStatus({
      phase: 'fetching',
      message: randomItem(semanticPhases.searching.messages),
      progress: 5,
    })

    semanticLoadingTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - semanticPhaseStartRef.current

      setSemanticLoadingStatus(() => {
        // Searching phase (0-2s, 0-30%)
        if (elapsed < 2000) {
          return {
            phase: 'fetching',
            message: randomItem(semanticPhases.searching.messages),
            detail: randomItem(semanticPhases.searching.details),
            progress: Math.min(30, 5 + (elapsed / 2000) * 25),
          }
        }
        // AI Clustering phase (2-6s, 30-80%)
        if (elapsed < 6000) {
          const progress = 30 + ((elapsed - 2000) / 4000) * 50
          return {
            phase: 'validating',
            message: randomItem(semanticPhases.clustering.messages),
            detail: randomItem(semanticPhases.clustering.details),
            progress: Math.min(80, progress),
          }
        }
        // Building phase (6s+, 80-95%)
        return {
          phase: 'building',
          message: randomItem(semanticPhases.building.messages),
          detail: randomItem(semanticPhases.building.details),
          progress: Math.min(95, 80 + ((elapsed - 6000) / 3000) * 15),
        }
      })
    }, 300)
  }, [semanticPhases])

  const stopSemanticLoadingProgress = useCallback(() => {
    if (semanticLoadingTimerRef.current) {
      clearInterval(semanticLoadingTimerRef.current)
      semanticLoadingTimerRef.current = null
    }
    setSemanticLoadingStatus(null)
  }, [])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (semanticLoadingTimerRef.current) {
        clearInterval(semanticLoadingTimerRef.current)
      }
    }
  }, [])

  // Load recent searches from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY)
    if (stored) {
      try {
        setRecentSearches(JSON.parse(stored))
      } catch {
        // Ignore parse errors
      }
    }
  }, [])

  // Save recent searches to localStorage
  const saveRecentSearch = useCallback((query: string) => {
    setRecentSearches((prev) => {
      const updated = [query, ...prev.filter((s) => s !== query)].slice(0, MAX_RECENT_SEARCHES)
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated))
      return updated
    })
  }, [])

  // Fetch graph data for browse sources -- only once a source is chosen; the
  // fallback name is never fetched on its own.
  const { data: browseData, loading: browseLoading, loadingStatus: browseLoadingStatus, refetch } = useGraphData(
    selectedBrowseSource || 'ai-movies',
    {
      limit: 20,
      crossMedia: crossMediaEnabled,
      hideWatched,
      enabled: selectedBrowseSource !== null,
    }
  )

  // Fetch similarity data for a focused item (with rabbit-hole navigation).
  // The page's Hide watched switch is sent, so it governs this graph too.
  const {
    data: focusedData,
    loading: focusedLoading,
    loadingStatus: focusedLoadingStatus,
    setFocusId,
    startOver,
  } = useSimilarityData(focusedItemType || 'movie', focusedItemId, { limit: 15, depth: 3, hideWatched })

  // Determine what data to display
  const getDisplayData = (): { data: GraphData | null; loading: boolean; loadingStatus: LoadingStatus | null } => {
    // Semantic search takes priority when loading or has results
    if (semanticSearch.loading) {
      return { data: null, loading: true, loadingStatus: semanticLoadingStatus }
    }
    if (semanticSearch.results) {
      return { data: semanticSearch.results, loading: false, loadingStatus: null }
    }
    if (focusedItemId) {
      return { data: focusedData, loading: focusedLoading, loadingStatus: focusedLoadingStatus }
    }
    if (selectedBrowseSource) {
      return { data: browseData, loading: browseLoading, loadingStatus: browseLoadingStatus }
    }
    return { data: null, loading: false, loadingStatus: null }
  }

  const { data: displayData, loading, loadingStatus } = getDisplayData()

  // The cross-media switch is a parameter of the browse graph only -- semantic
  // search and the focused rabbit-hole graph come from endpoints that never
  // receive it. Leaving it live on those views is what made it look broken:
  // flipping it refetched browse data nobody was looking at.
  const crossMediaApplies =
    Boolean(selectedBrowseSource) &&
    !focusedItemId &&
    !semanticSearch.results &&
    !semanticSearch.loading

  // Update URL when focus changes
  useEffect(() => {
    if (focusedItemId && focusedItemType) {
      setSearchParams({ focus: `${focusedItemType}:${focusedItemId}` }, { replace: true })
    } else if (searchParams.has('focus') || searchParams.has('id') || searchParams.has('type')) {
      setSearchParams({}, { replace: true })
    }
  }, [focusedItemId, focusedItemType, setSearchParams, searchParams])

  // The search in flight, if any. A new search, choosing a browse source or
  // clearing aborts it: an answer arriving after any of those would otherwise
  // replace what the user moved on to (two quick searches: the older wins).
  const semanticRequestRef = useRef<AbortController | null>(null)
  const cancelSemanticSearch = useCallback(() => {
    semanticRequestRef.current?.abort()
    semanticRequestRef.current = null
  }, [])
  useEffect(() => cancelSemanticSearch, [cancelSemanticSearch])

  // Handle semantic search
  const handleSemanticSearch = useCallback(async (query: string) => {
    if (!query.trim()) return

    cancelSemanticSearch()
    const controller = new AbortController()
    semanticRequestRef.current = controller
    const isCurrent = () => semanticRequestRef.current === controller

    setSemanticSearch({ query, loading: true, results: null })
    startSemanticLoadingProgress()
    saveRecentSearch(query)

    // Clear other states
    setFocusedItemId(null)
    setFocusedItemType(null)
    setSelectedBrowseSource(null)

    try {
      const params = new URLSearchParams({
        q: query,
        type: mediaFilter,
        limit: '20',
        graph: 'true',
        hideWatched: hideWatched.toString(),
      })

      const response = await fetch(`/api/similarity/search?${params}`, {
        credentials: 'include',
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error('Search failed')
      }

      const result = await response.json()
      if (!isCurrent()) return
      semanticRequestRef.current = null
      stopSemanticLoadingProgress()
      setSemanticSearch({
        query,
        loading: false,
        results: result.graph,
      })
    } catch (error) {
      if (!isCurrent()) return
      semanticRequestRef.current = null
      console.error('Semantic search failed:', error)
      stopSemanticLoadingProgress()
      setSemanticSearch({ query, loading: false, results: null })
    }
  }, [mediaFilter, hideWatched, cancelSemanticSearch, startSemanticLoadingProgress, stopSemanticLoadingProgress, saveRecentSearch])

  // Handle browse source selection
  const handleBrowseSourceSelect = (source: GraphSource) => {
    cancelSemanticSearch()
    stopSemanticLoadingProgress()
    setBreadcrumbHistory([])
    setSelectedBrowseSource(source)
    setSemanticSearch({ query: '', loading: false, results: null })
    setFocusedItemId(null)
    setFocusedItemType(null)
    setSearchQuery('')
  }

  // Re-centre the graph on a title (rabbit-hole navigation): Shift+click, the
  // node's corner button, or a long press. A plain click opens the title.
  const handleNodeExplore = useCallback(
    (node: GraphNode) => {
      // Only the focused title itself is a no-op. On the browse and search
      // graphs every result is a centre, and those are what a user drills into.
      if (focusedItemId && node.id === focusedItemId) return

      // Track the current state in breadcrumb history before navigating
      if (semanticSearch.results && semanticSearch.query) {
        // Coming from semantic search - add search as starting point
        setBreadcrumbHistory([{
          id: 'search',
          title: `"${semanticSearch.query}"`,
          type: 'search',
        }])
        setSemanticSearch({ query: '', loading: false, results: null })
      } else if (!focusedItemId && selectedBrowseSource) {
        // Coming from a browse graph: its many centres are results, not where
        // the user stood, so the crumb is the graph itself.
        setBreadcrumbHistory([{
          id: `browse:${selectedBrowseSource}`,
          title: t(BROWSE_SOURCE_KEYS[selectedBrowseSource]),
          type: 'browse',
        }])
      } else if (displayData?.nodes) {
        // Coming from focused view - add current center to history
        const centerNode = displayData.nodes.find(n => n.isCenter)
        if (centerNode) {
          setBreadcrumbHistory(prev => [...prev, {
            id: centerNode.id,
            title: centerNode.title,
            type: centerNode.type,
          }])
        }
      }

      setFocusedItemId(node.id)
      setFocusedItemType(node.type)
      setFocusId(node.id, node.type)
    },
    [focusedItemId, selectedBrowseSource, semanticSearch.results, semanticSearch.query, displayData, setFocusId, t]
  )

  const handleNodeOpen = useCallback(
    (node: GraphNode) => {
      openMedia(node.type, node.id)
    },
    [openMedia]
  )

  // Handle history navigation (breadcrumb click)
  const handleHistoryNavigate = useCallback(
    (index: number) => {
      const item = breadcrumbHistory[index]
      if (!item) return

      if (item.type === 'search') {
        // Go back to search results - re-run the search
        const searchQuery = item.title.replace(/^"|"$/g, '') // Remove quotes
        handleSemanticSearch(searchQuery)
        setBreadcrumbHistory([])
      } else if (item.type === 'browse') {
        // Back to the browse graph, which is still loaded behind the focus
        setBreadcrumbHistory([])
        setFocusedItemId(null)
        setFocusedItemType(null)
      } else {
        // Go back to a specific item
        setFocusedItemId(item.id)
        setFocusedItemType(item.type)
        setFocusId(item.id, item.type)
        // Remove everything after this index
        setBreadcrumbHistory(prev => prev.slice(0, index))
      }
    },
    [breadcrumbHistory, handleSemanticSearch, setFocusId]
  )

  // Handle start over (home button)
  const handleStartOver = useCallback(() => {
    // Check if first breadcrumb is a search
    if (breadcrumbHistory.length > 0 && breadcrumbHistory[0].type === 'search') {
      const searchQuery = breadcrumbHistory[0].title.replace(/^"|"$/g, '')
      handleSemanticSearch(searchQuery)
    }
    setBreadcrumbHistory([])
    setFocusedItemId(null)
    setFocusedItemType(null)
    startOver()
  }, [breadcrumbHistory, handleSemanticSearch, startOver])

  // Handle clearing the search (clears results too)
  const handleSearchClear = useCallback(() => {
    cancelSemanticSearch()
    stopSemanticLoadingProgress()
    setSemanticSearch({ query: '', loading: false, results: null })
    setFocusedItemId(null)
    setFocusedItemType(null)
    setBreadcrumbHistory([])
  }, [cancelSemanticSearch, stopSemanticLoadingProgress])

  // Clear recent search
  const clearRecentSearch = (query: string) => {
    const updated = recentSearches.filter((s) => s !== query)
    setRecentSearches(updated)
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated))
  }

  // Handle refresh - re-run current search or refetch browse source
  const handleRefresh = useCallback(() => {
    if (semanticSearch.query) {
      // Re-run the semantic search
      handleSemanticSearch(semanticSearch.query)
    } else if (selectedBrowseSource) {
      // Refetch browse source data
      refetch()
    }
  }, [semanticSearch.query, handleSemanticSearch, selectedBrowseSource, refetch])

  // Determine if refresh should be shown
  const showRefreshButton = !!(semanticSearch.results || selectedBrowseSource || focusedItemId)

  const graphTitle = useMemo(() => {
    if (semanticSearch.query) {
      return t('mediaGraph.titleSearch', { query: semanticSearch.query })
    }
    if (selectedBrowseSource) {
      return t(BROWSE_SOURCE_KEYS[selectedBrowseSource])
    }
    return t('mediaGraph.titleDefault')
  }, [semanticSearch.query, selectedBrowseSource, t])

  const searchExamples = useMemo(
    () => [t('mediaGraph.example1'), t('mediaGraph.example2'), t('mediaGraph.example3')],
    [t]
  )

  // Choosing a source or re-running a search from the sheet is the end of that
  // visit to it; leaving it open would cover the graph that just changed.
  useEffect(() => {
    setControlsOpen(false)
  }, [selectedBrowseSource, semanticSearch.query])

  // The sidebar's controls, rendered beside the graph where there is room for
  // both and in a bottom sheet where there is not: a fixed 280px column next to
  // the graph left a phone about 80px of graph.
  const controls = (
    <>
      {/* Quick Filters */}
      <Box sx={{ px: 2, py: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
          {t('mediaGraph.filterByType')}
        </Typography>
        <ToggleButtonGroup
          value={mediaFilter}
          exclusive
          onChange={(_, value) => value && setMediaFilter(value)}
          size="small"
          fullWidth
          sx={{
            '& .MuiToggleButton-root': {
              py: 0.5,
              fontSize: '0.75rem',
            },
          }}
        >
          <ToggleButton value="movie">
            <MovieIcon fontSize="small" sx={{ mr: 0.5 }} />
            {t('mediaGraph.movies')}
          </ToggleButton>
          <ToggleButton value="series">
            <TvIcon fontSize="small" sx={{ mr: 0.5 }} />
            {t('mediaGraph.series')}
          </ToggleButton>
          <ToggleButton value="both">{t('mediaGraph.both')}</ToggleButton>
        </ToggleButtonGroup>

        {/* Hide Watched Toggle */}
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={hideWatched}
              onChange={(e) => setHideWatched(e.target.checked)}
            />
          }
          label={
            <Typography variant="caption" color="text.secondary">
              {t('mediaGraph.hideWatched')}
            </Typography>
          }
          sx={{ mt: 1.5, ml: 0 }}
        />
      </Box>

      <Divider />

      {/* Browse By Section */}
      <Box>
        <ListItemButton onClick={() => setBrowseSectionOpen(!browseSectionOpen)}>
          <ListItemText
            primary={t('mediaGraph.browseBy')}
            primaryTypographyProps={{ variant: 'subtitle2', fontWeight: 600 }}
          />
          {browseSectionOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </ListItemButton>

        <Collapse in={browseSectionOpen}>
          <List dense disablePadding>
            <ListItemButton
              selected={selectedBrowseSource === 'ai-movies'}
              onClick={() => handleBrowseSourceSelect('ai-movies')}
              sx={{ pl: 3 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <AutoAwesomeIcon fontSize="small" color="primary" />
              </ListItemIcon>
              <ListItemText primary={t('mediaGraph.sourceAiMovies')} />
            </ListItemButton>

            <ListItemButton
              selected={selectedBrowseSource === 'ai-series'}
              onClick={() => handleBrowseSourceSelect('ai-series')}
              sx={{ pl: 3 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <AutoAwesomeIcon fontSize="small" color="secondary" />
              </ListItemIcon>
              <ListItemText primary={t('mediaGraph.sourceAiSeries')} />
            </ListItemButton>

            <ListItemButton
              selected={selectedBrowseSource === 'watching'}
              onClick={() => handleBrowseSourceSelect('watching')}
              sx={{ pl: 3 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <PlaylistPlayIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={t('mediaGraph.sourceWatching')} />
            </ListItemButton>

            <ListItemButton
              selected={selectedBrowseSource === 'top-movies'}
              onClick={() => handleBrowseSourceSelect('top-movies')}
              sx={{ pl: 3 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <TrendingUpIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={t('mediaGraph.sourceTopMovies')} />
            </ListItemButton>

            <ListItemButton
              selected={selectedBrowseSource === 'top-series'}
              onClick={() => handleBrowseSourceSelect('top-series')}
              sx={{ pl: 3 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <TrendingUpIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={t('mediaGraph.sourceTopSeries')} />
            </ListItemButton>
          </List>
        </Collapse>
      </Box>

      <Divider />

      {/* Recent Searches */}
      {recentSearches.length > 0 && (
        <>
          <Box sx={{ p: 2 }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <HistoryIcon fontSize="small" />
              {t('mediaGraph.recentSearches')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {recentSearches.map((query) => (
                <Chip
                  key={query}
                  label={query}
                  size="small"
                  onClick={() => {
                    setSearchQuery(query)
                    handleSemanticSearch(query)
                  }}
                  onDelete={() => clearRecentSearch(query)}
                  sx={{ fontSize: '0.7rem' }}
                />
              ))}
            </Box>
          </Box>
          <Divider />
        </>
      )}

      {/* Connection Legend */}
      <Box sx={{ p: 2 }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
          {t('mediaGraph.connectionTypesHeading')}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
          {t('mediaGraph.connectionTypesHint')}
        </Typography>
        <GraphLegend orientation="column" />
      </Box>

      <Divider />

      {/* Cross-Media Toggle */}
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={crossMediaEnabled}
                disabled={!crossMediaApplies}
                onChange={(e) => setCrossMediaEnabled(e.target.checked)}
              />
            }
            label={<Typography variant="caption">{t('mediaGraph.crossMedia')}</Typography>}
            sx={{ mr: 0 }}
          />
          <Tooltip
            arrow
            placement="top"
            title={
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, py: 0.5 }}>
                <Typography variant="caption" component="span">
                  {t('mediaGraph.crossMediaHelp')}
                </Typography>
                <Typography variant="caption" component="span" sx={{ opacity: 0.85 }}>
                  {crossMediaApplies
                    ? t('mediaGraph.crossMediaHelpSlots')
                    : t('mediaGraph.crossMediaUnavailable')}
                </Typography>
              </Box>
            }
          >
            <InfoOutlinedIcon
              sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }}
              // Reachable without a mouse: the tooltip is the only place the
              // switch's behaviour is written down.
              tabIndex={0}
              role="button"
              aria-label={t('mediaGraph.crossMediaHelpAria')}
            />
          </Tooltip>
        </Box>
      </Box>
    </>
  )

  return (
    <Box 
      sx={{ 
        display: 'flex',
        position: 'relative',
        // Grows to include the impersonation banner when one is on screen —
        // see --aperture-chrome-top in Layout.
        height: 'calc(100dvh - var(--aperture-chrome-top, 64px))',
        // Break out of parent Layout padding
        m: { xs: -2, sm: -3 },
        width: { xs: 'calc(100% + 32px)', sm: 'calc(100% + 48px)' },
      }}
    >
      {/* Main Graph Area - Always uses GraphExplorer */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <GraphExplorer
          data={displayData}
          loading={loading}
          loadingStatus={loadingStatus}
          title={graphTitle}
          history={breadcrumbHistory}
          onHistoryNavigate={handleHistoryNavigate}
          onStartOver={handleStartOver}
          onNodeOpen={handleNodeOpen}
          onNodeExplore={handleNodeExplore}
          showSearch
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearch={handleSemanticSearch}
          onSearchClear={handleSearchClear}
          searchPlaceholder={t('mediaGraph.searchPlaceholder')}
          searchLoading={semanticSearch.loading}
          searchExamples={searchExamples}
          showCreatePlaylist
          showRefresh={showRefreshButton}
          onRefresh={handleRefresh}
          // In the header, beside Create playlist: floating over the graph it
          // sat on the legend and the hint line, the only text at that edge.
          extraActions={
            isNarrow ? (
              <Button
                variant="outlined"
                size="small"
                startIcon={<TuneIcon />}
                onClick={() => setControlsOpen(true)}
                sx={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}
              >
                {t('mediaGraph.controlsButton')}
              </Button>
            ) : undefined
          }
        />
      </Box>

      {/* Right Sidebar - Controls */}
      {isNarrow ? (
        <>
          <Drawer
            anchor="bottom"
            open={controlsOpen}
            onClose={() => setControlsOpen(false)}
            PaperProps={{
              sx: {
                maxHeight: '80dvh',
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                pb: 'env(safe-area-inset-bottom)',
              },
            }}
          >
            {controls}
          </Drawer>
        </>
      ) : (
        <Paper
          sx={{
            width: 280,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 0,
            borderLeft: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            height: '100%',
            overflowY: 'auto',
          }}
        >
          {controls}
        </Paper>
      )}
    </Box>
  )
}
