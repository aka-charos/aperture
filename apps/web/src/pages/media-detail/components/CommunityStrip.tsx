import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Typography, Tooltip, LinearProgress } from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import FavoriteIcon from '@mui/icons-material/Favorite'
import StarIcon from '@mui/icons-material/Star'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import type { Media, MovieWatchStats, SeriesWatchStats, Watcher } from '../types'
import { isMovie } from '../types'
import { WatcherListDialog } from './WatcherListDialog'

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
  /**
   * Named people behind this number. Present only when the server sent names,
   * which is the whole gate — the strip has no idea who is allowed to see them
   * and must not: it renders what arrived.
   */
  watchers?: Watcher[]
  /** Heading for the drill-in dialog. Required alongside `watchers`. */
  watchersTitle?: string
}

/** Names for the hover summary; the dialog carries the full list. */
const TOOLTIP_NAMES = 8

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
  // Above the early returns: this component bails in three places and a hook
  // after any of them is a hooks-order violation.
  const [openStat, setOpenStat] = useState<Stat | null>(null)

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
      watchers: s.watchers,
      watchersTitle: t('mediaDetail.infoCard.watchedByTitle'),
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
        watchers: s.watchers?.filter((w) => w.favorite),
        watchersTitle: t('mediaDetail.infoCard.favoritedByTitle'),
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
        watchers: s.watchers,
        watchersTitle: t('mediaDetail.infoCard.watchedByTitle'),
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
    <>
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
      {stats.map((stat) => {
        const { id, icon, value, label, tooltip, watchers } = stat
        // Names only where the server sent some. An empty list means the
        // counter has no one behind it this viewer may see, which is not a
        // reason to offer an empty dialog.
        const named = watchers && watchers.length > 0 ? watchers : undefined

        const item = (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              ...(named && {
                cursor: 'pointer',
                borderRadius: 1,
                px: 0.5,
                mx: -0.5,
                '&:hover': { bgcolor: 'action.hover' },
              }),
            }}
            {...(named && {
              role: 'button',
              tabIndex: 0,
              onClick: () => setOpenStat(stat),
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setOpenStat(stat)
                }
              },
            })}
          >
            {icon}
            <Typography variant="body2" fontWeight={700} lineHeight={1.2}>
              {value}
            </Typography>
            <Typography variant="body2" color="text.secondary" lineHeight={1.2}>
              {label}
            </Typography>
          </Box>
        )

        // The hover summary names the first few and says how to see the rest;
        // the dialog is the answer on touch, where there is no hover at all.
        const title = named ? (
          <>
            <Box component="span" sx={{ display: 'block' }}>
              {named
                .slice(0, TOOLTIP_NAMES)
                .map((w) => w.name)
                .join(', ')}
              {named.length > TOOLTIP_NAMES &&
                t('mediaDetail.infoCard.watchersMore', { count: named.length - TOOLTIP_NAMES })}
            </Box>
            <Box component="span" sx={{ display: 'block', opacity: 0.7, mt: 0.5 }}>
              {t('mediaDetail.infoCard.watchersOpenHint')}
            </Box>
          </>
        ) : (
          tooltip
        )

        return title ? (
          <Tooltip key={id} title={title}>
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

      {openStat?.watchers && (
        <WatcherListDialog
          open
          title={openStat.watchersTitle ?? openStat.label}
          watchers={openStat.watchers}
          onClose={() => setOpenStat(null)}
        />
      )}
    </>
  )
}
