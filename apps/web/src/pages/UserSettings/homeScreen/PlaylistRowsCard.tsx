import { useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import TuneIcon from '@mui/icons-material/Tune'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { describePlacement, type HomeRowOption } from '@/components/homeSections/placement'
import { FeatureIcon, StatusText } from './HomeRowCard'
import { PlacementEditor } from './PlacementEditor'
import { RowPosterStrip } from './RowPosterStrip'
import { playlistKey, rowStatus, statusColor } from './rowStatus'
import type { InstantOutcome, UserHomePlaylist, UserHomeRow } from './types'

interface PlaylistRowsCardProps {
  /** The playlists row kind: its state and its one placement, shared by every playlist row. */
  row: UserHomeRow
  playlists: UserHomePlaylist[]
  anchors: HomeRowOption[]
  modes: string[]
  maxPosition: number
  busyKey: string | null
  onToggle: (playlist: UserHomePlaylist, enabled: boolean) => void
  onPlacementSaved: (outcome: InstantOutcome | null, error?: string) => void
}

/**
 * The viewer's own playlists and collections, each of which can be its own row.
 * Unlike the other kinds there is no switch for the kind as a whole: putting a
 * playlist on the home screen IS the switch, one playlist at a time, the same
 * toggle the Playlists page offers.
 */
export function PlaylistRowsCard({
  row,
  playlists,
  anchors,
  modes,
  maxPosition,
  busyKey,
  onToggle,
  onPlacementSaved,
}: PlaylistRowsCardProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [placementOpen, setPlacementOpen] = useState(false)
  const unavailable = row.state.status === 'unavailable'
  const placement = row.override ?? row.defaultPlacement

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, opacity: unavailable ? 0.75 : 1 }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <FeatureIcon feature="playlists" />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={600} component="h3">
              {t('homeScreenPlacement.features.playlists')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('userSettings.homeScreen.describe.playlists')}
            </Typography>
          </Box>
        </Box>

        {row.state.status === 'unavailable' && (
          <Typography variant="body2" sx={{ mt: 1.5, color: 'text.disabled' }}>
            {t(`userSettings.homeScreen.unavailable.${row.state.reason}`)}
          </Typography>
        )}

        {!unavailable && playlists.length === 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="body2" color="text.secondary">
              {t('userSettings.homeScreen.noPlaylists')}
            </Typography>
            <Button size="small" sx={{ mt: 1 }} onClick={() => navigate('/playlists')}>
              {t('userSettings.homeScreen.openPlaylists')}
            </Button>
          </Box>
        )}

        {!unavailable && playlists.length > 0 && (
          <Stack divider={<Divider flexItem />} sx={{ mt: 1.5 }}>
            {playlists.map((playlist) => {
              const key = playlistKey(playlist)
              const busy = busyKey === key
              const status = playlist.onHomeScreen
                ? rowStatus(row.state, playlist.contents, playlist.onScreen)
                : { kind: 'off' as const }
              return (
                <Box key={key} sx={{ py: 1.25 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="body2" fontWeight={500} noWrap sx={{ minWidth: 0 }}>
                          {playlist.name}
                        </Typography>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={t(`userSettings.homeScreen.playlistKind.${playlist.source === 'chat' ? 'chat' : playlist.outputType}`)}
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      </Box>
                      <Typography variant="caption" component="p" sx={{ color: statusColor(status), mt: 0.25 }}>
                        {!playlist.generated ? (
                          t('userSettings.homeScreen.playlistNotGenerated')
                        ) : playlist.onHomeScreen ? (
                          <StatusText status={status} feature="playlists" name={playlist.name} />
                        ) : (
                          playlist.contents?.count != null
                            ? t('userSettings.homeScreen.playlistOff', { count: playlist.contents.count })
                            : t('userSettings.homeScreen.playlistOffUnknown')
                        )}
                      </Typography>
                    </Box>
                    {busy && <CircularProgress size={18} />}
                    <Switch
                      checked={playlist.onHomeScreen}
                      disabled={busy || (!playlist.generated && !playlist.onHomeScreen)}
                      onChange={(e) => onToggle(playlist, e.target.checked)}
                      slotProps={{ input: { 'aria-label': t('userSettings.homeScreen.toggleRow', { row: playlist.name }) } }}
                    />
                  </Box>
                  {playlist.contents && playlist.contents.count != null && playlist.contents.sample.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                      <RowPosterStrip
                        sample={playlist.contents.sample}
                        count={playlist.contents.count}
                        dimmed={!playlist.onHomeScreen}
                      />
                    </Box>
                  )}
                </Box>
              )
            })}
          </Stack>
        )}

        {!unavailable && playlists.some((playlist) => playlist.onHomeScreen) && (
          <Box sx={{ mt: 1 }}>
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
                  feature="playlists"
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
