import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Button,
  Collapse,
  Divider,
  IconButton,
  Paper,
  Popper,
  Typography,
  alpha,
  useTheme,
  ClickAwayListener,
  Badge,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material'
import FilterListIcon from '@mui/icons-material/FilterList'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import { RangeSlider } from './RangeSlider'
import { ChipToggleGroup } from './ChipToggleGroup'
import { useServerDisplayName } from '../../../hooks/useServerDisplayName'

export type WatchStatusFilter = 'any' | 'watched' | 'unwatched'

// How multiple selected countries are combined: 'all' = must match every
// selected country (AND), 'any' = match at least one (OR).
export type CountryMatchMode = 'all' | 'any'

export interface MovieFilters {
  yearRange: [number, number]
  runtimeRange: [number, number]
  communityRating: [number, number]
  rtScore: [number, number]
  metacritic: [number, number]
  contentRatings: string[]
  resolutions: string[]
  countries: string[]
  countryMatch: CountryMatchMode
  watchStatus: WatchStatusFilter
  minWatchers: number | null
  maxWatchers: number | null
}

export interface SeriesFilters {
  yearRange: [number, number]
  seasonsRange: [number, number]
  communityRating: [number, number]
  rtScore: [number, number]
  metacritic: [number, number]
  contentRatings: string[]
  status: string[]
  countries: string[]
  countryMatch: CountryMatchMode
  watchStatus: WatchStatusFilter
  minWatchers: number | null
  maxWatchers: number | null
}

interface FilterPopperProps {
  type: 'movies' | 'series'
  filters: MovieFilters | SeriesFilters
  onChange: (filters: MovieFilters | SeriesFilters) => void
  contentRatings: { rating: string; count: number }[]
  resolutions?: { resolution: string; count: number }[]
  ranges: {
    year: { min: number; max: number }
    runtime?: { min: number; max: number }
    seasons?: { min: number; max: number }
    rating: { min: number; max: number }
  }
}

const defaultMovieFilters: MovieFilters = {
  yearRange: [1900, new Date().getFullYear()],
  runtimeRange: [0, 300],
  communityRating: [0, 10],
  rtScore: [0, 100],
  metacritic: [0, 100],
  contentRatings: [],
  resolutions: [],
  countries: [],
  countryMatch: 'all',
  watchStatus: 'any',
  minWatchers: null,
  maxWatchers: null,
}

const defaultSeriesFilters: SeriesFilters = {
  yearRange: [1950, new Date().getFullYear()],
  seasonsRange: [1, 30],
  communityRating: [0, 10],
  rtScore: [0, 100],
  metacritic: [0, 100],
  contentRatings: [],
  status: [],
  countries: [],
  countryMatch: 'all',
  watchStatus: 'any',
  minWatchers: null,
  maxWatchers: null,
}

