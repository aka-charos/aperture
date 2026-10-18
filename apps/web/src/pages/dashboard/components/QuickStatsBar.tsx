import { alpha, Box, Typography, Skeleton, Link as MuiLink } from '@mui/material'
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

interface StatProps {
  icon: React.ReactNode
  label: string
  value: string | number
  color: string
  loading?: boolean
}

/**
 * One figure: a tinted icon, the number, its label. On a phone each sits in
 * its own small card in a 2×2 grid; from `md` the four share one strip.
 */
function Stat({ icon, label, value, color, loading }: StatProps) {
  return (
    <Box
      role="listitem"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        minWidth: 0,
        px: { xs: 1.25, md: 1.5 },
        py: { xs: 1, md: 0.75 },
        pl: { md: 0.75 },
        borderRadius: { xs: 3, md: 999 },
        bgcolor: { xs: 'background.paper', md: 'transparent' },
        border: { xs: 1, md: 0 },
        borderColor: 'divider',
      }}
    >
      <Box
        sx={{
          width: 28,
          height: 28,
          flex: '0 0 auto',
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          backgroundColor: alpha(color, 0.2),
          color,
          '& svg': { fontSize: 16 },
        }}
      >
        {icon}
      </Box>
      {loading ? (
        <Skeleton width={90} height={22} />
      ) : (
        <>
          <Typography component="span" sx={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {value}
          </Typography>
          <Typography component="span" variant="body2" color="text.secondary" noWrap>
            {label}
          </Typography>
        </>
      )}
    </Box>
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
  const windowLabel = windowDays != null ? t('dashboard.statsWindow', { count: windowDays }) : null
  const moreLink = (
    <MuiLink
      component={RouterLink}
      to="/stats"
      underline="none"
      sx={{
        flexShrink: 0,
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        px: { md: 1.5 },
        py: { md: 0.75 },
        borderRadius: 999,
        bgcolor: { md: alpha(theme.palette.primary.main, 0.16) },
        color: { xs: 'primary.light', md: 'primary.light' },
        '&:hover': { bgcolor: { md: alpha(theme.palette.primary.main, 0.26) } },
      }}
    >
      {t('dashboard.statsMoreDetails')}
    </MuiLink>
  )

  // The bar states the period it covers, because four bare numbers do not say
  // whether they mean this month or all the years on the server — and the link
  // is where the all-time figures went. From `md` it is one strip: the four
  // figures, then the period and the link, so it costs one line of the page.
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box
        role="list"
        aria-label={windowLabel ?? undefined}
        sx={{
          display: { xs: 'grid', md: 'flex' },
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          alignItems: 'center',
          gap: { xs: 1, md: 0.5 },
          alignSelf: { md: 'flex-start' },
          maxWidth: '100%',
          p: { md: 0.75 },
          borderRadius: 999,
          bgcolor: { md: 'background.paper' },
          border: { md: 1 },
          borderColor: { md: 'divider' },
        }}
      >
        <Stat
          icon={<MovieIcon />}
          label={t('dashboard.statMoviesWatched')}
          value={moviesWatched.toLocaleString()}
          color={theme.palette.primary.main}
          loading={loading}
        />
        <Stat
          icon={<TvIcon />}
          label={t('dashboard.statSeriesWatched')}
          value={seriesWatched.toLocaleString()}
          color={theme.palette.secondary.main}
          loading={loading}
        />
        <Stat
          icon={<FavoriteIcon />}
          label={t('dashboard.statRatings')}
          value={ratingsCount.toLocaleString()}
          color="#ec4899"
          loading={loading}
        />
        <Stat
          icon={<AccessTimeIcon />}
          label={t('dashboard.statWatchTime')}
          value={formatWatchTime(watchTimeMinutes, t)}
          color="#10b981"
          loading={loading}
        />
        <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1.25, ps: 1, ms: 0.5, borderInlineStart: 1, borderColor: 'divider' }}>
          {windowLabel && (
            <Typography variant="caption" color="text.secondary" noWrap>
              {windowLabel}
            </Typography>
          )}
          {moreLink}
        </Box>
      </Box>
      {/* On a phone the period and the link sit under the grid. */}
      <Box sx={{ display: { xs: 'flex', md: 'none' }, justifyContent: 'space-between', alignItems: 'baseline', gap: 2 }}>
        {windowLabel ? (
          <Typography variant="caption" color="text.secondary">
            {windowLabel}
          </Typography>
        ) : (
          <span />
        )}
        {moreLink}
      </Box>
    </Box>
  )
}
