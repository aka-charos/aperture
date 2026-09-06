import React from 'react'
import { Box, Tooltip, alpha, useTheme } from '@mui/material'
import { usePosterDisplaySettings } from '../posterDisplaySettings.js'

export interface EpisodeProgressBadgeProps {
  /** Episodes played. */
  watched: number
  /** Episodes the library holds, specials excluded. */
  total: number
  /** Tooltip and aria-label. Defaults to the formatter on PosterDisplaySettings. */
  label?: string
  /** Positioning override. Shares the slot the watched tick would occupy. */
  sx?: object
}

/**
 * How far into a series the viewer is: `8/24`, watched in green against a muted
 * total.
 *
 * Emby badges the *remaining* count, which cannot tell 8 episodes left of 8
 * from 8 left of 200 — the number that made someone ask what it meant. A
 * fraction states a position instead, and it is legible without knowing how
 * long the show is.
 *
 * Never rendered complete: at 24/24 the caller draws WatchedBadge instead, and
 * the two share one slot. Numbers stay LTR under ar/he — a fraction is a
 * numeral, and mirroring it would read as 24/8.
 */
export function EpisodeProgressBadge({
  watched,
  total,
  label,
  sx = {},
}: EpisodeProgressBadgeProps) {
  const theme = useTheme()
  const { episodeProgressLabel } = usePosterDisplaySettings()
  const text = label ?? episodeProgressLabel(watched, total)

  return (
    <Tooltip title={text} arrow>
      <Box
        aria-label={text}
        sx={{
          position: 'absolute',
          top: 8,
          insetInlineEnd: 8,
          zIndex: 3,
          height: 22,
          px: 0.75,
          borderRadius: 11,
          display: 'flex',
          alignItems: 'center',
          direction: 'ltr',
          fontSize: '0.7rem',
          fontWeight: 700,
          lineHeight: 1,
          bgcolor: alpha('#000', 0.75),
          backdropFilter: 'blur(4px)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
          ...sx,
        }}
      >
        <Box component="span" sx={{ color: theme.palette.success.main }}>
          {watched}
        </Box>
        <Box component="span" sx={{ color: 'rgba(255,255,255,0.6)' }}>
          /{total}
        </Box>
      </Box>
    </Tooltip>
  )
}
