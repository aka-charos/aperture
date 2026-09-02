import type { ReactNode } from 'react'
import { Box, Card, CardContent, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'

interface StatCardProps {
  title: string
  subtitle?: string
  icon: ReactNode
  /** Tint for the icon chip. A CSS colour — several sections are off-palette. */
  color: string
  /** Right-aligned slot in the header row, e.g. a toggle. */
  action?: ReactNode
  children: ReactNode
}

/**
 * The shell every stats section shares: tinted icon, title, optional caption.
 *
 * It exists so the sections stop each inventing their own header spacing —
 * the page previously ran three different header shapes down one column, which
 * is what made it read as unfinished rather than as one instrument panel.
 */
export function StatCard({ title, subtitle, icon, color, action, children }: StatCardProps) {
  return (
    <Card sx={{ borderRadius: 2.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent
        sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 2.5, '&:last-child': { pb: 2.5 } }}
      >
        <Box display="flex" alignItems="center" gap={1.5} mb={subtitle ? 0.25 : 2}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: 1.5,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: alpha(color, 0.15),
              color,
            }}
          >
            {icon}
          </Box>
          <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1, minWidth: 0 }} noWrap>
            {title}
          </Typography>
          {action}
        </Box>
        {subtitle && (
          <Typography variant="caption" color="text.secondary" display="block" mb={2}>
            {subtitle}
          </Typography>
        )}
        <Box flex={1} minWidth={0}>
          {children}
        </Box>
      </CardContent>
    </Card>
  )
}
