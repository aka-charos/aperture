import { Box } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { MediaCarousel } from './MediaCarousel'
import type { ConnectionRecentWatches as ConnectionRecentWatchesData } from '../hooks/useConnectionsRecentWatches'

interface ConnectionsRecentWatchesProps {
  users: ConnectionRecentWatchesData[]
  loading: boolean
}

/**
 * One "Recently watched by …" slider per connection, below the viewer's own
 * rows. The ticks, stars and episode pills on these posters are the VIEWER's
 * own (MediaCarousel reads them from the viewer's providers), which is what
 * makes the row useful: "they watched this, and I haven't".
 *
 * A connection with nothing recent gets no slider at all, the same rule the
 * page uses for the upcoming-episodes row.
 */
export function ConnectionsRecentWatches({ users, loading }: ConnectionsRecentWatchesProps) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <Box sx={{ mb: 4 }}>
        <MediaCarousel title="" items={[]} loading />
      </Box>
    )
  }

  return (
    <>
      {users
        .filter((entry) => entry.items.length > 0)
        .map((entry) => (
          <Box key={entry.user.id} sx={{ mb: 4 }}>
            <MediaCarousel
              title={t('dashboard.recentlyWatchedBy', { name: entry.user.name })}
              subtitle={t('dashboard.subtitleFromConnections')}
              items={entry.items}
              // The only dashboard row mixing movies and series.
              showMediaType
            />
          </Box>
        ))}
    </>
  )
}
