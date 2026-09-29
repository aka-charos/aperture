import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Chip, Typography } from '@mui/material'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import type { MediaKind } from './sharedView'

/**
 * One kind of title inside a person's card — "Movies" or "Series" — with the
 * icon and label the dashboard's Recent Watches columns use, and a count.
 *
 * Sections rather than a badge on each poster: every corner of these posters
 * is taken (top-left by Dismiss or the Sent status, top-right by the viewer's
 * own badges) or unsafe (library artwork burns flags and ratings into the
 * bottom edge), and a section states the kind once for a whole row instead of
 * repeating it on every title.
 */
export function TypeSection({
  type,
  count,
  children,
}: {
  type: MediaKind
  count: number
  children: ReactNode
}) {
  const { t } = useTranslation()
  const Icon = type === 'movie' ? MovieIcon : TvIcon
  return (
    <Box sx={{ '& + &': { mt: 3 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, color: 'text.secondary' }}>
        <Icon sx={{ fontSize: 18 }} />
        <Typography variant="subtitle2" component="h3" color="text.secondary">
          {type === 'movie' ? t('dashboard.movies') : t('dashboard.series')}
        </Typography>
        <Chip label={count} size="small" sx={{ height: 20, fontSize: '0.7rem', fontWeight: 600 }} />
      </Box>
      {children}
    </Box>
  )
}
