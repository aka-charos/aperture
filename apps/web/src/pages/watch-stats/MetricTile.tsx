import type { ReactNode } from 'react'
import { Box, Card, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'

interface MetricTileProps {
  value: ReactNode
  label: string
  icon: ReactNode
  color: string
  /** Omit to render an inert tile — the cursor and hover then stay put. */
  onClick?: () => void
}

/**
 * One headline number.
 *
 * The tiles were six full-bleed gradient cards, each a different hue, which
 * gave six numbers of unequal importance the same shout and left no room for
 * anything to be emphasised. A tint carries the same colour coding at a volume
 * the charts below can be read against.
 */
export function MetricTile({ value, label, icon, color, onClick }: MetricTileProps) {
  const interactive = Boolean(onClick)

  return (
    <Card
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      sx={{
        height: '100%',
        borderRadius: 2.5,
        px: 2,
        py: 1.75,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        border: '1px solid',
        borderColor: alpha(color, 0.25),
        backgroundImage: `linear-gradient(135deg, ${alpha(color, 0.14)} 0%, ${alpha(color, 0.04)} 100%)`,
        cursor: interactive ? 'pointer' : 'default',
        transition: 'border-color 0.15s, transform 0.15s',
        ...(interactive && {
          '&:hover': { borderColor: alpha(color, 0.6), transform: 'translateY(-2px)' },
          '&:focus-visible': { outline: `2px solid ${color}`, outlineOffset: 2 },
        }),
      }}
    >
      <Box
        sx={{
          width: 38,
          height: 38,
          borderRadius: 2,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: alpha(color, 0.2),
          color,
        }}
      >
        {icon}
      </Box>
      <Box minWidth={0}>
        <Typography variant="h6" fontWeight={700} noWrap lineHeight={1.2}>
          {value}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap display="block">
          {label}
        </Typography>
      </Box>
    </Card>
  )
}
