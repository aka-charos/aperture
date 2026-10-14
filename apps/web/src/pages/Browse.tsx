import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import {
  Box,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  useTheme,
} from '@mui/material'
import MovieIcon from '@mui/icons-material/Movie'
import PersonIcon from '@mui/icons-material/Person'
import TvIcon from '@mui/icons-material/Tv'
import GridViewIcon from '@mui/icons-material/GridView'
import ViewListIcon from '@mui/icons-material/ViewList'
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary'
import type { SortField, SortOrder } from './browse/components'
import { browseTabFromSearchParam } from './browse/constants'
import { readBrowseUrl, writeBrowseUrl, type BrowseTab } from './browse/urlState'
import { BrowseMoviesTab } from './browse/BrowseMoviesTab'
import { BrowsePeopleTab } from './browse/BrowsePeopleTab'
import { BrowseSeriesTab } from './browse/BrowseSeriesTab'
import { useBrowseFilterPresets, useBrowseMovies, useBrowsePeople, useBrowseSeries } from './browse/hooks'
import { useViewMode } from '../hooks/useViewMode'
import { useServerDisplayName } from '../hooks/useServerDisplayName'
import { useCapability } from '../hooks/useCapability'
import { PageHeading } from '@/components/PageHeading'

export function BrowsePage() {
  const { t } = useTranslation()
  const theme = useTheme()
  const serverName = useServerDisplayName()
  const [searchParams, setSearchParams] = useSearchParams()
  // The selection lives in the URL (browse/urlState.ts), so going back to
  // Browse from a title restores exactly what was on screen. Read once, on
  // arrival: from then on the page's own state is the source and the URL
  // follows it.
  const [urlState] = useState(() => readBrowseUrl(searchParams))
  const initialTabIndex = browseTabFromSearchParam(searchParams.get('tab'))
  // Which kinds this viewer can see, decided by the server (F-136). A kind
  // they cannot see gets no tab, and a link to it opens the first one they can.
  const hasMovies = useCapability('movies')
  const hasSeries = useCapability('series')
  const firstVisibleTab = hasMovies ? 0 : hasSeries ? 1 : 2
  const visibleTab = useCallback(
    (index: number) =>
      (index === 0 && !hasMovies) || (index === 1 && !hasSeries) ? firstVisibleTab : index,
    [firstVisibleTab, hasMovies, hasSeries]
  )
  const [tabIndex, setTabIndex] = useState(() => visibleTab(initialTabIndex))
  const tabQuery = searchParams.get('tab')
  const { viewMode, setViewMode } = useViewMode('browse')
  const { viewMode: peopleViewMode, setViewMode: setPeopleViewMode } = useViewMode('browsePeople')
  const presetsRef = useRef<ReturnType<typeof useBrowseFilterPresets> | null>(null)

  useEffect(() => {
    setTabIndex(visibleTab(browseTabFromSearchParam(tabQuery)))
  }, [tabQuery, visibleTab])

  const persistMovieSort = useCallback((sortBy: SortField, sortOrder: SortOrder) => {
    void presetsRef.current?.persistSortPreferences('movies', sortBy, sortOrder)
  }, [])

  const persistSeriesSort = useCallback((sortBy: SortField, sortOrder: SortOrder) => {
    void presetsRef.current?.persistSortPreferences('series', sortBy, sortOrder)
  }, [])

  const movies = useBrowseMovies({ tabIndex, persistSortPreferences: persistMovieSort, initial: urlState.movies })
  const series = useBrowseSeries({ tabIndex, persistSortPreferences: persistSeriesSort, initial: urlState.series })
  const people = useBrowsePeople({
    tabIndex,
    initialTabIsPeople: initialTabIndex === 2,
    initial: urlState.people,
  })
  // The saved sort preference loads after the page does. A sort the URL
  // carried is what was on screen, so it wins: the preference applies only to
  // a visit whose URL named no sort.
  const keepMovieSort = urlState.movies.sortBy !== undefined
  const keepSeriesSort = urlState.series.sortBy !== undefined
  const presetSortSetters = useMemo(() => {
    const ignore = () => {}
    return {
      setMovieSortBy: keepMovieSort ? ignore : movies.setMovieSortBy,
      setMovieSortOrder: keepMovieSort ? ignore : movies.setMovieSortOrder,
      setSeriesSortBy: keepSeriesSort ? ignore : series.setSeriesSortBy,
      setSeriesSortOrder: keepSeriesSort ? ignore : series.setSeriesSortOrder,
    }
  }, [
    keepMovieSort,
    keepSeriesSort,
    movies.setMovieSortBy,
    movies.setMovieSortOrder,
    series.setSeriesSortBy,
    series.setSeriesSortOrder,
  ])
  const presets = useBrowseFilterPresets(presetSortSetters)
  presetsRef.current = presets

  // Write what is on screen back into the URL. In place (replace), so moving a
  // slider does not add a history entry; the entry that Back returns to simply
  // holds the latest selection. Switching tabs still adds one (handleTabChange).
  const tabName: BrowseTab = tabIndex === 1 ? 'series' : tabIndex === 2 ? 'people' : 'movies'
  const browseQuery = useMemo(
    () =>
      writeBrowseUrl(tabName, {
        movies: {
          search: movies.movieSearch,
          genre: movies.movieGenre,
          group: movies.collection,
          filters: movies.movieFilters,
          sortBy: movies.movieSortBy,
          sortOrder: movies.movieSortOrder,
          ranges: movies.movieRanges,
        },
        series: {
          search: series.seriesSearch,
          genre: series.seriesGenre,
          group: series.network,
          filters: series.seriesFilters,
          sortBy: series.seriesSortBy,
          sortOrder: series.seriesSortOrder,
          ranges: series.seriesRanges,
        },
        people: { search: people.peopleSearch, sortBy: people.peopleSortBy },
      }),
    [
      tabName,
      movies.movieSearch,
      movies.movieGenre,
      movies.collection,
      movies.movieFilters,
      movies.movieSortBy,
      movies.movieSortOrder,
      movies.movieRanges,
      series.seriesSearch,
      series.seriesGenre,
      series.network,
      series.seriesFilters,
      series.seriesSortBy,
      series.seriesSortOrder,
      series.seriesRanges,
      people.peopleSearch,
      people.peopleSortBy,
    ]
  )
  useEffect(() => {
    if (browseQuery !== searchParams.toString()) {
      setSearchParams(new URLSearchParams(browseQuery), { replace: true })
    }
  }, [browseQuery, searchParams, setSearchParams])

  const currentViewMode = tabIndex === 2 ? peopleViewMode : viewMode
  const handleTabChange = useCallback(
    (_event: SyntheticEvent, newValue: number) => {
      setTabIndex(newValue)
      setSearchParams({ tab: newValue === 1 ? 'series' : newValue === 2 ? 'people' : 'movies' })
    },
    [setSearchParams]
  )

  const handleViewModeChange = useCallback(
    (_event: MouseEvent<HTMLElement>, nextViewMode: 'grid' | 'list' | null) => {
      if (!nextViewMode) return
      if (tabIndex === 2) {
        setPeopleViewMode(nextViewMode)
      } else {
        setViewMode(nextViewMode)
      }
    },
    [setPeopleViewMode, setViewMode, tabIndex]
  )

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={3}>
        <PageHeading
          title={t('browse.title')}
          description={t(serverName ? 'browse.subtitleLineNamed' : 'browse.subtitleLine', {
            ...(serverName ? { serverName } : {}),
            count:
              tabIndex === 0
                ? movies.movieTotal.toLocaleString()
                : tabIndex === 1
                  ? series.seriesTotal.toLocaleString()
                  : people.peopleTotal.toLocaleString(),
            kind:
              tabIndex === 0
                ? t('browse.subtitleKindMovies')
                : tabIndex === 1
                  ? t('browse.subtitleKindSeries')
                  : t('browse.subtitleKindPeople'),
          })}
          icon={<VideoLibraryIcon sx={{ color: 'primary.main', fontSize: 28 }} />}
          sx={{ mb: 0 }}
        />

        <ToggleButtonGroup value={currentViewMode} exclusive onChange={handleViewModeChange} size="small">
          <ToggleButton value="grid">
            <GridViewIcon fontSize="small" />
          </ToggleButton>
          <ToggleButton value="list">
            <ViewListIcon fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          value={tabIndex}
          onChange={handleTabChange}
          sx={{
            '& .MuiTab-root': {
              minHeight: 48,
              textTransform: 'none',
              fontWeight: 500,
            },
          }}
        >
          {hasMovies && <Tab
            value={0}
            icon={<MovieIcon />}
            iconPosition="start"
            label={t('browse.tabMovies')}
            sx={{
              color: tabIndex === 0 ? theme.palette.primary.main : 'text.secondary',
              '&.Mui-selected': { color: theme.palette.primary.main },
            }}
          />}
          {hasSeries && <Tab
            value={1}
            icon={<TvIcon />}
            iconPosition="start"
            label={t('browse.tabSeries')}
            sx={{
              color: tabIndex === 1 ? '#ec4899' : 'text.secondary',
              '&.Mui-selected': { color: '#ec4899' },
            }}
          />}
          <Tab
            value={2}
            icon={<PersonIcon />}
            iconPosition="start"
            label={t('browse.tabPeople')}
            sx={{
              color: tabIndex === 2 ? '#14b8a6' : 'text.secondary',
              '&.Mui-selected': { color: '#14b8a6' },
            }}
          />
        </Tabs>
      </Box>

      {tabIndex === 0 ? (
        <BrowseMoviesTab viewMode={viewMode} movies={movies} presets={presets} />
      ) : tabIndex === 1 ? (
        <BrowseSeriesTab viewMode={viewMode} series={series} presets={presets} />
      ) : (
        <BrowsePeopleTab viewMode={peopleViewMode} people={people} />
      )}
    </Box>
  )
}
