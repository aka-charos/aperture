import React from 'react'
import { Box, Tooltip, alpha, useTheme } from '@mui/material'
import Check from '@mui/icons-material/Check'
import { usePosterDisplaySettings } from '../posterDisplaySettings.js'

const CheckIcon = Check as unknown as React.ComponentType<{ sx?: object }>

export interface WatchedBadgeProps {
  /**
   * Tooltip and aria-label. Defaults to the one on PosterDisplaySettings, so a
   * caller inside the app gets the translated word without passing anything.
   */
  label?: string
  /** Diameter in px. 22 suits a full poster; 18 suits a list-row thumbnail. */
  size?: number
  /** Positioning override. Defaults to the top corner nearest the reading edge. */
  sx?: object
}

/**
 * The tick a watched title wears — Emby's, in Aperture's colours.
 *
 * One component rather than the overlay written out at each call site: it
 * appears on the poster grid, on both list views, and on chat cards, and four
 * hand-rolled circles is how three of them end up a different green.
 *
 * Logical inset so it lands in the mirrored corner under ar/he.
 */
export function WatchedBadge({ label, size = 22, sx = {} }: WatchedBadgeProps) {
  const theme = useTheme()
  const { watchedLabel } = usePosterDisplaySettings()
  const text = label ?? watchedLabel

  return (
    <Tooltip title={text} arrow>
      <Box
        aria-label={text}
        sx={{
          position: 'absolute',
          top: 8,
          insetInlineEnd: 8,
          zIndex: 3,
          width: size,
          height: size,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: alpha(theme.palette.success.main, 0.92),
          color: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
          ...sx,
        }}
      >
        <CheckIcon sx={{ fontSize: Math.round(size * 0.72) }} />
      </Box>
    </Tooltip>
  )
}
