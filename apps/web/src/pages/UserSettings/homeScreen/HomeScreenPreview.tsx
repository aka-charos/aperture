import { Alert, Box, Card, CardContent, Chip, Typography } from '@mui/material'
import TvIcon from '@mui/icons-material/Tv'
import { useTranslation } from 'react-i18next'
import { useAppName } from '@/lib/branding'
import type { ProjectedRow } from './types'

/**
 * The viewer's Emby home screen, top to bottom, as it will be once their rows
 * are applied: their own rows as they are, Aperture's highlighted, new ones
 * marked. The order is worked out on the server by the same planner that moves
 * rows, so this list is the one the TV will show.
 */
export function HomeScreenPreview({
  rows,
  unavailable,
  sortBy,
}: {
  rows: ProjectedRow[] | null
  unavailable: boolean
  sortBy: string
}) {
  const { t } = useTranslation()
  const appName = useAppName()

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <TvIcon color="primary" />
          <Typography variant="subtitle1" fontWeight={600} component="h3">
            {t('userSettings.homeScreen.previewTitle')}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('userSettings.homeScreen.previewHelp')}
        </Typography>

        {unavailable || !rows ? (
          <Alert severity="warning">{t('userSettings.homeScreen.previewUnavailable')}</Alert>
        ) : rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('userSettings.homeScreen.previewEmpty')}
          </Typography>
        ) : (
          <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 0.75 }}>
            {rows.map((row) => {
              const ours = row.feature !== null
              const name = row.group
                ? t(`homeScreenPlacement.groups.${row.id}`, { defaultValue: row.name })
                : row.name
              return (
                <Box
                  component="li"
                  key={row.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.5,
                    py: ours ? 1 : 0.75,
                    borderRadius: 1.5,
                    border: 1,
                    borderColor: ours ? 'primary.main' : 'divider',
                    backgroundColor: ours ? 'action.selected' : 'transparent',
                    borderStyle: row.pending ? 'dashed' : 'solid',
                  }}
                >
                  <Typography
                    variant="body2"
                    fontWeight={ours ? 600 : 400}
                    color={ours ? 'text.primary' : 'text.secondary'}
                    noWrap
                    sx={{ flex: 1, minWidth: 0 }}
                  >
                    {name}
                  </Typography>
                  {row.pending ? (
                    <Chip size="small" color="info" label={t('userSettings.homeScreen.previewNew')} sx={{ height: 20 }} />
                  ) : ours ? (
                    <Chip size="small" color="primary" variant="outlined" label={appName} sx={{ height: 20 }} />
                  ) : null}
                </Box>
              )
            })}
          </Box>
        )}

        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2 }}>
          {t('userSettings.homeScreen.previewSort', {
            sort: t(`homeScreenPlacement.sort.${sortBy}`, { defaultValue: sortBy }),
          })}
        </Typography>
      </CardContent>
    </Card>
  )
}
