import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, Grid, Skeleton, Alert, Chip, Tooltip as MuiTooltip } from '@mui/material'
import InsightsIcon from '@mui/icons-material/Insights'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import FavoriteIcon from '@mui/icons-material/Favorite'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PersonIcon from '@mui/icons-material/Person'
import VideocamIcon from '@mui/icons-material/Videocam'
import BusinessIcon from '@mui/icons-material/Business'
import LiveTvIcon from '@mui/icons-material/LiveTv'
import ReplayIcon from '@mui/icons-material/Replay'
import WhatshotIcon from '@mui/icons-material/Whatshot'
import ThumbsUpDownIcon from '@mui/icons-material/ThumbsUpDown'
import CalendarViewMonthIcon from '@mui/icons-material/CalendarViewMonth'
import TheatersIcon from '@mui/icons-material/Theaters'
import CategoryIcon from '@mui/icons-material/Category'
import HistoryIcon from '@mui/icons-material/History'
import StarIcon from '@mui/icons-material/Star'
import TimelineIcon from '@mui/icons-material/Timeline'
import { alpha, useTheme } from '@mui/material/styles'
import {
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from 'recharts'
import { getProxiedImageUrl } from '@aperture/ui'
import { useAuth } from '@/hooks/useAuth'
import { useTranslation } from 'react-i18next'
import { PageHeading } from '@/components/PageHeading'
import { WatcherIdentityCard } from '@/components/WatcherIdentityCard'
import { MediaDetailModalProvider } from '@/hooks/MediaDetailModalProvider'
import { useMediaDetailModal } from '@/hooks/useMediaDetailModal'
import { MetricTile } from './watch-stats/MetricTile'
import { StatCard } from './watch-stats/StatCard'
import { StatRankList } from './watch-stats/StatRankList'
import { StatBreakdownDialog } from './watch-stats/StatBreakdownDialog'
import type { BreakdownRequest } from './watch-stats/types'

/**
 * The datum behind a clicked mark.
 *
 * Recharts passes marks their rendering object, which carries the original row
 * under `payload`, but some marks pass the row itself. Unwrapping covers both,
 * so a chart type change cannot silently make a bucket unclickable.
 */
function clickedDatum<T>(entry: unknown): Partial<T> {
  const e = entry as { payload?: Partial<T> } | null
  return (e?.payload ?? (e as Partial<T> | null) ?? {}) as Partial<T>
}

interface WatchStats {
  genreDistribution: { genre: string; count: number; percentage: number }[]
  watchTimeline: { month: string; monthKey?: string; movies: number; episodes: number }[]
  decadeDistribution: { decade: string; count: number }[]
  ratingDistribution: { rating: string; count: number }[]
  totalMovies: number
  totalEpisodes: number
  totalWatchTimeMinutes: number
  movieWatchTimeMinutes: number
  tvWatchTimeMinutes: number
  totalPlays: number
  totalFavorites: number
  totalSeries: number
  topActors: { name: string; thumb: string | null; count: number }[]
  topDirectors: { name: string; thumb: string | null; count: number }[]
  topStudios: { name: string; thumb: string | null; count: number }[]
  topNetworks: { name: string; thumb: string | null; count: number }[]
  seriesGenreDistribution: { genre: string; count: number }[]
  activityHeatmap: { dow: number; hour: number; count: number }[]
  avgCommunityRating: number
  guiltyPleasureGenres: { genre: string; count: number; avgRating: number }[]
  busiestDay: { date: string; count: number } | null
  totalRewatched: number
  mostRewatched: { movieId: string; title: string; poster: string | null; playCount: number }[]
}

/** Off-palette section accents, kept in one place so the page reads as one set. */
const ACCENT = {
  studio: '#f97316',
  network: '#06b6d4',
  rewatch: '#14b8a6',
  taste: '#ec4899',
}

export function WatchStatsPage() {
  // The drill-in dialog opens a title in place rather than routing away, so the
  // reader keeps the chart they came from.
  return (
    <MediaDetailModalProvider>
      <WatchStatsContent />
    </MediaDetailModalProvider>
  )
}

function WatchStatsContent() {
  const theme = useTheme()
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const openMediaDetail = useMediaDetailModal()

  // Rich color palette for charts. Depends on theme.palette (primary/secondary are
  // admin-configurable) so it must be recomputed on theme change, not baked at import time.
  const GENRE_COLORS = useMemo(
    () => [
      theme.palette.primary.main, theme.palette.secondary.main, '#ec4899', '#f43f5e', '#f97316',
      '#eab308', theme.palette.success.main, '#14b8a6', '#06b6d4', theme.palette.info.main,
      '#a855f7', '#d946ef', '#f472b6', '#fb7185', '#fb923c',
    ],
    [theme]
  )
  const DECADE_COLORS = useMemo(
    () => [theme.palette.primary.main, theme.palette.primary.light, '#a5b4fc', '#c7d2fe', '#e0e7ff'],
    [theme]
  )

  const [stats, setStats] = useState<WatchStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [breakdown, setBreakdown] = useState<BreakdownRequest | null>(null)

  useEffect(() => {
    const fetchStats = async () => {
      if (!user) return

      try {
        const response = await fetch(`/api/users/${user.id}/watch-stats`, {
          credentials: 'include',
        })
        if (response.ok) {
          const data = await response.json()
          setStats(data)
          setError(null)
        } else {
          setError(t('watchStats.errorLoadFailed'))
        }
      } catch {
        setError(t('watchStats.errorConnect'))
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [user, t])

  const formatWatchTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    if (days > 0) {
      return t('watchStats.watchTimeDaysHours', { days, hours: hours % 24 })
    }
    return t('watchStats.watchTimeHoursMinutes', { hours, minutes: minutes % 60 })
  }

  // Locale-aware short weekday labels, indexed by Postgres DOW (0=Sun..6=Sat).
  // Jan 1 2023 was a Sunday, so it anchors the mapping.
  const weekdayShort = (dow: number) =>
    new Date(Date.UTC(2023, 0, 1 + dow)).toLocaleDateString(i18n.language, {
      weekday: 'short',
      timeZone: 'UTC',
    })
  const weekdayLong = (dow: number) =>
    new Date(Date.UTC(2023, 0, 1 + dow)).toLocaleDateString(i18n.language, {
      weekday: 'long',
      timeZone: 'UTC',
    })

  const heading = (
    <PageHeading
      title={t('watchStats.title')}
      description={t('watchStats.subtitle')}
      icon={<InsightsIcon sx={{ color: 'primary.main', fontSize: 28 }} />}
      sx={{ mb: 3 }}
    />
  )

  if (loading) {
    return (
      <Box>
        {heading}
        <Grid container spacing={2} mb={3}>
          {Array.from({ length: 8 }, (_, i) => (
            <Grid item xs={6} sm={4} lg={3} key={i}>
              <Skeleton variant="rectangular" height={78} sx={{ borderRadius: 2.5 }} />
            </Grid>
          ))}
        </Grid>
        <Grid container spacing={2.5}>
          {Array.from({ length: 4 }, (_, i) => (
            <Grid item xs={12} md={6} key={i}>
              <Skeleton variant="rectangular" height={260} sx={{ borderRadius: 2.5 }} />
            </Grid>
          ))}
        </Grid>
      </Box>
    )
  }

  if (error) {
    return (
      <Box>
        {heading}
        <Alert severity="error" sx={{ borderRadius: 2 }}>
          {error}
        </Alert>
      </Box>
    )
  }

  if (!stats) return null

  const hasData = stats.totalMovies > 0 || stats.totalEpisodes > 0

  // Movies vs TV time split (hours)
  const movieHours = Math.round(stats.movieWatchTimeMinutes / 60)
  const tvHours = Math.round(stats.tvWatchTimeMinutes / 60)
  const timeSplitTotal = movieHours + tvHours
  const timeSplitData = [
    {
      key: 'movies' as const,
      name: t('watchStats.splitMovies'),
      value: movieHours,
      color: theme.palette.primary.main,
    },
    {
      key: 'series' as const,
      name: t('watchStats.splitTv'),
      value: tvHours,
      color: theme.palette.secondary.main,
    },
  ].filter(d => d.value > 0)

  // Heatmap lookup keyed by "dow-hour", plus peak count for intensity scaling
  const heatmapMap = new Map<string, number>()
  let heatmapMax = 0
  for (const cell of stats.activityHeatmap) {
    heatmapMap.set(`${cell.dow}-${cell.hour}`, cell.count)
    if (cell.count > heatmapMax) heatmapMax = cell.count
  }
  // Display rows Monday→Sunday (DOW 1..6 then 0)
  const dayOrder = [1, 2, 3, 4, 5, 6, 0]
  const hasHeatmap = heatmapMax > 0

  const busiestDayLabel = stats.busiestDay
    ? new Date(`${stats.busiestDay.date}T00:00:00`).toLocaleDateString(i18n.language, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : '—'

  const topSeriesGenreCount = stats.seriesGenreDistribution[0]?.count ?? 0

  return (
    <Box>
      {heading}

      {!hasData ? (
        <Alert severity="info" sx={{ borderRadius: 2 }}>
          {t('watchStats.emptyState')}
        </Alert>
      ) : (
        <>
          {/* Every scalar the page knows, in one band. Tiles that stand for a
              population open it; the derived ones (time, plays) do not. */}
          <Grid container spacing={2} mb={3}>
            <Grid item xs={6} sm={4} lg={3}>
              <MetricTile
                icon={<MovieIcon />}
                color={theme.palette.primary.main}
                value={stats.totalMovies.toLocaleString()}
                label={t('watchStats.summaryMovies')}
                onClick={() =>
                  setBreakdown({ dimension: 'movies', label: t('watchStats.summaryMovies') })
                }
              />
            </Grid>
            <Grid item xs={6} sm={4} lg={3}>
              <MetricTile
                icon={<TvIcon />}
                color={theme.palette.secondary.main}
                value={stats.totalSeries.toLocaleString()}
                label={t('watchStats.summaryTvSeries')}
                onClick={() =>
                  setBreakdown({ dimension: 'series', label: t('watchStats.summaryTvSeries') })
                }
              />
            </Grid>
            <Grid item xs={6} sm={4} lg={3}>
              <MetricTile
                icon={<PlayArrowIcon />}
                color="#ec4899"
                value={stats.totalEpisodes.toLocaleString()}
                label={t('watchStats.summaryEpisodes')}
              />
            </Grid>
            <Grid item xs={6} sm={4} lg={3}>
              <MetricTile
                icon={<AccessTimeIcon />}
                color="#f97316"
                value={formatWatchTime(stats.totalWatchTimeMinutes)}
                label={t('watchStats.summaryWatchTime')}
              />
            </Grid>
            <Grid item xs={6} sm={4} lg={3}>
              <MetricTile
                icon={<PlayArrowIcon />}
                color={theme.palette.success.main}
                value={stats.totalPlays.toLocaleString()}
                label={t('watchStats.summaryTotalPlays')}
              />
            </Grid>
            <Grid item xs={6} sm={4} lg={3}>
              <MetricTile
                icon={<FavoriteIcon />}
                color={theme.palette.error.main}
                value={stats.totalFavorites.toLocaleString()}
                label={t('watchStats.summaryFavorites')}
                onClick={() =>
                  setBreakdown({ dimension: 'favorites', label: t('watchStats.summaryFavorites') })
                }
              />
            </Grid>
            <Grid item xs={6} sm={4} lg={3}>
              <MetricTile
                icon={<ReplayIcon />}
                color={ACCENT.rewatch}
                value={stats.totalRewatched.toLocaleString()}
                label={t('watchStats.summaryRewatched')}
                onClick={() =>
                  setBreakdown({ dimension: 'rewatched', label: t('watchStats.sectionMostRewatched') })
                }
              />
            </Grid>
            <Grid item xs={6} sm={4} lg={3}>
              <MetricTile
                icon={<WhatshotIcon />}
                color={theme.palette.warning.main}
                value={busiestDayLabel}
                label={
                  stats.busiestDay
                    ? t('watchStats.busiestDayCount', { count: stats.busiestDay.count })
                    : t('watchStats.busiestDayTitle')
                }
                onClick={
                  stats.busiestDay
                    ? () =>
                        setBreakdown({
                          dimension: 'day',
                          value: stats.busiestDay!.date,
                          label: `${t('watchStats.busiestDayTitle')} · ${busiestDayLabel}`,
                        })
                    : undefined
                }
              />
            </Grid>
          </Grid>

          <Grid container spacing={2.5} mb={2.5}>
            {/* Taste vs the crowd — a metric, so it sits with the metrics
                rather than five sections down. */}
            <Grid item xs={12} md={7}>
              <StatCard
                title={t('watchStats.sectionTasteVsCrowd')}
                icon={<ThumbsUpDownIcon fontSize="small" />}
                color={ACCENT.taste}
              >
                {stats.avgCommunityRating > 0 ? (
                  <Box display="flex" gap={3} flexWrap="wrap" alignItems="flex-start">
                    <Box sx={{ minWidth: 120 }}>
                      <Box display="flex" alignItems="baseline" gap={0.5}>
                        <Typography variant="h3" fontWeight={700} color="primary.main" lineHeight={1}>
                          {stats.avgCommunityRating.toFixed(1)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          / 10
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                        {t('watchStats.avgCommunityRating')}
                      </Typography>
                    </Box>
                    <Box flex={1} minWidth={220}>
                      <Typography variant="subtitle2" fontWeight={600}>
                        {t('watchStats.guiltyPleasuresTitle')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('watchStats.guiltyPleasuresHint')}
                      </Typography>
                      {stats.guiltyPleasureGenres.length > 0 ? (
                        <Box display="flex" flexWrap="wrap" gap={1} mt={1.5}>
                          {stats.guiltyPleasureGenres.map(g => (
                            <Chip
                              key={g.genre}
                              label={`${g.genre} · ${t('watchStats.guiltyPleasureRating', {
                                rating: g.avgRating.toFixed(1),
                              })}`}
                              size="small"
                              onClick={() =>
                                setBreakdown({
                                  dimension: 'genre',
                                  value: g.genre,
                                  label: g.genre,
                                })
                              }
                              sx={{
                                backgroundColor: alpha(ACCENT.taste, 0.15),
                                color: '#f472b6',
                                fontWeight: 500,
                                '&:hover': { backgroundColor: alpha(ACCENT.taste, 0.28) },
                              }}
                            />
                          ))}
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary" mt={1.5}>
                          —
                        </Typography>
                      )}
                    </Box>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('watchStats.emptyTasteData')}
                  </Typography>
                )}
              </StatCard>
            </Grid>

            {/* Where the hours go */}
            <Grid item xs={12} md={5}>
              <StatCard
                title={t('watchStats.sectionWhereHoursGo')}
                icon={<TheatersIcon fontSize="small" />}
                color={theme.palette.primary.main}
              >
                {timeSplitTotal > 0 ? (
                  <Box display="flex" alignItems="center" gap={1}>
                    <ResponsiveContainer width="45%" height={140}>
                      <PieChart>
                        <Pie
                          data={timeSplitData}
                          cx="50%"
                          cy="50%"
                          innerRadius={38}
                          outerRadius={62}
                          paddingAngle={2}
                          dataKey="value"
                          onClick={(entry: unknown) => {
                            const d = clickedDatum<{ key: 'movies' | 'series'; name: string }>(entry)
                            if (!d.key) return
                            setBreakdown({ dimension: d.key, label: d.name ?? '' })
                          }}
                          style={{ cursor: 'pointer', outline: 'none' }}
                        >
                          {timeSplitData.map(d => (
                            <Cell key={d.key} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: theme.palette.background.paper,
                            border: `1px solid ${theme.palette.divider}`,
                            borderRadius: 8,
                            color: theme.palette.text.primary,
                          }}
                          itemStyle={{ color: theme.palette.text.primary }}
                          formatter={(value, name) => {
                            const hours = typeof value === 'number' ? value : Number(value)
                            const pct = timeSplitTotal > 0 ? Math.round((hours / timeSplitTotal) * 100) : 0
                            return [t('watchStats.splitTooltip', { hours, pct }), name]
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <Box flex={1} minWidth={0}>
                      {timeSplitData.map(d => (
                        <Box
                          key={d.key}
                          onClick={() => setBreakdown({ dimension: d.key, label: d.name })}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            mb: 1,
                            px: 0.75,
                            py: 0.25,
                            mx: -0.75,
                            borderRadius: 1,
                            cursor: 'pointer',
                            '&:hover': { bgcolor: alpha(d.color, 0.12) },
                          }}
                        >
                          <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: d.color }} />
                          <Typography variant="body2" flex={1} noWrap>
                            {d.name}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {t('watchStats.watchTimeHoursMinutes', { hours: d.value, minutes: 0 })}
                          </Typography>
                        </Box>
                      ))}
                      <Typography variant="caption" color="text.secondary">
                        {formatWatchTime(stats.totalWatchTimeMinutes)}
                      </Typography>
                    </Box>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('watchStats.emptyTimeSplitData')}
                  </Typography>
                )}
              </StatCard>
            </Grid>
          </Grid>

          {/* The sentence version of everything below it. */}
          <Grid container spacing={2.5} mb={2.5}>
            <Grid item xs={12} lg={6}>
              <WatcherIdentityCard mediaType="movie" />
            </Grid>
            <Grid item xs={12} lg={6}>
              <WatcherIdentityCard mediaType="series" />
            </Grid>
          </Grid>

          {/* Watching activity — full width, because it is the only chart with
              a time axis and squeezing it into a half column loses the shape. */}
          <Grid container spacing={2.5} mb={2.5}>
            <Grid item xs={12}>
              <StatCard
                title={t('watchStats.sectionWatchingActivity')}
                subtitle={t('watchStats.clickHintMonth')}
                icon={<TimelineIcon fontSize="small" />}
                color={theme.palette.info.main}
              >
                {stats.watchTimeline.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart
                      data={stats.watchTimeline}
                      onClick={(state: { activeLabel?: string | number }) => {
                        const point = stats.watchTimeline.find(p => p.month === state?.activeLabel)
                        if (!point?.monthKey) return
                        if (point.movies + point.episodes === 0) return
                        setBreakdown({
                          dimension: 'month',
                          value: point.monthKey,
                          label: point.month,
                        })
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                      <XAxis
                        dataKey="month"
                        stroke={theme.palette.text.secondary}
                        fontSize={11}
                        tickFormatter={(value: string) => value.split(' ')[0]}
                      />
                      <YAxis stroke={theme.palette.text.secondary} fontSize={11} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: theme.palette.background.paper,
                          border: `1px solid ${theme.palette.divider}`,
                          borderRadius: 8,
                        }}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="movies"
                        stackId="1"
                        stroke={theme.palette.primary.main}
                        fill={theme.palette.primary.main}
                        fillOpacity={0.6}
                        name={t('watchStats.chartMovies')}
                      />
                      <Area
                        type="monotone"
                        dataKey="episodes"
                        stackId="1"
                        stroke={theme.palette.secondary.main}
                        fill={theme.palette.secondary.main}
                        fillOpacity={0.6}
                        name={t('watchStats.chartEpisodes')}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('watchStats.emptyTimelineData')}
                  </Typography>
                )}
              </StatCard>
            </Grid>
          </Grid>

          <Grid container spacing={2.5} mb={2.5}>
            {/* Genre distribution */}
            <Grid item xs={12} md={6}>
              <StatCard
                title={t('watchStats.sectionFavoriteGenres')}
                icon={<CategoryIcon fontSize="small" />}
                color={GENRE_COLORS[0]}
              >
                {stats.genreDistribution.length > 0 ? (
                  <Box display="flex" alignItems="center" gap={2}>
                    <ResponsiveContainer width="45%" height={200}>
                      <PieChart>
                        <Pie
                          data={stats.genreDistribution.slice(0, 8)}
                          cx="50%"
                          cy="50%"
                          innerRadius={48}
                          outerRadius={78}
                          paddingAngle={2}
                          dataKey="count"
                          onClick={(entry: unknown) => {
                            const d = clickedDatum<{ genre: string }>(entry)
                            if (d.genre) setBreakdown({ dimension: 'genre', value: d.genre, label: d.genre })
                          }}
                          style={{ cursor: 'pointer', outline: 'none' }}
                        >
                          {stats.genreDistribution.slice(0, 8).map((_, index) => (
                            <Cell key={`cell-${index}`} fill={GENRE_COLORS[index % GENRE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: theme.palette.background.paper,
                            border: `1px solid ${theme.palette.divider}`,
                            borderRadius: 8,
                            color: theme.palette.text.primary,
                          }}
                          itemStyle={{ color: theme.palette.text.primary }}
                          formatter={(value, _name, props) => {
                            const payload = props.payload as { genre: string; percentage: number } | undefined
                            const count = typeof value === 'number' ? value : Number(value)
                            return [
                              t('watchStats.genreTooltipMovies', {
                                count,
                                pct: payload?.percentage ?? 0,
                              }),
                              payload?.genre || '',
                            ]
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <Box flex={1} minWidth={0}>
                      {stats.genreDistribution.slice(0, 8).map((item, index) => (
                        <Box
                          key={item.genre}
                          onClick={() =>
                            setBreakdown({ dimension: 'genre', value: item.genre, label: item.genre })
                          }
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            px: 0.75,
                            py: 0.25,
                            mx: -0.75,
                            borderRadius: 1,
                            cursor: 'pointer',
                            '&:hover': {
                              bgcolor: alpha(GENRE_COLORS[index % GENRE_COLORS.length], 0.14),
                            },
                          }}
                        >
                          <Box
                            sx={{
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              flexShrink: 0,
                              backgroundColor: GENRE_COLORS[index % GENRE_COLORS.length],
                            }}
                          />
                          <Typography variant="body2" flex={1} noWrap>
                            {item.genre}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {item.percentage}%
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('watchStats.emptyGenreData')}
                  </Typography>
                )}
              </StatCard>
            </Grid>

            {/* TV genres — collected all along and never shown, which left the
                page silent about half of what gets watched. */}
            <Grid item xs={12} md={6}>
              <StatCard
                title={t('watchStats.sectionSeriesGenres')}
                icon={<TvIcon fontSize="small" />}
                color={theme.palette.secondary.main}
              >
                {stats.seriesGenreDistribution.length > 0 ? (
                  <Box display="flex" flexDirection="column" gap={0.25}>
                    {stats.seriesGenreDistribution.slice(0, 8).map((item, index) => (
                      <Box
                        key={item.genre}
                        onClick={() =>
                          setBreakdown({
                            dimension: 'seriesGenre',
                            value: item.genre,
                            label: item.genre,
                          })
                        }
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.5,
                          px: 0.75,
                          py: 0.5,
                          mx: -0.75,
                          borderRadius: 1,
                          cursor: 'pointer',
                          '&:hover': { bgcolor: alpha(theme.palette.secondary.main, 0.12) },
                        }}
                      >
                        <Typography variant="body2" sx={{ width: 110, flexShrink: 0 }} noWrap>
                          {item.genre}
                        </Typography>
                        <Box
                          sx={{
                            flex: 1,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: alpha(theme.palette.secondary.main, 0.15),
                            overflow: 'hidden',
                          }}
                        >
                          <Box
                            sx={{
                              height: '100%',
                              width: `${topSeriesGenreCount > 0 ? (item.count / topSeriesGenreCount) * 100 : 0}%`,
                              borderRadius: 4,
                              backgroundColor: GENRE_COLORS[index % GENRE_COLORS.length],
                            }}
                          />
                        </Box>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ width: 28, textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}
                        >
                          {item.count}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('watchStats.emptySeriesGenreData')}
                  </Typography>
                )}
              </StatCard>
            </Grid>
          </Grid>

          <Grid container spacing={2.5} mb={2.5}>
            {/* Decade distribution */}
            <Grid item xs={12} md={6}>
              <StatCard
                title={t('watchStats.sectionMoviesByDecade')}
                icon={<HistoryIcon fontSize="small" />}
                color={theme.palette.primary.main}
              >
                {stats.decadeDistribution.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={stats.decadeDistribution} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                      <XAxis type="number" stroke={theme.palette.text.secondary} fontSize={11} />
                      <YAxis
                        type="category"
                        dataKey="decade"
                        stroke={theme.palette.text.secondary}
                        fontSize={11}
                        width={50}
                      />
                      <Tooltip
                        cursor={{ fill: alpha(theme.palette.primary.main, 0.08) }}
                        contentStyle={{
                          backgroundColor: theme.palette.background.paper,
                          border: `1px solid ${theme.palette.divider}`,
                          borderRadius: 8,
                        }}
                      />
                      <Bar
                        dataKey="count"
                        radius={[0, 4, 4, 0]}
                        cursor="pointer"
                        onClick={(entry: unknown) => {
                          const d = clickedDatum<{ decade: string }>(entry)
                          if (d.decade)
                            setBreakdown({ dimension: 'decade', value: d.decade, label: d.decade })
                        }}
                      >
                        {stats.decadeDistribution.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={DECADE_COLORS[index % DECADE_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('watchStats.emptyDecadeData')}
                  </Typography>
                )}
              </StatCard>
            </Grid>

            {/* Rating distribution */}
            <Grid item xs={12} md={6}>
              <StatCard
                title={t('watchStats.sectionRatingDistribution')}
                icon={<StarIcon fontSize="small" />}
                color={theme.palette.warning.main}
              >
                {stats.ratingDistribution.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={stats.ratingDistribution}>
                      <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                      <XAxis dataKey="rating" stroke={theme.palette.text.secondary} fontSize={11} />
                      <YAxis stroke={theme.palette.text.secondary} fontSize={11} />
                      <Tooltip
                        cursor={{ fill: alpha(theme.palette.warning.main, 0.08) }}
                        contentStyle={{
                          backgroundColor: theme.palette.background.paper,
                          border: `1px solid ${theme.palette.divider}`,
                          borderRadius: 8,
                        }}
                        formatter={(value) => {
                          const count = typeof value === 'number' ? value : Number(value)
                          return [
                            t('watchStats.ratingTooltipMovies', { count }),
                            t('watchStats.chartCountLabel'),
                          ]
                        }}
                      />
                      <Bar
                        dataKey="count"
                        fill={theme.palette.warning.main}
                        radius={[4, 4, 0, 0]}
                        cursor="pointer"
                        onClick={(entry: unknown) => {
                          const d = clickedDatum<{ rating: string }>(entry)
                          if (d.rating)
                            setBreakdown({
                              dimension: 'rating',
                              value: d.rating,
                              label: t('watchStats.ratingBucketLabel', { rating: d.rating }),
                            })
                        }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('watchStats.emptyRatingData')}
                  </Typography>
                )}
              </StatCard>
            </Grid>
          </Grid>

          <Grid container spacing={2.5} mb={2.5}>
            <Grid item xs={12} md={6}>
              <StatCard
                title={t('watchStats.sectionTopActors')}
                icon={<PersonIcon fontSize="small" />}
                color={theme.palette.primary.main}
              >
                <StatRankList
                  entries={stats.topActors}
                  color={theme.palette.primary.main}
                  formatCount={count => t('watchStats.filmsCount', { count })}
                  empty={t('watchStats.emptyActorData')}
                  onSelect={entry =>
                    setBreakdown({
                      dimension: 'actor',
                      value: entry.name,
                      label: entry.name,
                      moreHref: `/person/${encodeURIComponent(entry.name)}`,
                      moreLabel: t('watchStats.breakdownViewPerson'),
                    })
                  }
                />
              </StatCard>
            </Grid>

            <Grid item xs={12} md={6}>
              <StatCard
                title={t('watchStats.sectionTopDirectors')}
                icon={<VideocamIcon fontSize="small" />}
                color={theme.palette.secondary.main}
              >
                <StatRankList
                  entries={stats.topDirectors}
                  color={theme.palette.secondary.main}
                  formatCount={count => t('watchStats.filmsCount', { count })}
                  empty={t('watchStats.emptyDirectorData')}
                  onSelect={entry =>
                    setBreakdown({
                      dimension: 'director',
                      value: entry.name,
                      label: entry.name,
                      moreHref: `/person/${encodeURIComponent(entry.name)}`,
                      moreLabel: t('watchStats.breakdownViewPerson'),
                    })
                  }
                />
              </StatCard>
            </Grid>
          </Grid>

          <Grid container spacing={2.5} mb={2.5}>
            <Grid item xs={12} md={6}>
              <StatCard
                title={t('watchStats.sectionTopStudios')}
                icon={<BusinessIcon fontSize="small" />}
                color={ACCENT.studio}
              >
                <StatRankList
                  entries={stats.topStudios}
                  color={ACCENT.studio}
                  shape="rounded"
                  formatCount={count => t('watchStats.filmsCount', { count })}
                  empty={t('watchStats.emptyStudioData')}
                  onSelect={entry =>
                    setBreakdown({
                      dimension: 'studio',
                      value: entry.name,
                      label: entry.name,
                      moreHref: `/studio/${encodeURIComponent(entry.name)}`,
                      moreLabel: t('watchStats.breakdownViewStudio'),
                    })
                  }
                />
              </StatCard>
            </Grid>

            <Grid item xs={12} md={6}>
              <StatCard
                title={t('watchStats.sectionTopNetworks')}
                icon={<LiveTvIcon fontSize="small" />}
                color={ACCENT.network}
              >
                <StatRankList
                  entries={stats.topNetworks}
                  color={ACCENT.network}
                  shape="rounded"
                  formatCount={count => t('watchStats.networkSeriesCount', { count })}
                  empty={t('watchStats.emptyNetworkData')}
                  onSelect={entry =>
                    setBreakdown({
                      dimension: 'network',
                      value: entry.name,
                      label: entry.name,
                      moreHref: `/studio/${encodeURIComponent(entry.name)}`,
                      moreLabel: t('watchStats.breakdownViewStudio'),
                    })
                  }
                />
              </StatCard>
            </Grid>
          </Grid>

          {/* Activity heatmap */}
          <Grid container spacing={2.5} mb={2.5}>
            <Grid item xs={12}>
              <StatCard
                title={t('watchStats.sectionWhenYouWatch')}
                subtitle={t('watchStats.heatmapSubtitle')}
                icon={<CalendarViewMonthIcon fontSize="small" />}
                color={theme.palette.primary.main}
              >
                {hasHeatmap ? (
                  <Box sx={{ overflowX: 'auto' }}>
                    <Box sx={{ display: 'inline-flex', flexDirection: 'column', gap: 0.5, minWidth: 'min-content' }}>
                      {dayOrder.map(dow => (
                        <Box key={dow} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ width: 32, flexShrink: 0, textAlign: 'end', pr: 0.5 }}
                          >
                            {weekdayShort(dow)}
                          </Typography>
                          {Array.from({ length: 24 }, (_, hour) => {
                            const count = heatmapMap.get(`${dow}-${hour}`) ?? 0
                            const intensity = count > 0 ? 0.15 + 0.85 * (count / heatmapMax) : 0
                            return (
                              <MuiTooltip
                                key={hour}
                                arrow
                                title={t('watchStats.heatmapTooltip', {
                                  day: weekdayLong(dow),
                                  hour: `${hour.toString().padStart(2, '0')}:00`,
                                  count,
                                })}
                              >
                                <Box
                                  onClick={
                                    count > 0
                                      ? () =>
                                          setBreakdown({
                                            dimension: 'timeOfDay',
                                            value: String(dow),
                                            value2: String(hour),
                                            label: t('watchStats.heatmapCellLabel', {
                                              day: weekdayLong(dow),
                                              hour: `${hour.toString().padStart(2, '0')}:00`,
                                            }),
                                          })
                                      : undefined
                                  }
                                  sx={{
                                    width: 16,
                                    height: 16,
                                    borderRadius: 0.5,
                                    flexShrink: 0,
                                    cursor: count > 0 ? 'pointer' : 'default',
                                    backgroundColor:
                                      count > 0
                                        ? alpha(theme.palette.primary.main, intensity)
                                        : alpha(theme.palette.text.disabled, 0.12),
                                    '&:hover': count > 0 ? { outline: `1px solid ${theme.palette.primary.main}` } : {},
                                  }}
                                />
                              </MuiTooltip>
                            )
                          })}
                        </Box>
                      ))}
                      {/* Hour axis */}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                        <Box sx={{ width: 32, flexShrink: 0 }} />
                        {Array.from({ length: 24 }, (_, hour) => (
                          <Box key={hour} sx={{ width: 16, flexShrink: 0, textAlign: 'center' }}>
                            {hour % 6 === 0 && (
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem' }}>
                                {hour}
                              </Typography>
                            )}
                          </Box>
                        ))}
                      </Box>
                    </Box>
                    {/* Legend */}
                    <Box display="flex" alignItems="center" gap={0.5} mt={1.5}>
                      <Typography variant="caption" color="text.secondary">
                        {t('watchStats.heatmapLess')}
                      </Typography>
                      {[0.15, 0.4, 0.65, 0.85, 1].map(a => (
                        <Box
                          key={a}
                          sx={{
                            width: 14,
                            height: 14,
                            borderRadius: 0.5,
                            backgroundColor: alpha(theme.palette.primary.main, a),
                          }}
                        />
                      ))}
                      <Typography variant="caption" color="text.secondary">
                        {t('watchStats.heatmapMore')}
                      </Typography>
                    </Box>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('watchStats.emptyHeatmapData')}
                  </Typography>
                )}
              </StatCard>
            </Grid>
          </Grid>

          {/* Most rewatched */}
          <Grid container spacing={2.5}>
            <Grid item xs={12}>
              <StatCard
                title={t('watchStats.sectionMostRewatched')}
                icon={<ReplayIcon fontSize="small" />}
                color={ACCENT.rewatch}
              >
                {stats.mostRewatched.length > 0 ? (
                  <Box
                    sx={{
                      display: 'grid',
                      gap: 2,
                      // Sized off the container: the page is narrower with the
                      // assistant docked, and a breakpoint-keyed grid would keep
                      // its full-desktop column count in a half-width pane.
                      gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
                    }}
                  >
                    {stats.mostRewatched.map(item => (
                      <Box
                        key={item.movieId}
                        onClick={() => openMediaDetail?.('movie', item.movieId)}
                        sx={{ cursor: 'pointer' }}
                      >
                        <Box
                          sx={{
                            position: 'relative',
                            borderRadius: 2,
                            overflow: 'hidden',
                            aspectRatio: '2 / 3',
                            backgroundColor: alpha(theme.palette.text.disabled, 0.12),
                            transition: 'transform 0.2s',
                            '&:hover': { transform: 'translateY(-4px)' },
                          }}
                        >
                          {item.poster ? (
                            <Box
                              component="img"
                              src={getProxiedImageUrl(item.poster)}
                              alt={item.title}
                              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            />
                          ) : (
                            <Box
                              sx={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <MovieIcon sx={{ color: 'text.secondary' }} />
                            </Box>
                          )}
                          <Chip
                            label={`×${item.playCount}`}
                            size="small"
                            sx={{
                              position: 'absolute',
                              top: 6,
                              insetInlineEnd: 6,
                              height: 22,
                              fontWeight: 700,
                              backgroundColor: alpha(ACCENT.rewatch, 0.9),
                              color: 'white',
                            }}
                          />
                        </Box>
                        <Typography variant="caption" fontWeight={500} noWrap sx={{ display: 'block', mt: 0.5 }}>
                          {item.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                          {t('watchStats.rewatchPlayCount', { count: item.playCount })}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('watchStats.emptyRewatchData')}
                  </Typography>
                )}
              </StatCard>
            </Grid>
          </Grid>
        </>
      )}

      <StatBreakdownDialog request={breakdown} onClose={() => setBreakdown(null)} />
    </Box>
  )
}
