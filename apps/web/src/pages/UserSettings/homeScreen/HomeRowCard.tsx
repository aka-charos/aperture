import { useState, type ReactElement } from 'react'
import { Box, Button, Card, CardContent, CircularProgress, Collapse, Switch, Tooltip, Typography } from '@mui/material'
import WhatshotIcon from '@mui/icons-material/Whatshot'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import RecommendIcon from '@mui/icons-material/Recommend'
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay'
import TuneIcon from '@mui/icons-material/Tune'
import { useTranslation } from 'react-i18next'
import { describePlacement, type HomeRowOption } from '@/components/homeSections/placement'
import { PlacementEditor } from './PlacementEditor'
import { RowPosterStrip } from './RowPosterStrip'
import { rowStatus, statusColor, type RowStatus } from './rowStatus'
import type { InstantOutcome, UserHomeRow } from './types'

const FEATURE_ICONS: Record<string, ReactElement> = {
  'top-picks-movies': <WhatshotIcon />,
  'top-picks-series': <WhatshotIcon />,
  'recs-movies': <AutoAwesomeIcon />,
  'recs-series': <AutoAwesomeIcon />,
  friends: <RecommendIcon />,
  playlists: <PlaylistPlayIcon />,
}

export function FeatureIcon({ feature }: { feature: string }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: 40,
        height: 40,
        flex: '0 0 auto',
        borderRadius: 1.5,
        display: 'grid',
        placeItems: 'center',
        color: 'primary.main',
        backgroundColor: 'action.hover',
      }}
    >
      {FEATURE_ICONS[feature] ?? <PlaylistPlayIcon />}
    </Box>
  )
}

interface HomeRowCardProps {
  row: UserHomeRow
  anchors: HomeRowOption[]
  modes: string[]
  maxPosition: number
  busy: boolean
  onToggle: (enabled: boolean) => void
  onPlacementSaved: (outcome: InstantOutcome | null, error?: string) => void
}

/**
 * One kind of row Aperture can add to this viewer's Emby home screen: what it
 * is, whether it reaches them (and who decided if not), what is in it, and where
 * it goes. The switch is theirs; everything above it is decided by the server.
 */
export function HomeRowCard({ row, anchors, modes, maxPosition, busy, onToggle, onPlacementSaved }: HomeRowCardProps) {
  const { t } = useTranslation()
  const [placementOpen, setPlacementOpen] = useState(false)
  const status = rowStatus(row.state, row.contents, row.onScreen)
  const unavailable = row.state.status === 'unavailable'
  const title = t(`homeScreenPlacement.features.${row.feature}`)
  const placement = row.override ?? row.defaultPlacement

  const toggle = (
    <Switch
      checked={row.state.status === 'on'}
      disabled={unavailable || busy}
      onChange={(e) => onToggle(e.target.checked)}
      slotProps={{ input: { 'aria-label': t('userSettings.homeScreen.toggleRow', { row: title }) } }}
    />
  )

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, opacity: unavailable ? 0.75 : 1 }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <FeatureIcon feature={row.feature} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={600} component="h3">
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t(`userSettings.homeScreen.describe.${row.feature}`)}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', flex: '0 0 auto' }}>
            {busy && <CircularProgress size={18} sx={{ mr: 1 }} />}
            {unavailable ? (
              <Tooltip title={t('userSettings.homeScreen.switchLocked')}>
                <span>{toggle}</span>
              </Tooltip>
            ) : (
              toggle
            )}
          </Box>
        </Box>

        <Typography variant="body2" sx={{ mt: 1.5, color: statusColor(status) }}>
          <StatusText status={status} feature={row.feature} name={row.name ?? title} />
        </Typography>

        {row.contents && row.contents.sample.length > 0 && row.contents.count != null && (
          <Box sx={{ mt: 1.5 }}>
            <RowPosterStrip
              sample={row.contents.sample}
              count={row.contents.count}
              dimmed={row.state.status !== 'on'}
            />
          </Box>
        )}

        {!unavailable && (
          <Box sx={{ mt: 1.5 }}>
            <Button
              size="small"
              startIcon={<TuneIcon />}
              onClick={() => setPlacementOpen((open) => !open)}
              aria-expanded={placementOpen}
              sx={{ textTransform: 'none' }}
            >
              {t(row.override ? 'userSettings.homeScreen.placementOwn' : 'userSettings.homeScreen.placementDefault', {
                placement: describePlacement(t, placement),
              })}
            </Button>
            <Collapse in={placementOpen} unmountOnExit>
              <Box sx={{ pt: 1.5 }}>
                <PlacementEditor
                  feature={row.feature}
                  defaultPlacement={row.defaultPlacement}
                  override={row.override}
                  anchors={anchors}
                  modes={modes}
                  maxPosition={maxPosition}
                  onSaved={onPlacementSaved}
                />
              </Box>
            </Collapse>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}

/** The sentence under a row's title. `feature` picks the empty-row wording, which differs per kind. */
export function StatusText({ status, feature, name }: { status: RowStatus; feature: string; name: string }) {
  const { t } = useTranslation()
  switch (status.kind) {
    case 'unavailable':
      return <>{t(`userSettings.homeScreen.unavailable.${status.reason}`)}</>
    case 'off':
      return <>{t('userSettings.homeScreen.status.off')}</>
    case 'unknown':
      return (
        <>
          {t(status.onScreen ? 'userSettings.homeScreen.status.unknownShowing' : 'userSettings.homeScreen.status.unknown', {
            name,
          })}
        </>
      )
    case 'empty':
      return <>{t(`userSettings.homeScreen.empty.${feature}`)}</>
    case 'showing':
      return <>{t('userSettings.homeScreen.status.showing', { name, count: status.count })}</>
    case 'arriving':
      return <>{t('userSettings.homeScreen.status.arriving', { name, count: status.count })}</>
  }
}
