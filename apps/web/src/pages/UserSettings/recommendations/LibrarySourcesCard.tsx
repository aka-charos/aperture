import { Box, Switch, Typography } from '@mui/material'
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import { useTranslation } from 'react-i18next'
import { SettingsCard } from '../SettingsCard'
import type { AccessibleLibrary } from './useTasteData'

interface LibrarySourcesCardProps {
  libraries: AccessibleLibrary[] | null
  savingLibrary: string | null
  onToggle: (library: AccessibleLibrary) => void
}

const GROUPS = [
  { collectionType: 'movies', labelKey: 'userSettings.identitySubtabMovies', icon: <MovieIcon fontSize="small" color="action" /> },
  { collectionType: 'tvshows', labelKey: 'userSettings.identitySubtabSeries', icon: <TvIcon fontSize="small" color="action" /> },
] as const

/**
 * Which libraries' viewing counts. One list per viewer (the exclusions live in
 * `user_preferences.settings`), so both kinds of library are on one card,
 * grouped, instead of half of the list under each media sub-tab.
 */
export function LibrarySourcesCard({ libraries, savingLibrary, onToggle }: LibrarySourcesCardProps) {
  const { t } = useTranslation()
  const groups = GROUPS.map((group) => ({
    ...group,
    items: (libraries ?? []).filter((lib) => lib.collectionType === group.collectionType),
  })).filter((group) => group.items.length > 0)

  return (
    <SettingsCard
      icon={<VideoLibraryIcon />}
      title={t('userSettings.recs.librariesTitle')}
      description={t('userSettings.recs.librariesBody')}
      footer={t('watcherIdentity.aiPicksExcludedCaption')}
    >
      {libraries === null ? (
        <Typography variant="body2" color="text.secondary">
          {t('userSettings.recs.librariesUnavailable')}
        </Typography>
      ) : groups.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('userSettings.recs.librariesNone')}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {groups.map((group) => (
            <Box key={group.collectionType}>
              <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 2 }}>
                {t(group.labelKey)}
              </Typography>
              {group.items.map((library) => (
                <Box
                  key={library.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    py: 0.25,
                    borderTop: 1,
                    borderColor: 'divider',
                  }}
                >
                  {group.icon}
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{ flex: 1, minWidth: 0, color: library.isExcluded ? 'text.disabled' : 'text.primary' }}
                  >
                    {library.name}
                  </Typography>
                  <Switch
                    size="small"
                    checked={!library.isExcluded}
                    disabled={savingLibrary === library.id}
                    onChange={() => onToggle(library)}
                    slotProps={{ input: { 'aria-label': library.name } }}
                  />
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      )}
    </SettingsCard>
  )
}
