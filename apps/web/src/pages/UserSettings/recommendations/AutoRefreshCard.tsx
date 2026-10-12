import { Box, FormControl, MenuItem, Select, Switch, Typography } from '@mui/material'
import UpdateIcon from '@mui/icons-material/Update'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import { useTranslation } from 'react-i18next'
import { SettingsCard } from '../SettingsCard'
import { formatScanDate } from './scanDate'
import type { MediaType, TasteProfileSettings } from './useTasteData'

const REFRESH_INTERVAL_VALUES = [7, 14, 30, 60, 90, 180, 365] as const

type RefreshPatch = Partial<Pick<TasteProfileSettings, 'isLocked' | 'refreshIntervalDays'>>

interface AutoRefreshCardProps {
  mediaTypes: MediaType[]
  profiles: Record<MediaType, TasteProfileSettings | null>
  onSave: (type: MediaType, patch: RefreshPatch) => void
}

/**
 * How often each taste profile is rebuilt from watch history, or never (a
 * locked profile). Stored per media type, so it is one row per type rather
 * than a page-wide Movies/TV switch.
 */
export function AutoRefreshCard({ mediaTypes, profiles, onSave }: AutoRefreshCardProps) {
  const { t, i18n } = useTranslation()
  return (
    <SettingsCard
      icon={<UpdateIcon />}
      title={t('userSettings.recs.autoRefreshTitle')}
      description={t('userSettings.recs.autoRefreshBody')}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        {mediaTypes.map((type) => {
          const profile = profiles[type]
          const label = type === 'movie' ? t('userSettings.identitySubtabMovies') : t('userSettings.identitySubtabSeries')
          return (
            <Box
              key={type}
              sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, py: 1, borderTop: 1, borderColor: 'divider' }}
            >
              {type === 'movie' ? <MovieIcon fontSize="small" color="action" /> : <TvIcon fontSize="small" color="action" />}
              <Box sx={{ flex: '1 1 140px', minWidth: 0 }}>
                <Typography variant="body2" fontWeight={500}>
                  {label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {!profile
                    ? t('userSettings.recs.notScannedYet')
                    : profile.isLocked
                      ? t('watcherIdentity.lockCaptionLocked')
                      : profile.autoUpdatedAt
                        ? t('watcherIdentity.analyzedOn', { date: formatScanDate(profile.autoUpdatedAt, i18n.language) })
                        : t('watcherIdentity.lockCaptionUnlocked')}
                </Typography>
              </Box>
              <FormControl size="small" sx={{ minWidth: 120 }} disabled={!profile || profile.isLocked}>
                <Select
                  value={profile?.refreshIntervalDays ?? 30}
                  onChange={(e) => onSave(type, { refreshIntervalDays: Number(e.target.value) })}
                  inputProps={{ 'aria-label': t('userSettings.recs.refreshEvery', { type: label }) }}
                >
                  {REFRESH_INTERVAL_VALUES.map((value) => (
                    <MenuItem key={value} value={value}>
                      {t(`watcherIdentity.refreshInterval.${value}`)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Switch
                checked={profile ? !profile.isLocked : false}
                disabled={!profile}
                onChange={(e) => onSave(type, { isLocked: !e.target.checked })}
                slotProps={{ input: { 'aria-label': t('userSettings.recs.autoRefreshFor', { type: label }) } }}
              />
            </Box>
          )
        })}
      </Box>
    </SettingsCard>
  )
}
