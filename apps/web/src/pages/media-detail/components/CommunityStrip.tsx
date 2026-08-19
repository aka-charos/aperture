import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Typography, Tooltip, LinearProgress } from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import FavoriteIcon from '@mui/icons-material/Favorite'
import StarIcon from '@mui/icons-material/Star'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import type { Media, MovieWatchStats, SeriesWatchStats } from '../types'
import { isMovie } from '../types'

type WatchStats = MovieWatchStats | SeriesWatchStats

interface CommunityStripProps {
  media: Media
  watchStats?: WatchStats | null
}

interface Stat {
  id: string
  icon: ReactElement
  value: string
  label: string
  tooltip?: string
}

interface Meter {
  id: string
  label: string
  pct: number
  color: 'primary' | 'secondary'
}

const ICON_SX = { fontSize: 18 } as const

/**
 * How many of this instance's users have watched a title, as one line.
 *
 * This was a bordered, gradient-filled card at the top of the info card — a
 * heading, an icon, `h5` numerals and a 6px bar, about 150px of page for four
 * integers and a percentage that the bar only restated. It sits in the hero
 * now, between the genres and the actions, because it is a fact about the
 * title rather than a section of its own, and because reading it required
 * scrolling past the fold on a page whose top half was empty.
 *
 * The reach bar survives the compression at 3px, since a proportion is the one
 * number here that a reader takes in faster as a length than as digits.
 *
 * Rendered as flex-wrap with no breakpoints: this page also renders inside
 * MediaDetailModal and beside the assistant dock, so the available width is
 * not the window's.
 */
export function CommunityStrip({ media, watchStats }: CommunityStripProps) {
  const { t } = useTranslation()

  if (!watchStats) return null

  const stats: Stat[] = []
  const meters: Meter[] = []

  if (isMovie(media)) {
    const s = watchStats as MovieWatchStats
    if (s.totalWatchers <= 0) return null

    stats.push({
      id: 'watched',
      icon: <VisibilityIcon sx={{ ...ICON_SX, color: 'info.main' }} />,
      value: String(s.totalWatchers),
      label: t('mediaDetail.infoCard.watched'),
      tooltip: t('mediaDetail.infoCard.movieWatchersTooltip', {
        pct: s.watchPercentage,
        total: s.totalUsers,
      }),
    })
    if (s.totalPlays > 0) {
      stats.push({
        id: 'plays',
        icon: <PlayArrowIcon sx={{ ...ICON_SX, color: 'success.main' }} />,
        value: String(s.totalPlays),
        label: t('mediaDetail.infoCard.plays'),
      })
    }
    if (s.favoritesCount > 0) {
      stats.push({
        id: 'favorited',
        icon: <FavoriteIcon sx={{ ...ICON_SX, color: 'error.main' }} />,
        value: String(s.favoritesCount),
        label: t('mediaDetail.infoCard.favorited'),
      })
    }
    if (s.averageUserRating != null) {
      stats.push({
        id: 'rating',
        icon: <StarIcon sx={{ ...ICON_SX, color: 'warning.main' }} />,
        value: s.averageUserRating.toFixed(1),
        label: t('mediaDetail.infoCard.avgRatingCount', { count: s.totalRatings }),
      })
    }
    if (s.watchPercentage > 0) {
      meters.push({
        id: 'reach',
        label: t('mediaDetail.infoCard.householdReach'),
        pct: s.watchPercentage,
        color: 'primary',
      })
    }
  } else {
    const s = watchStats as SeriesWatchStats
    if (s.totalViewers <= 0 && s.currentlyWatching <= 0) return null

    if (s.currentlyWatching > 0) {
      stats.push({
        id: 'watchingNow',
        icon: <TrendingUpIcon sx={{ ...ICON_SX, color: 'success.main' }} />,
        value: String(s.currentlyWatching),
        label: t('mediaDetail.infoCard.watchingNow'),
      })
    }
    if (s.totalViewers > 0) {
      stats.push({
        id: 'viewers',
        icon: <VisibilityIcon sx={{ ...ICON_SX, color: 'info.main' }} />,
        value: String(s.totalViewers),
        label: t('mediaDetail.infoCard.viewers'),
      })
    }
    if (s.completedViewers > 0) {
      stats.push({
        id: 'completed',
        icon: <CheckCircleIcon sx={{ ...ICON_SX, color: 'warning.main' }} />,
        value: String(s.completedViewers),
        label: t('mediaDetail.infoCard.completed'),
      })
    }
    if (s.totalEpisodePlays > 0) {
      stats.push({
        id: 'episodePlays',
        icon: <PlayArrowIcon sx={{ ...ICON_SX, color: 'secondary.main' }} />,
        value: String(s.totalEpisodePlays),
        label: t('mediaDetail.infoCard.episodePlays'),
      })
    }
    if (s.averageUserRating != null) {
      stats.push({
        id: 'rating',
        icon: <StarIcon sx={{ ...ICON_SX, color: 'warning.main' }} />,
        value: s.averageUserRating.toFixed(1),
        label: t('mediaDetail.infoCard.avgRatingCount', { count: s.totalRatings }),
      })
    }
    if (s.averageProgress > 0) {
      meters.push({
        id: 'progress',
        label: t('mediaDetail.infoCard.averageViewerProgress', { count: s.totalEpisodes }),
        pct: s.averageProgress,
        color: 'primary',
      })
    }
    if (s.watchPercentage > 0) {
      meters.push({
        id: 'reach',
        label: t('mediaDetail.infoCard.userReach'),
        pct: s.watchPercentage,
        color: 'secondary',
      })
    }
  }

  if (stats.length === 0 && meters.length === 0) return null

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        // No rules above and below. They were there to mark the strip off from
        // the genres above and the buttons below, but a rule can only run the
        // full width of the hero, and the strip is a third of that — so the
        // line carried on past the last number to no edge and nothing to align
        // with, which read as a broken table. The icons already group these
        // well enough to do without.
        columnGap: 3,
        rowGap: 1,
        mt: 0.5,
        mb: 2.5,
      }}
    >
      {stats.map(({ id, icon, value, label, tooltip }) => {
        const item = (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            {icon}
            <Typography variant="body2" fontWeight={700} lineHeight={1.2}>
              {value}
            </Typography>
            <Typography variant="body2" color="text.secondary" lineHeight={1.2}>
              {label}
            </Typography>
          </Box>
        )
        return tooltip ? (
          <Tooltip key={id} title={tooltip}>
            {item}
          </Tooltip>
        ) : (
          <Box key={id}>{item}</Box>
        )
      })}

      {meters.map(({ id, label, pct, color }) => (
        <Box
          key={id}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            // Sits inline while the row has space and takes its own line when
            // it doesn't — the label is the longest item here, so it is the
            // first thing that should wrap.
            flex: '0 1 auto',
            minWidth: '10rem',
          }}
        >
          <Typography variant="body2" color="text.secondary" noWrap>
            {label}
          </Typography>
          <Typography variant="body2" fontWeight={700} color={`${color}.main`}>
            {pct}%
          </Typography>
          <LinearProgress
            variant="determinate"
            value={pct}
            color={color}
            sx={{
              flex: 1,
              minWidth: 48,
              maxWidth: 96,
              height: 3,
              borderRadius: 2,
              bgcolor: 'action.hover',
              '& .MuiLinearProgress-bar': { borderRadius: 2 },
            }}
          />
        </Box>
      ))}
    </Box>
  )
}
