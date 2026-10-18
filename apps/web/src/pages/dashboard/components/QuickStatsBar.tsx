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

/**
 * The bar sizes itself off its OWN width, not the window's: the page pane is
 * the window minus the sidebar and the docked assistant, so a window
 * breakpoint can promise room the pane does not have, and a one-line strip
 * of no-wrap text then runs off the edge and is clipped. Measured from the
 * strip's content: four figures, the period and the link need about 900px.
 */
const WIDE = '@container stats (min-width: 900px)'

interface StatProps {
  icon: React.ReactNode
  label: string
  value: string | number
  color: string
  loading?: boolean
}

/**
 * One figure: a tinted icon, the number, its label. Narrow, each sits in its
 * own small card in a 2×2 grid; wide, the four share one strip.
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
        px: 1.25,
        py: 1,
        borderRadius: 3,
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        [WIDE]: { px: 1.5, py: 0.75, borderRadius: 999, bgcolor: 'transparent', border: 0 },
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

  // The bar states the period it covers, because four bare numbers do not say
  // whether they mean this month or all the years on the server — and the link
  // is where the all-time figures went. Wide, it is one strip: the four
  // figures, then the period and the link, so it costs one line of the page.
  // Narrow, the figures are a 2×2 grid with the period and the link under it.
  const period = (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 2,
        [WIDE]: {
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 1.25,
          ps: 1.25,
          borderInlineStart: `1px solid ${theme.palette.divider}`,
        },
      }}
    >
      {windowLabel ? (
        <Typography variant="caption" color="text.secondary" noWrap>
          {windowLabel}
        </Typography>
      ) : (
        <span />
      )}
      <MuiLink
        component={RouterLink}
        to="/stats"
        underline="none"
        sx={{
          flexShrink: 0,
          fontSize: 13,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          color: 'primary.light',
          borderRadius: 999,
          [WIDE]: {
            px: 1.5,
            py: 0.75,
            bgcolor: alpha(theme.palette.primary.main, 0.16),
            '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.26) },
          },
        }}
      >
        {t('dashboard.statsMoreDetails')}
      </MuiLink>
    </Box>
  )

  return (
    <Box sx={{ containerType: 'inline-size', containerName: 'stats' }}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          [WIDE]: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 0.5,
            width: 'fit-content',
            p: 0.75,
            borderRadius: 999,
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
          },
        }}
      >
        <Box
          role="list"
          aria-label={windowLabel ?? undefined}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 1,
            [WIDE]: { display: 'flex', alignItems: 'center', gap: 0.5 },
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
        </Box>
        {period}
      </Box>
    </Box>
  )
}
