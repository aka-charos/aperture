import { Box, Card, Typography, Skeleton, Link as MuiLink } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import FavoriteIcon from '@mui/icons-material/Favorite'
import AccessTimeIcon from '@mui/icons-material/AccessTime'

interface QuickStatsBarProps {
  moviesWatched: number
  seriesWatched: number
  ratingsCount: number
  watchTimeMinutes: number
  /**
   * The window the four figures cover, as decided by the API. Absent means an
   * older server that answered all-time, so the caption is left off rather
   * than naming a window nobody applied.
   */
  windowDays?: number
  loading?: boolean
}

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string | number
  color: string
  loading?: boolean
}

function StatCard({ icon, label, value, color, loading }: StatCardProps) {
  return (
    <Card
      sx={{
        flex: { xs: '1 1 calc(50% - 8px)', sm: 1 },
        minWidth: { xs: 0, sm: 140 },
        p: { xs: 1.5, sm: 2 },
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
      }}
    >
      <Box
        sx={{
          width: 44,
          height: 44,
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${color}20`,
          color: color,
        }}
      >
        {icon}
      </Box>
      <Box>
        {loading ? (
          <>
            <Skeleton width={60} height={28} />
            <Skeleton width={80} height={16} />
          </>
        ) : (
          <>
            <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
              {value}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
          </>
        )}
      </Box>
    </Card>
  )
}

function formatWatchTime(minutes: number, t: TFunction): string {
  if (minutes < 60) return t('dashboard.watchTimeMinutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('dashboard.watchTimeHours', { count: hours })
  const days = Math.floor(hours / 24)
  return t('dashboard.watchTimeDays', { count: days })
}

export function QuickStatsBar({
  moviesWatched,
  seriesWatched,
  ratingsCount,
  watchTimeMinutes,
  windowDays,
  loading,
}: QuickStatsBarProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  return (
    <Box>
      {/* The bar states the period it covers, because four bare numbers do
          not say whether they mean this month or all the years on the
          server — and the link is where the all-time figures went. */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 2,
          mb: 1,
        }}
      >
        {windowDays != null ? (
          <Typography variant="caption" color="text.secondary">
            {t('dashboard.statsWindow', { count: windowDays })}
          </Typography>
        ) : (
          <span />
        )}
        <MuiLink
          component={RouterLink}
          to="/stats"
          variant="caption"
          underline="hover"
          sx={{ flexShrink: 0 }}
        >
          {t('dashboard.statsMoreDetails')}
        </MuiLink>
      </Box>
      <Box
        sx={{
          display: 'flex',
          gap: 2,
          flexWrap: { xs: 'wrap', sm: 'nowrap' },
          overflowX: { xs: 'visible', sm: 'auto' },
          pb: 1,
          '&::-webkit-scrollbar': { height: 6 },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'divider',
            borderRadius: 3,
          },
        }}
      >
        <StatCard
          icon={<MovieIcon />}
          label={t('dashboard.statMoviesWatched')}
          value={moviesWatched.toLocaleString()}
          color={theme.palette.primary.main}
          loading={loading}
        />
        <StatCard
          icon={<TvIcon />}
          label={t('dashboard.statSeriesWatched')}
          value={seriesWatched.toLocaleString()}
          color={theme.palette.secondary.main}
          loading={loading}
        />
        <StatCard
          icon={<FavoriteIcon />}
          label={t('dashboard.statRatings')}
          value={ratingsCount.toLocaleString()}
          color="#ec4899"
          loading={loading}
        />
        <StatCard
          icon={<AccessTimeIcon />}
          label={t('dashboard.statWatchTime')}
          value={formatWatchTime(watchTimeMinutes, t)}
          color="#10b981"
          loading={loading}
        />
      </Box>
    </Box>
  )
}
