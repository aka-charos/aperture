import type { ReactElement } from 'react'
import { Box, Chip, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'

/** One figure on a tab's snapshot card. */
export function SnapshotStat({ value, label, detail }: { value: string; label: string; detail?: string }) {
  return (
    <Box sx={{ px: 1.5, py: 1.25, borderRadius: 1.5, bgcolor: 'action.hover', minWidth: 0 }}>
      <Typography variant="h5" fontWeight={700} lineHeight={1.2}>
        {value}
      </Typography>
      <Typography variant="body2">{label}</Typography>
      {detail && (
        <Typography variant="caption" color="text.secondary" display="block" noWrap>
          {detail}
        </Typography>
      )}
    </Box>
  )
}

/** A film's or season's standing, on its poster. */
export function PosterStatusChip({ icon, label, color }: { icon: ReactElement; label: string; color: string }) {
  return (
    <Chip
      icon={icon}
      label={label}
      size="small"
      sx={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        zIndex: 3,
        fontWeight: 600,
        fontSize: '0.7rem',
        height: 24,
        bgcolor: alpha(color, 0.9),
        color: 'common.white',
        '& .MuiChip-icon': { color: 'common.white' },
      }}
    />
  )
}
