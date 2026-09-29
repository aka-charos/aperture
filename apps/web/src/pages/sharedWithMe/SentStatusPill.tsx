import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Chip, Tooltip, useTheme } from '@mui/material'
import { alpha, type Theme } from '@mui/material/styles'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PlayCircleIcon from '@mui/icons-material/PlayCircle'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import BlockIcon from '@mui/icons-material/Block'
import type { SentStatus } from './sharedView'

/**
 * One accent per status, chosen to read on the dark theme's paper AND as an
 * icon on a dark chip: white text on success or info green/blue fails
 * contrast, so the colour goes on the icon and the border, never behind text.
 */
const LOOK: Record<SentStatus, { icon: ReactElement; accent: (theme: Theme) => string }> = {
  watched: { icon: <CheckCircleIcon />, accent: (theme) => theme.palette.success.main },
  watching: { icon: <PlayCircleIcon />, accent: (theme) => theme.palette.info.light },
  waiting: { icon: <HourglassEmptyIcon />, accent: (theme) => theme.palette.text.secondary },
  unavailable: { icon: <BlockIcon />, accent: (theme) => theme.palette.warning.main },
}

interface SentStatusPillProps {
  status: SentStatus
  progress?: { watched: number; total: number }
  /** The recipient, for the tooltip. */
  name: string
}

/**
 * Where one sent title stands with its recipient, on the poster.
 *
 * Top-left: the bottom of a poster is where its hover overlay prints the title
 * and synopsis, which a pill this wide would cover, and top-right is the
 * poster's own badge stack. A dark translucent chip with a coloured icon, the
 * poster overlays' own look (`EpisodeProgressBadge`), so it reads on any art.
 */
export function SentStatusPill({ status, progress, name }: SentStatusPillProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const look = LOOK[status]
  const accent = look.accent(theme)
  const label =
    status === 'watching' && progress
      ? t('sharedWithMe.statusWatchingProgress', { watched: progress.watched, total: progress.total })
      : t(`sharedWithMe.status.${status}`)
  const hint = t(`sharedWithMe.statusHint.${status}`, {
    name,
    watched: progress?.watched ?? 0,
    total: progress?.total ?? 0,
  })

  return (
    <Tooltip title={hint} arrow>
      <Chip
        size="small"
        icon={look.icon}
        label={label}
        sx={{
          position: 'absolute',
          top: 8,
          insetInlineStart: 8,
          // Above the hover overlay (1), level with the poster's own badges.
          zIndex: 2,
          height: 24,
          maxWidth: 'calc(100% - 16px)',
          fontWeight: 600,
          fontSize: '0.7rem',
          color: 'common.white',
          backgroundColor: alpha('#000', 0.75),
          border: '1px solid',
          borderColor: alpha(accent, 0.6),
          '& .MuiChip-icon': { color: accent, fontSize: 16 },
        }}
      />
    </Tooltip>
  )
}

/** A status and how many titles are in it, for a person's header. */
export function SentStatusCount({ status, count }: { status: SentStatus; count: number }) {
  const { t } = useTranslation()
  const theme = useTheme()
  const look = LOOK[status]
  const accent = look.accent(theme)
  return (
    <Chip
      size="small"
      variant="outlined"
      icon={look.icon}
      label={t(`sharedWithMe.statusCount.${status}`, { count })}
      sx={{
        fontWeight: 600,
        borderColor: alpha(accent, 0.5),
        color: accent,
        backgroundColor: alpha(accent, 0.08),
        '& .MuiChip-icon': { color: 'inherit', fontSize: 16 },
      }}
    />
  )
}
