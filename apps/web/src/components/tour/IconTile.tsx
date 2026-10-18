import type { ReactNode } from 'react'
import { alpha, Box, useTheme } from '@mui/material'

/**
 * The rounded square an icon sits in, shared by every onboarding surface (a
 * tour step, a checklist item, the first-visit tip, the tour offer), so their
 * size and tints are decided once.
 *
 * `tint`: a soft fill in that colour; `solid`: the primary colour itself, for
 * the one thing to do next.
 */
export type IconTileTone = 'primary' | 'success' | 'warning' | 'neutral' | 'solid'

export const ICON_TILE_SIZE = 40

export function IconTile({ tone = 'primary', children }: { tone?: IconTileTone; children: ReactNode }) {
  const theme = useTheme()
  const fill = {
    primary: alpha(theme.palette.primary.main, 0.16),
    success: alpha(theme.palette.success.main, 0.14),
    warning: alpha(theme.palette.warning.main, 0.14),
    neutral: alpha(theme.palette.text.primary, 0.08),
    solid: theme.palette.primary.main,
  }[tone]
  const color = {
    primary: theme.palette.primary.light,
    success: theme.palette.success.light,
    warning: theme.palette.warning.light,
    neutral: theme.palette.text.primary,
    solid: theme.palette.primary.contrastText,
  }[tone]
  return (
    <Box
      sx={{
        width: ICON_TILE_SIZE,
        height: ICON_TILE_SIZE,
        borderRadius: 3,
        flex: '0 0 auto',
        display: 'grid',
        placeItems: 'center',
        bgcolor: fill,
        color,
        '& svg': { fontSize: 21 },
      }}
    >
      {children}
    </Box>
  )
}

/** The small uppercase label: "Next up", "New". */
export function Badge({ children }: { children: ReactNode }) {
  const theme = useTheme()
  return (
    <Box
      component="span"
      sx={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'primary.light',
        bgcolor: alpha(theme.palette.primary.main, 0.2),
        px: 0.9,
        py: '2px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  )
}
