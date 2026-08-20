import { Box, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { CONNECTION_COLORS, type ConnectionType } from './types'
import { connectionTypeLabel } from '../../i18n/connectionTypeLabel'

// Standalone legend component for simpler use cases
export function GraphLegend({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const connectionTypes: ConnectionType[] = [
    'director',
    'actor',
    'collection',
    'genre',
    'keyword',
    'studio',
    'network',
    'similarity',
  ]

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: compact ? 1 : 1.5,
        p: 1,
      }}
    >
      {connectionTypes.map((type) => (
        <Box
          key={type}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
          }}
        >
          <Box
            sx={{
              width: 12,
              height: 3,
              bgcolor: CONNECTION_COLORS[type],
              borderRadius: 1,
            }}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: compact ? '9px' : '10px' }}
          >
            {connectionTypeLabel(type, t)}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}
