/**
 * The dated lines on a getUpcomingEpisodes card: the next episode and when it is
 * expected, then the latest one that has aired and whether the library holds it.
 * Kept visibly apart, since only the second can be something to play today.
 */
import { Box, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { episodeCode, formatAirDay, latestAiredKey, nextDateKey } from './upcomingText'
import type { UpcomingInfo } from './types'

export function UpcomingLines({ upcoming }: { upcoming: UpcomingInfo }) {
  const { t, i18n } = useTranslation()
  const { next, latestAired } = upcoming
  const code = episodeCode(next.season, next.number)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
      <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600 }}>
        {next.title ? `${code} · ${next.title}` : code}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.primary' }}>
        {t(`assistantToolUi.${nextDateKey(next)}`, { date: formatAirDay(next.airDate, i18n.language) })}
      </Typography>
      {latestAired && (
        <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.35 }}>
          {t(`assistantToolUi.${latestAiredKey(latestAired)}`, {
            code: episodeCode(latestAired.season, latestAired.number),
            date: formatAirDay(latestAired.airDate, i18n.language),
          })}
        </Typography>
      )}
    </Box>
  )
}
