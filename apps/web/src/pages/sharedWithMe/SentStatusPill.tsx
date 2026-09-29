import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Chip, Tooltip } from '@mui/material'
import { alpha, type Theme } from '@mui/material/styles'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PlayCircleIcon from '@mui/icons-material/PlayCircle'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import BlockIcon from '@mui/icons-material/Block'
import type { SentStatus } from './sharedView'

const LOOK: Record<SentStatus, { icon: ReactElement; color: (theme: Theme) => string }> = {
  watched: { icon: <CheckCircleIcon />, color: (theme) => theme.palette.success.main },
  watching: { icon: <PlayCircleIcon />, color: (theme) => theme.palette.info.main },
  waiting: { icon: <HourglassEmptyIcon />, color: (theme) => theme.palette.grey[600] },
  unavailable: { icon: <BlockIcon />, color: (theme) => theme.palette.warning.dark },
}

interface SentStatusPillProps {
  status: SentStatus
  progress?: { watched: number; total: number }
  /** The recipient, for the tooltip. */
  name: string
}

/**
 * Where one sent title stands with its recipient, on the poster. Bottom-left:
 * top-right is the poster's own badge stack, and the status is the one thing
 * on this tab the reader came to see.
 */
export function SentStatusPill({ status, progress, name }: SentStatusPillProps) {
  const { t } = useTranslation()
  const look = LOOK[status]
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
          bottom: 8,
          insetInlineStart: 8,
          // Above the hover overlay (1), level with the poster's own badges.
          zIndex: 2,
          height: 24,
          maxWidth: 'calc(100% - 16px)',
          fontWeight: 600,
          fontSize: '0.7rem',
          color: 'common.white',
          backgroundColor: (theme) => alpha(look.color(theme), 0.92),
          boxShadow: 2,
          '& .MuiChip-icon': { color: 'inherit', fontSize: 16 },
        }}
      />
    </Tooltip>
  )
}

/** A status and how many titles are in it, for a person's header. */
export function SentStatusCount({ status, count }: { status: SentStatus; count: number }) {
  const { t } = useTranslation()
  const look = LOOK[status]
  return (
    <Chip
      size="small"
      variant="outlined"
      icon={look.icon}
      label={t(`sharedWithMe.statusCount.${status}`, { count })}
      sx={{
        fontWeight: 600,
        borderColor: (theme) => alpha(look.color(theme), 0.5),
        color: (theme) => look.color(theme),
        backgroundColor: (theme) => alpha(look.color(theme), 0.08),
        '& .MuiChip-icon': { color: 'inherit', fontSize: 16 },
      }}
    />
  )
}