/**
 * One titled block of the panel. Module scope, not a closure in the component:
 * a component type recreated on every render remounts its children, and the
 * watcher fields would lose focus after each keystroke.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="overline"
        component="div"
        color="text.secondary"
        sx={{ fontWeight: 700, letterSpacing: '0.08em', lineHeight: 1.6, mb: 1 }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  )
}

const COLUMNS = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
  columnGap: 3,
  rowGap: 2.5,
} as const

export function FilterPopper({
  type,
  filters,
  onChange,
  contentRatings,
  resolutions,
  ranges,
}: FilterPopperProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const serverName = useServerDisplayName()
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null)
  const [contentOpen, setContentOpen] = useState(false)

  const open = Boolean(anchorEl)

  const handleReset = () => {
    // Countries live in the dedicated country filter button; only reset what this popper shows.
    if (type === 'movies') {
      onChange({
        ...defaultMovieFilters,
        countries: filters.countries,
        countryMatch: filters.countryMatch,
        yearRange: [ranges.year.min, ranges.year.max],
        runtimeRange: ranges.runtime ? [ranges.runtime.min, ranges.runtime.max] : [0, 300],
      })
    } else {
      onChange({
        ...defaultSeriesFilters,
        countries: filters.countries,
        countryMatch: filters.countryMatch,
        yearRange: [ranges.year.min, ranges.year.max],
        seasonsRange: ranges.seasons ? [ranges.seasons.min, ranges.seasons.max] : [1, 30],
      })
    }
  }

  const parseOptionalInt = (raw: string): number | null => {
    const t = raw.trim()
    if (t === '') return null
    const n = parseInt(t, 10)
    return Number.isNaN(n) ? null : n
  }

  // Count active filters
  const getActiveFilterCount = () => {
    let count = 0
    
    if (type === 'movies') {
      const f = filters as MovieFilters
      if (f.yearRange[0] > ranges.year.min || f.yearRange[1] < ranges.year.max) count++
      if (f.runtimeRange[0] > (ranges.runtime?.min || 0) || f.runtimeRange[1] < (ranges.runtime?.max || 300)) count++
      if (f.communityRating[0] > 0 || f.communityRating[1] < 10) count++
      if (f.rtScore[0] > 0 || f.rtScore[1] < 100) count++
      if (f.metacritic[0] > 0 || f.metacritic[1] < 100) count++
      if (f.contentRatings.length > 0) count++
      if (f.resolutions.length > 0) count++
      if (f.watchStatus !== 'any') count++
      if (f.minWatchers !== null) count++
      if (f.maxWatchers !== null) count++
    } else {
      const f = filters as SeriesFilters
      if (f.yearRange[0] > ranges.year.min || f.yearRange[1] < ranges.year.max) count++
      if (f.seasonsRange[0] > (ranges.seasons?.min || 1) || f.seasonsRange[1] < (ranges.seasons?.max || 30)) count++
      if (f.communityRating[0] > 0 || f.communityRating[1] < 10) count++
      if (f.rtScore[0] > 0 || f.rtScore[1] < 100) count++
      if (f.metacritic[0] > 0 || f.metacritic[1] < 100) count++
      if (f.contentRatings.length > 0) count++
      if (f.status.length > 0) count++
      if (f.watchStatus !== 'any') count++
      if (f.minWatchers !== null) count++
      if (f.maxWatchers !== null) count++
    }
    
    return count
  }

  const activeCount = getActiveFilterCount()

  // The status-like choices (watch state, airing/ended, video quality) are what
  // people reach for most, so they open the panel instead of trailing its last
  // section; ranges and scores sit side by side under them. Only content rating
  // folds away, since a library can carry twenty of them.
  const movieFilters = type === 'movies' ? (filters as MovieFilters) : null
  const seriesFilters = type === 'series' ? (filters as SeriesFilters) : null

  return (
    <>
      <Badge badgeContent={activeCount} color="primary" overlap="rectangular">
        <Button
          variant="outlined"
          startIcon={<FilterListIcon />}
          onClick={(e) => setAnchorEl(anchorEl ? null : e.currentTarget)}
          size="small"
          sx={{
            height: 40,
            px: 1.75,
            borderColor: open || activeCount > 0 ? 'primary.main' : alpha(theme.palette.text.primary, 0.23),
            color: open || activeCount > 0 ? 'primary.main' : 'text.primary',
            backgroundColor: open ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
            textTransform: 'none',
            fontWeight: 400,
            '&:hover': {
              borderColor: open || activeCount > 0 ? 'primary.main' : 'text.primary',
              backgroundColor: alpha(theme.palette.primary.main, 0.08),
            },
          }}
        >
          {t('filterPopper.filters')}
        </Button>
      </Badge>

      <Popper
        open={open}
        anchorEl={anchorEl}
        placement="bottom-start"
        sx={{ zIndex: 1300 }}
        modifiers={[
          { name: 'offset', options: { offset: [0, 8] } },
          { name: 'preventOverflow', options: { padding: 8 } },
        ]}
      >
        <ClickAwayListener onClickAway={() => setAnchorEl(null)}>
          <Paper
            elevation={8}
            sx={{
              width: 'min(620px, calc(100vw - 16px))',
              maxHeight: 'min(78vh, 760px)',
              overflowY: 'auto',
              // A slider thumb at either end sits half outside its track; without
              // this it put a horizontal scrollbar under the whole panel.
              overflowX: 'hidden',
              borderRadius: 2,
              border: 1,
              borderColor: 'divider',
            }}
          >
            {/* Header */}
            <Box
              sx={{
                px: 2.5,
                py: 1.5,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: 1,
                borderColor: 'divider',
                position: 'sticky',
                top: 0,
                backgroundColor: 'background.paper',
                zIndex: 1,
              }}
            >
              <Typography variant="subtitle1" fontWeight={700}>
                {t('filterPopper.filters')}
              </Typography>
              <IconButton size="small" onClick={handleReset} title={t('filterPopper.resetAllTooltip')}>
                <RestartAltIcon fontSize="small" />
              </IconButton>
            </Box>

            <Box sx={{ px: 2.5, py: 2, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              {/* Status-like choices first */}
              <Box sx={COLUMNS}>
                <Section title={t('filterPopper.sections.watchStatus')}>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    fullWidth
                    value={filters.watchStatus}
                    onChange={(_, v: WatchStatusFilter | null) => {
                      if (v !== null) onChange({ ...filters, watchStatus: v })
                    }}
                  >
                    <ToggleButton value="any">{t('filterPopper.watchAny')}</ToggleButton>
                    <ToggleButton value="watched">{t('filterPopper.watchWatched')}</ToggleButton>
                    <ToggleButton value="unwatched">{t('filterPopper.watchUnwatched')}</ToggleButton>
                  </ToggleButtonGroup>
                </Section>

                {seriesFilters && (
                  <Section title={t('filterPopper.sections.status')}>
                    <ChipToggleGroup
                      label=""
                      options={[
                        { value: 'Continuing', label: t('filterPopper.seriesAiring') },
                        { value: 'Ended', label: t('filterPopper.seriesEnded') },
                      ]}
                      selected={seriesFilters.status}
                      onChange={(selected) => onChange({ ...filters, status: selected })}
                    />
                  </Section>
                )}

                {movieFilters && resolutions && resolutions.length > 0 && (
                  <Section title={t('filterPopper.sections.videoQuality')}>
                    <ChipToggleGroup
                      label=""
                      options={resolutions.map((r) => ({
                        value: r.resolution,
                        label: r.resolution,
                        count: r.count,
                      }))}
                      selected={movieFilters.resolutions}
                      onChange={(selected) => onChange({ ...filters, resolutions: selected })}
                    />
                  </Section>
                )}
              </Box>

              <Divider />

              {/* Ranges beside scores */}
              <Box sx={COLUMNS}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, minWidth: 0 }}>
                  <Section title={t('filterPopper.sections.year')}>
                    <RangeSlider
                      label={t('filterPopper.releaseYear')}
                      value={filters.yearRange}
                      onChange={(value) => onChange({ ...filters, yearRange: value })}
                      min={ranges.year.min}
                      max={ranges.year.max}
                      step={1}
                    />
                  </Section>

                  {seriesFilters && ranges.seasons && (
                    <Section title={t('filterPopper.sections.seasons')}>
                      <RangeSlider
                        label={t('filterPopper.numberOfSeasons')}
                        value={seriesFilters.seasonsRange}
                        onChange={(value) => onChange({ ...filters, seasonsRange: value })}
                        min={ranges.seasons.min}
                        max={ranges.seasons.max}
                        step={1}
                      />
                    </Section>
                  )}

                  {movieFilters && ranges.runtime && (
                    <Section title={t('filterPopper.sections.runtime')}>
                      <RangeSlider
                        label={t('filterPopper.duration')}
                        value={movieFilters.runtimeRange}
                        onChange={(value) => onChange({ ...filters, runtimeRange: value })}
                        min={ranges.runtime.min}
                        max={ranges.runtime.max}
                        step={10}
                        formatValue={(v) => `${v} min`}
                      />
                    </Section>
                  )}
                </Box>

                <Section title={t('filterPopper.sections.scores')}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    <RangeSlider
                      label={t('filterPopper.communityRating')}
                      value={filters.communityRating}
                      onChange={(value) => onChange({ ...filters, communityRating: value })}
                      min={0}
                      max={10}
                      step={0.5}
                      formatValue={(v) => v.toFixed(1)}
                    />
                    <RangeSlider
                      label={t('filterPopper.rtCriticScore')}
                      value={filters.rtScore}
                      onChange={(value) => onChange({ ...filters, rtScore: value })}
                      min={0}
                      max={100}
                      step={5}
                      formatValue={(v) => `${v}%`}
                    />
                    <RangeSlider
                      label={t('filterPopper.metacritic')}
                      value={filters.metacritic}
                      onChange={(value) => onChange({ ...filters, metacritic: value })}
                      min={0}
                      max={100}
                      step={5}
                      formatValue={(v) => `${v}`}
                    />
                  </Box>
                </Section>
              </Box>

              <Divider />

              {/* Household reach */}
              <Section title={t('filterPopper.sections.audience')}>
                <Box sx={COLUMNS}>
                  <TextField
                    label={t('filterPopper.minWatchers')}
                    type="number"
                    size="small"
                    fullWidth
                    inputProps={{ min: 0 }}
                    value={filters.minWatchers ?? ''}
                    onChange={(e) => onChange({ ...filters, minWatchers: parseOptionalInt(e.target.value) })}
                  />
                  <TextField
                    label={t('filterPopper.maxWatchers')}
                    type="number"
                    size="small"
                    fullWidth
                    inputProps={{ min: 0 }}
                    value={filters.maxWatchers ?? ''}
                    onChange={(e) => onChange({ ...filters, maxWatchers: parseOptionalInt(e.target.value) })}
                  />
                </Box>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
                  {serverName
                    ? t('filterPopper.watchersHelperNamed', { serverName })
                    : t('filterPopper.watchersHelper')}
                </Typography>
              </Section>

              {/* Content rating — folded by default, it can run to twenty chips */}
              {contentRatings.length > 0 && (
                <>
                  <Divider />
                  <Box>
                    <Box
                      component="button"
                      type="button"
                      onClick={() => setContentOpen((prev) => !prev)}
                      aria-expanded={contentOpen}
                      sx={{
                        all: 'unset',
                        boxSizing: 'border-box',
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        borderRadius: 1,
                        '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}` },
                      }}
                    >
                      <Typography
                        variant="overline"
                        component="span"
                        color={filters.contentRatings.length > 0 ? 'primary.main' : 'text.secondary'}
                        sx={{ fontWeight: 700, letterSpacing: '0.08em', lineHeight: 1.6 }}
                      >
                        {t('filterPopper.sections.contentRating')}
                        {filters.contentRatings.length > 0 && ` · ${filters.contentRatings.length}`}
                      </Typography>
                      {contentOpen ? (
                        <ExpandLessIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                      ) : (
                        <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                      )}
                    </Box>
                    <Collapse in={contentOpen}>
                      <Box sx={{ pt: 1 }}>
                        <ChipToggleGroup
                          label=""
                          options={contentRatings.map((r) => ({
                            value: r.rating,
                            label: r.rating,
                            count: r.count,
                          }))}
                          selected={filters.contentRatings}
                          onChange={(selected) => onChange({ ...filters, contentRatings: selected })}
                        />
                      </Box>
                    </Collapse>
                  </Box>
                </>
              )}
            </Box>
          </Paper>
        </ClickAwayListener>
      </Popper>
    </>
  )
}
