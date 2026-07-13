/**
 * EpisodeAvailabilityBar Component
 *
 * One segmented bar consolidating watch progress and server availability:
 * primary = watched, green = on the server but unwatched, red = aired but
 * missing from the server. Hovering the bar reveals the full breakdown,
 * including seasons entirely absent from the server.
 */

import { useTranslation } from 'react-i18next'
import { Box, Tooltip, Typography, alpha } from '@mui/material'
import type { WatchingSeries } from '../hooks/useWatchingData'

interface EpisodeAvailabilityBarProps {
  series: WatchingSeries
  showPercent?: boolean
}

function BreakdownLine({ color, text }: { color?: string; text: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      {color && (
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
      )}
      <Typography variant="caption">{text}</Typography>
    </Box>
  )
}

export function EpisodeAvailabilityBar({ series, showPercent = false }: EpisodeAvailabilityBarProps) {
  const { t } = useTranslation()

  // Bar spans all aired episodes (per TMDB) when known, so missing content
  // keeps a fully watched library from reading as 100% complete.
  const total = Math.max(series.episodesOnServer, series.episodesAired ?? 0)
  if (total <= 0) return null

  const onServer = Math.min(series.episodesOnServer, total)
  const watched = Math.min(series.episodesWatched, onServer)
  const unwatched = onServer - watched
  const missing = total - onServer
  const isComplete = watched >= total
  const missingSeasonsLabel =
    series.missingSeasons.length > 0
      ? series.missingSeasons.map((n) => `S${n}`).join(', ')
      : null

  const breakdown = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, py: 0.25 }}>
      <BreakdownLine
        color="primary.main"
        text={t('watching.barWatched', { watched, total })}
      />
      {unwatched > 0 && (
        <BreakdownLine
          color="success.main"
          text={t('watching.barUnwatched', { count: unwatched })}
        />
      )}
      {missing > 0 && (
        <BreakdownLine
          color="error.main"
          text={t('watching.barMissing', { count: missing })}
        />
      )}
      {missingSeasonsLabel && (
        <BreakdownLine text={t('watching.barMissingSeasons', { seasons: missingSeasonsLabel })} />
      )}
    </Box>
  )

  return (
    <Tooltip title={breakdown} arrow>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'default' }}>
        <Typography
          variant="caption"
          fontWeight={600}
          color={isComplete ? 'success.main' : 'text.secondary'}
          sx={{ flexShrink: 0, lineHeight: 1 }}
        >
          {t('watching.episodesProgress', { watched, total })}
        </Typography>
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            height: 5,
            borderRadius: 3,
            overflow: 'hidden',
            bgcolor: (theme) => alpha(theme.palette.text.primary, 0.1),
          }}
        >
          {watched > 0 && (
            <Box sx={{ width: `${(watched / total) * 100}%`, bgcolor: 'primary.main' }} />
          )}
          {unwatched > 0 && (
            <Box sx={{ width: `${(unwatched / total) * 100}%`, bgcolor: 'success.main' }} />
          )}
          {missing > 0 && (
            <Box sx={{ width: `${(missing / total) * 100}%`, bgcolor: 'error.main' }} />
          )}
        </Box>
        {showPercent && (
          <Typography
            variant="caption"
            fontWeight={600}
            color={isComplete ? 'success.main' : 'text.secondary'}
            sx={{ flexShrink: 0, lineHeight: 1 }}
          >
            {Math.round((watched / total) * 100)}%
          </Typography>
        )}
      </Box>
    </Tooltip>
  )
}
