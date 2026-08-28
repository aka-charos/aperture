import { Box, Typography, CircularProgress } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { DiscoveryGenreStripsSettings } from '@/pages/settings/components'
import { useAdminGate } from '../nav/gates'
import { ADMIN_ENTRIES } from '../nav/registry'

/**
 * Genre strips are built from TMDB genre ids, so the section is meaningless
 * without TMDB configured.
 *
 * The gate is read off the registry entry rather than named again here. A
 * literal would work and would also be a second place the precondition is
 * written down — which is how the nav column, the search index and the route
 * end up disagreeing about whether a section is reachable.
 */
const GATE = ADMIN_ENTRIES.find((entry) => entry.id === 'genre-strips')?.gate

export default function GenreStripsRoute() {
  const { t } = useTranslation()
  const { ready, passed } = useAdminGate(GATE)

  if (!ready) {
    return (
      <Box sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!passed) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }}>
        {t('settingsPage.genreDiscoveryRequiresTmdb')}
      </Typography>
    )
  }

  return <DiscoveryGenreStripsSettings />
}
