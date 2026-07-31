import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Skeleton,
  Alert,
  Chip,
  Avatar,
} from '@mui/material'
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
import StarIcon from '@mui/icons-material/Star'
import ThumbsUpDownIcon from '@mui/icons-material/ThumbsUpDown'
import CalendarViewMonthIcon from '@mui/icons-material/CalendarViewMonth'
import TheatersIcon from '@mui/icons-material/Theaters'
import { Tooltip as MuiTooltip } from '@mui/material'
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

interface WatchStats {
  genreDistribution: { genre: string; count: number; percentage: number }[]
  watchTimeline: { month: string; movies: number; episodes: number }[]
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

// Rich color palette for charts
const GENRE_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#a855f7', '#d946ef', '#f472b6', '#fb7185', '#fb923c',
]

const DECADE_COLORS = ['#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#e0e7ff']

export function WatchStatsPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState<WatchStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  if (loading) {
    return (
      <Box>
        <Skeleton variant="text" width={300} height={48} sx={{ mb: 1 }} />
        <Skeleton variant="text" width={200} height={24} sx={{ mb: 4 }} />
        <Grid container spacing={3}>
          {[...Array(6)].map((_, i) => (
            <Grid item xs={12} md={6} lg={4} key={i}>
              <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 2 }} />
            </Grid>
          ))}
        </Grid>
      </Box>
    )
  }

  if (error) {
    return (
      <Box>
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
    { key: 'movies', name: t('watchStats.splitMovies'), value: movieHours, color: '#6366f1' },
    { key: 'tv', name: t('watchStats.splitTv'), value: tvHours, color: '#8b5cf6' },
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
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })
    : null

  return (
    <Box>
      {/* Header */}
      <PageHeading
        title={t('watchStats.title')}
        description={t('watchStats.subtitle')}
        icon={<InsightsIcon sx={{ color: 'primary.main', fontSize: 28 }} />}
        sx={{ mb: 4 }}
      />

      {!hasData ? (
        <Alert severity="info" sx={{ borderRadius: 2 }}>
          {t('watchStats.emptyState')}
        </Alert>
      ) : (
        <>
          {/* Summary Cards */}
          <Grid container spacing={2} mb={4}>
            <Grid item xs={6} sm={4} md={2}>
              <Card sx={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', borderRadius: 2 }}>
                <CardContent sx={{ textAlign: 'center', py: 2 }}>
                  <MovieIcon sx={{ fontSize: 32, color: 'white', mb: 1 }} />
                  <Typography variant="h4" fontWeight={700} color="white">
                    {stats.totalMovies}
                  </Typography>
                  <Typography variant="caption" color="rgba(255,255,255,0.8)">
                    {t('watchStats.summaryMovies')}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <Card sx={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', borderRadius: 2 }}>
                <CardContent sx={{ textAlign: 'center', py: 2 }}>
                  <TvIcon sx={{ fontSize: 32, color: 'white', mb: 1 }} />
                  <Typography variant="h4" fontWeight={700} color="white">
                    {stats.totalSeries}
                  </Typography>
                  <Typography variant="caption" color="rgba(255,255,255,0.8)">
                    {t('watchStats.summaryTvSeries')}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <Card sx={{ background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)', borderRadius: 2 }}>
                <CardContent sx={{ textAlign: 'center', py: 2 }}>
                  <PlayArrowIcon sx={{ fontSize: 32, color: 'white', mb: 1 }} />
                  <Typography variant="h4" fontWeight={700} color="white">
                    {stats.totalEpisodes}
                  </Typography>
                  <Typography variant="caption" color="rgba(255,255,255,0.8)">
                    {t('watchStats.summaryEpisodes')}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <Card sx={{ background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)', borderRadius: 2 }}>
                <CardContent sx={{ textAlign: 'center', py: 2 }}>
                  <AccessTimeIcon sx={{ fontSize: 32, color: 'white', mb: 1 }} />
                  <Typography variant="h4" fontWeight={700} color="white">
                    {formatWatchTime(stats.totalWatchTimeMinutes)}
                  </Typography>
                  <Typography variant="caption" color="rgba(255,255,255,0.8)">
                    {t('watchStats.summaryWatchTime')}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <Card sx={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', borderRadius: 2 }}>
                <CardContent sx={{ textAlign: 'center', py: 2 }}>
                  <PlayArrowIcon sx={{ fontSize: 32, color: 'white', mb: 1 }} />
                  <Typography variant="h4" fontWeight={700} color="white">
                    {stats.totalPlays}
                  </Typography>
                  <Typography variant="caption" color="rgba(255,255,255,0.8)">
                    {t('watchStats.summaryTotalPlays')}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <Card sx={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', borderRadius: 2 }}>
                <CardContent sx={{ textAlign: 'center', py: 2 }}>
                  <FavoriteIcon sx={{ fontSize: 32, color: 'white', mb: 1 }} />
                  <Typography variant="h4" fontWeight={700} color="white">
                    {stats.totalFavorites}
                  </Typography>
                  <Typography variant="caption" color="rgba(255,255,255,0.8)">
                    {t('watchStats.summaryFavorites')}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Highlights */}
          <Grid container spacing={2} mb={4}>
            <Grid item xs={12} sm={4}>
              <Card sx={{ borderRadius: 2, height: '100%' }}>
                <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Avatar sx={{ bgcolor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
                    <WhatshotIcon />
                  </Avatar>
                  <Box minWidth={0}>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {busiestDayLabel
                        ? t('watchStats.busiestDayCount', { count: stats.busiestDay!.count })
                        : t('watchStats.busiestDayTitle')}
                    </Typography>
                    <Typography variant="h6" fontWeight={700} noWrap>
                      {busiestDayLabel ?? '—'}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={4}>
              <Card sx={{ borderRadius: 2, height: '100%' }}>
                <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Avatar sx={{ bgcolor: 'rgba(20, 184, 166, 0.15)', color: '#14b8a6' }}>
                    <ReplayIcon />
                  </Avatar>
                  <Box minWidth={0}>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {t('watchStats.summaryRewatched')}
                    </Typography>
                    <Typography variant="h6" fontWeight={700}>
                      {stats.totalRewatched}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={4}>
              <Card sx={{ borderRadius: 2, height: '100%' }}>
                <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Avatar sx={{ bgcolor: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
                    <StarIcon />
                  </Avatar>
                  <Box minWidth={0}>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {t('watchStats.avgCommunityRating')}
                    </Typography>
                    <Typography variant="h6" fontWeight={700}>
                      {stats.avgCommunityRating > 0 ? stats.avgCommunityRating.toFixed(1) : '—'}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Charts Row 1 */}
          <Grid container spacing={3} mb={3}>
            {/* Genre Distribution */}
            <Grid item xs={12} md={6}>
              <Card sx={{ borderRadius: 2, height: '100%' }}>
                <CardContent>
                  <Typography variant="h6" fontWeight={600} mb={2}>
                    {t('watchStats.sectionFavoriteGenres')}
                  </Typography>
                  {stats.genreDistribution.length > 0 ? (
                    <Box display="flex" alignItems="center" gap={2}>
                      <ResponsiveContainer width="50%" height={200}>
                        <PieChart>
                          <Pie
                            data={stats.genreDistribution.slice(0, 8)}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={80}
                            paddingAngle={2}
                            dataKey="count"
                          >
                            {stats.genreDistribution.slice(0, 8).map((_, index) => (
                              <Cell key={`cell-${index}`} fill={GENRE_COLORS[index % GENRE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: '#1a1a1a', 
                              border: '1px solid #2a2a2a',
                              borderRadius: 8,
                              color: '#f5f5f5',
                            }}
                            itemStyle={{ color: '#f5f5f5' }}
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
                      <Box flex={1}>
                        {stats.genreDistribution.slice(0, 8).map((item, index) => (
                          <Box key={item.genre} display="flex" alignItems="center" gap={1} mb={0.5}>
                            <Box 
                              sx={{ 
                                width: 12, 
                                height: 12, 
                                borderRadius: '50%', 
                                backgroundColor: GENRE_COLORS[index % GENRE_COLORS.length] 
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
                </CardContent>
              </Card>
            </Grid>

            {/* Watch Timeline */}
            <Grid item xs={12} md={6}>
              <Card sx={{ borderRadius: 2, height: '100%' }}>
                <CardContent>
                  <Typography variant="h6" fontWeight={600} mb={2}>
                    {t('watchStats.sectionWatchingActivity')}
                  </Typography>
                  {stats.watchTimeline.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={stats.watchTimeline}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                        <XAxis 
                          dataKey="month" 
                          stroke="#666" 
                          fontSize={11}
                          tickFormatter={(value) => value.split(' ')[0]}
                        />
                        <YAxis stroke="#666" fontSize={11} />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#1a1a1a', 
                            border: '1px solid #2a2a2a',
                            borderRadius: 8 
                          }} 
                        />
                        <Legend />
                        <Area 
                          type="monotone" 
                          dataKey="movies" 
                          stackId="1"
                          stroke="#6366f1" 
                          fill="#6366f1" 
                          fillOpacity={0.6}
                          name={t('watchStats.chartMovies')}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="episodes" 
                          stackId="1"
                          stroke="#8b5cf6" 
                          fill="#8b5cf6" 
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
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Charts Row 2 */}
          <Grid container spacing={3} mb={3}>
            {/* Decade Distribution */}
            <Grid item xs={12} md={6}>
              <Card sx={{ borderRadius: 2, height: '100%' }}>
                <CardContent>
                  <Typography variant="h6" fontWeight={600} mb={2}>
                    {t('watchStats.sectionMoviesByDecade')}
                  </Typography>
                  {stats.decadeDistribution.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={stats.decadeDistribution} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                        <XAxis type="number" stroke="#666" fontSize={11} />
                        <YAxis type="category" dataKey="decade" stroke="#666" fontSize={11} width={50} />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#1a1a1a', 
                            border: '1px solid #2a2a2a',
                            borderRadius: 8 
                          }} 
                        />
                        <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]}>
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
                </CardContent>
              </Card>
            </Grid>

            {/* Rating Distribution */}
            <Grid item xs={12} md={6}>
              <Card sx={{ borderRadius: 2, height: '100%' }}>
                <CardContent>
                  <Typography variant="h6" fontWeight={600} mb={2}>
                    {t('watchStats.sectionRatingDistribution')}
                  </Typography>
                  {stats.ratingDistribution.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={stats.ratingDistribution}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                        <XAxis dataKey="rating" stroke="#666" fontSize={11} />
                        <YAxis stroke="#666" fontSize={11} />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#1a1a1a', 
                            border: '1px solid #2a2a2a',
                            borderRadius: 8 
                          }}
                          formatter={(value) => {
                            const count = typeof value === 'number' ? value : Number(value)
                            return [
                              t('watchStats.ratingTooltipMovies', { count }),
                              t('watchStats.chartCountLabel'),
                            ]
                          }}
                        />
                        <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t('watchStats.emptyRatingData')}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Charts Row 3 - Top Actors & Directors */}
          <Grid container spacing={3}>
            {/* Top Actors */}
            <Grid item xs={12} md={6}>
              <Card sx={{ borderRadius: 2 }}>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <PersonIcon sx={{ color: 'primary.main' }} />
                    <Typography variant="h6" fontWeight={600}>
                      {t('watchStats.sectionTopActors')}
                    </Typography>
                  </Box>
                  {stats.topActors.length > 0 ? (
                    <Box display="flex" flexDirection="column" gap={1.5}>
                      {stats.topActors.map((actor, index) => (
                        <Box 
                          key={actor.name} 
                          display="flex" 
                          alignItems="center" 
                          gap={2}
                          onClick={() => navigate(`/person/${encodeURIComponent(actor.name)}`)}
                          sx={{ 
                            cursor: 'pointer',
                            borderRadius: 1,
                            p: 0.5,
                            mx: -0.5,
                            '&:hover': { bgcolor: 'rgba(99, 102, 241, 0.1)' },
                            transition: 'background-color 0.2s',
                          }}
                        >
                          <Typography 
                            variant="body2" 
                            color="text.secondary" 
                            sx={{ width: 20, textAlign: 'right', flexShrink: 0 }}
                          >
                            {index + 1}.
                          </Typography>
                          <Avatar
                            src={getProxiedImageUrl(actor.thumb)}
                            alt={actor.name}
                            sx={{ 
                              width: 40, 
                              height: 40,
                              bgcolor: 'primary.dark',
                              fontSize: '0.875rem',
                              flexShrink: 0,
                            }}
                          >
                            {actor.name.charAt(0)}
                          </Avatar>
                          <Box flex={1} minWidth={0}>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                              <Typography variant="body2" fontWeight={500} noWrap sx={{ flex: 1 }}>
                                {actor.name}
                              </Typography>
                              <Chip 
                                label={t('watchStats.filmsCount', { count: actor.count })} 
                                size="small" 
                                sx={{ 
                                  height: 20, 
                                  fontSize: '0.7rem',
                                  backgroundColor: 'rgba(99, 102, 241, 0.2)',
                                  ml: 1,
                                  flexShrink: 0,
                                }} 
                              />
                            </Box>
                            <Box 
                              sx={{ 
                                height: 4, 
                                borderRadius: 2, 
                                backgroundColor: 'rgba(99, 102, 241, 0.2)',
                                overflow: 'hidden'
                              }}
                            >
                              <Box 
                                sx={{ 
                                  height: '100%', 
                                  width: `${(actor.count / stats.topActors[0].count) * 100}%`,
                                  backgroundColor: '#6366f1',
                                  borderRadius: 2,
                                }} 
                              />
                            </Box>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t('watchStats.emptyActorData')}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>

            {/* Top Directors */}
            <Grid item xs={12} md={6}>
              <Card sx={{ borderRadius: 2 }}>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <VideocamIcon sx={{ color: 'secondary.main' }} />
                    <Typography variant="h6" fontWeight={600}>
                      {t('watchStats.sectionTopDirectors')}
                    </Typography>
                  </Box>
                  {stats.topDirectors.length > 0 ? (
                    <Box display="flex" flexDirection="column" gap={1.5}>
                      {stats.topDirectors.map((director, index) => (
                        <Box 
                          key={director.name} 
                          display="flex" 
                          alignItems="center" 
                          gap={2}
                          onClick={() => navigate(`/person/${encodeURIComponent(director.name)}`)}
                          sx={{ 
                            cursor: 'pointer',
                            borderRadius: 1,
                            p: 0.5,
                            mx: -0.5,
                            '&:hover': { bgcolor: 'rgba(139, 92, 246, 0.1)' },
                            transition: 'background-color 0.2s',
                          }}
                        >
                          <Typography 
                            variant="body2" 
                            color="text.secondary" 
                            sx={{ width: 20, textAlign: 'right', flexShrink: 0 }}
                          >
                            {index + 1}.
                          </Typography>
                          <Avatar
                            src={getProxiedImageUrl(director.thumb)}
                            alt={director.name}
                            sx={{ 
                              width: 40, 
                              height: 40,
                              bgcolor: 'secondary.dark',
                              fontSize: '0.875rem',
                              flexShrink: 0,
                            }}
                          >
                            {director.name.charAt(0)}
                          </Avatar>
                          <Box flex={1} minWidth={0}>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                              <Typography variant="body2" fontWeight={500} noWrap sx={{ flex: 1 }}>
                                {director.name}
                              </Typography>
                              <Chip 
                                label={t('watchStats.filmsCount', { count: director.count })} 
                                size="small" 
                                sx={{ 
                                  height: 20, 
                                  fontSize: '0.7rem',
                                  backgroundColor: 'rgba(139, 92, 246, 0.2)',
                                  ml: 1,
                                  flexShrink: 0,
                                }} 
                              />
                            </Box>
                            <Box 
                              sx={{ 
                                height: 4, 
                                borderRadius: 2, 
                                backgroundColor: 'rgba(139, 92, 246, 0.2)',
                                overflow: 'hidden'
                              }}
                            >
                              <Box 
                                sx={{ 
                                  height: '100%', 
                                  width: `${(director.count / stats.topDirectors[0].count) * 100}%`,
                                  backgroundColor: '#8b5cf6',
                                  borderRadius: 2,
                                }} 
                              />
                            </Box>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t('watchStats.emptyDirectorData')}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Charts Row 4 - Studios & Networks */}
          <Grid container spacing={3} mt={0}>
            {/* Top Studios */}
            <Grid item xs={12} md={6}>
              <Card sx={{ borderRadius: 2 }}>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <BusinessIcon sx={{ color: '#f97316' }} />
                    <Typography variant="h6" fontWeight={600}>
                      {t('watchStats.sectionTopStudios')}
                    </Typography>
                  </Box>
                  {stats.topStudios.length > 0 ? (
                    <Box display="flex" flexDirection="column" gap={1.5}>
                      {stats.topStudios.map((studio, index) => (
                        <Box 
                          key={studio.name} 
                          display="flex" 
                          alignItems="center" 
                          gap={2}
                          onClick={() => navigate(`/studio/${encodeURIComponent(studio.name)}`)}
                          sx={{ 
                            cursor: 'pointer',
                            borderRadius: 1,
                            p: 0.5,
                            mx: -0.5,
                            '&:hover': { bgcolor: 'rgba(249, 115, 22, 0.1)' },
                            transition: 'background-color 0.2s',
                          }}
                        >
                          <Typography 
                            variant="body2" 
                            color="text.secondary" 
                            sx={{ width: 20, textAlign: 'right', flexShrink: 0 }}
                          >
                            {index + 1}.
                          </Typography>
                          <Avatar
                            src={getProxiedImageUrl(studio.thumb)}
                            alt={studio.name}
                            variant="rounded"
                            sx={{ 
                              width: 40, 
                              height: 40,
                              bgcolor: '#f97316',
                              fontSize: '0.75rem',
                              flexShrink: 0,
                            }}
                          >
                            {studio.name.substring(0, 2).toUpperCase()}
                          </Avatar>
                          <Box flex={1} minWidth={0}>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                              <Typography variant="body2" fontWeight={500} noWrap sx={{ flex: 1 }}>
                                {studio.name}
                              </Typography>
                              <Chip 
                                label={t('watchStats.filmsCount', { count: studio.count })} 
                                size="small" 
                                sx={{ 
                                  height: 20, 
                                  fontSize: '0.7rem',
                                  backgroundColor: 'rgba(249, 115, 22, 0.2)',
                                  ml: 1,
                                  flexShrink: 0,
                                }} 
                              />
                            </Box>
                            <Box 
                              sx={{ 
                                height: 4, 
                                borderRadius: 2, 
                                backgroundColor: 'rgba(249, 115, 22, 0.2)',
                                overflow: 'hidden'
                              }}
                            >
                              <Box 
                                sx={{ 
                                  height: '100%', 
                                  width: `${(studio.count / stats.topStudios[0].count) * 100}%`,
                                  backgroundColor: '#f97316',
                                  borderRadius: 2,
                                }} 
                              />
                            </Box>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t('watchStats.emptyStudioData')}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>

            {/* Top Networks */}
            <Grid item xs={12} md={6}>
              <Card sx={{ borderRadius: 2 }}>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <LiveTvIcon sx={{ color: '#06b6d4' }} />
                    <Typography variant="h6" fontWeight={600}>
                      {t('watchStats.sectionTopNetworks')}
                    </Typography>
                  </Box>
                  {stats.topNetworks.length > 0 ? (
                    <Box display="flex" flexDirection="column" gap={1.5}>
                      {stats.topNetworks.map((network, index) => (
                        <Box 
                          key={network.name} 
                          display="flex" 
                          alignItems="center" 
                          gap={2}
                          onClick={() => navigate(`/studio/${encodeURIComponent(network.name)}`)}
                          sx={{ 
                            cursor: 'pointer',
                            borderRadius: 1,
                            p: 0.5,
                            mx: -0.5,
                            '&:hover': { bgcolor: 'rgba(6, 182, 212, 0.1)' },
                            transition: 'background-color 0.2s',
                          }}
                        >
                          <Typography 
                            variant="body2" 
                            color="text.secondary" 
                            sx={{ width: 20, textAlign: 'right', flexShrink: 0 }}
                          >
                            {index + 1}.
                          </Typography>
                          <Avatar
                            src={getProxiedImageUrl(network.thumb)}
                            alt={network.name}
                            variant="rounded"
                            sx={{ 
                              width: 40, 
                              height: 40,
                              bgcolor: '#06b6d4',
                              fontSize: '0.75rem',
                              flexShrink: 0,
                            }}
                          >
                            {network.name.substring(0, 2).toUpperCase()}
                          </Avatar>
                          <Box flex={1} minWidth={0}>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                              <Typography variant="body2" fontWeight={500} noWrap sx={{ flex: 1 }}>
                                {network.name}
                              </Typography>
                              <Chip 
                                label={t('watchStats.networkSeriesCount', { count: network.count })} 
                                size="small" 
                                sx={{ 
                                  height: 20, 
                                  fontSize: '0.7rem',
                                  backgroundColor: 'rgba(6, 182, 212, 0.2)',
                                  ml: 1,
                                  flexShrink: 0,
                                }} 
                              />
                            </Box>
                            <Box 
                              sx={{ 
                                height: 4, 
                                borderRadius: 2, 
                                backgroundColor: 'rgba(6, 182, 212, 0.2)',
                                overflow: 'hidden'
                              }}
                            >
                              <Box 
                                sx={{ 
                                  height: '100%', 
                                  width: `${(network.count / stats.topNetworks[0].count) * 100}%`,
                                  backgroundColor: '#06b6d4',
                                  borderRadius: 2,
                                }} 
                              />
                            </Box>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t('watchStats.emptyNetworkData')}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Charts Row 5 - Where Hours Go & Taste vs Crowd */}
          <Grid container spacing={3} mt={0}>
            {/* Movies vs TV time split */}
            <Grid item xs={12} md={6}>
              <Card sx={{ borderRadius: 2, height: '100%' }}>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <TheatersIcon sx={{ color: 'primary.main' }} />
                    <Typography variant="h6" fontWeight={600}>
                      {t('watchStats.sectionWhereHoursGo')}
                    </Typography>
                  </Box>
                  {timeSplitTotal > 0 ? (
                    <Box display="flex" alignItems="center" gap={2}>
                      <ResponsiveContainer width="50%" height={200}>
                        <PieChart>
                          <Pie
                            data={timeSplitData}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={80}
                            paddingAngle={2}
                            dataKey="value"
                          >
                            {timeSplitData.map(d => (
                              <Cell key={d.key} fill={d.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#1a1a1a',
                              border: '1px solid #2a2a2a',
                              borderRadius: 8,
                              color: '#f5f5f5',
                            }}
                            itemStyle={{ color: '#f5f5f5' }}
                            formatter={(value, name) => {
                              const hours = typeof value === 'number' ? value : Number(value)
                              const pct = timeSplitTotal > 0 ? Math.round((hours / timeSplitTotal) * 100) : 0
                              return [t('watchStats.splitTooltip', { hours, pct }), name]
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <Box flex={1}>
                        {timeSplitData.map(d => (
                          <Box key={d.key} display="flex" alignItems="center" gap={1} mb={1}>
                            <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: d.color }} />
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
                </CardContent>
              </Card>
            </Grid>

            {/* Taste vs the crowd */}
            <Grid item xs={12} md={6}>
              <Card sx={{ borderRadius: 2, height: '100%' }}>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <ThumbsUpDownIcon sx={{ color: 'secondary.main' }} />
                    <Typography variant="h6" fontWeight={600}>
                      {t('watchStats.sectionTasteVsCrowd')}
                    </Typography>
                  </Box>
                  {stats.avgCommunityRating > 0 ? (
                    <>
                      <Box display="flex" alignItems="baseline" gap={1} mb={2}>
                        <Typography variant="h3" fontWeight={700} color="primary.main">
                          {stats.avgCommunityRating.toFixed(1)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {t('watchStats.avgCommunityRating')}
                        </Typography>
                      </Box>
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
                              sx={{
                                backgroundColor: 'rgba(236, 72, 153, 0.15)',
                                color: '#f472b6',
                                fontWeight: 500,
                              }}
                            />
                          ))}
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary" mt={1.5}>
                          —
                        </Typography>
                      )}
                    </>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t('watchStats.emptyTasteData')}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Charts Row 6 - Activity heatmap */}
          <Grid container spacing={3} mt={0}>
            <Grid item xs={12}>
              <Card sx={{ borderRadius: 2 }}>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                    <CalendarViewMonthIcon sx={{ color: 'primary.main' }} />
                    <Typography variant="h6" fontWeight={600}>
                      {t('watchStats.sectionWhenYouWatch')}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {t('watchStats.heatmapSubtitle')}
                  </Typography>
                  {hasHeatmap ? (
                    <Box mt={2} sx={{ overflowX: 'auto' }}>
                      <Box sx={{ display: 'inline-flex', flexDirection: 'column', gap: 0.5, minWidth: 'min-content' }}>
                        {dayOrder.map(dow => (
                          <Box key={dow} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ width: 32, flexShrink: 0, textAlign: 'right', pr: 0.5 }}
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
                                    sx={{
                                      width: 16,
                                      height: 16,
                                      borderRadius: 0.5,
                                      flexShrink: 0,
                                      backgroundColor:
                                        count > 0 ? `rgba(99, 102, 241, ${intensity})` : 'rgba(148, 163, 184, 0.08)',
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
                            sx={{ width: 14, height: 14, borderRadius: 0.5, backgroundColor: `rgba(99, 102, 241, ${a})` }}
                          />
                        ))}
                        <Typography variant="caption" color="text.secondary">
                          {t('watchStats.heatmapMore')}
                        </Typography>
                      </Box>
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary" mt={2}>
                      {t('watchStats.emptyHeatmapData')}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Charts Row 7 - Most rewatched */}
          <Grid container spacing={3} mt={0}>
            <Grid item xs={12}>
              <Card sx={{ borderRadius: 2 }}>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <ReplayIcon sx={{ color: '#14b8a6' }} />
                    <Typography variant="h6" fontWeight={600}>
                      {t('watchStats.sectionMostRewatched')}
                    </Typography>
                  </Box>
                  {stats.mostRewatched.length > 0 ? (
                    <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 1 }}>
                      {stats.mostRewatched.map(item => (
                        <Box
                          key={item.movieId}
                          onClick={() => navigate(`/movies/${item.movieId}`)}
                          sx={{ width: 120, flexShrink: 0, cursor: 'pointer' }}
                        >
                          <Box
                            sx={{
                              position: 'relative',
                              borderRadius: 2,
                              overflow: 'hidden',
                              aspectRatio: '2 / 3',
                              backgroundColor: 'rgba(148, 163, 184, 0.12)',
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
                                right: 6,
                                height: 22,
                                fontWeight: 700,
                                backgroundColor: 'rgba(20, 184, 166, 0.9)',
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
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </>
      )}
    </Box>
  )
}

