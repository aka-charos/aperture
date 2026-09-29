import type { ReactNode } from 'react'
import { Avatar, Box, Card, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'

interface PersonSectionProps {
  person: { name: string; avatarUrl: string }
  heading: string
  subheading?: string
  /** The end of the header row — the Sent tab's status counts. */
  aside?: ReactNode
  children: ReactNode
}

/**
 * One person's titles as a card: who, a line about what, then the grid. A card
 * rather than a bare heading, so two people's grids read as two groups at a
 * glance instead of one long run of posters.
 */
export function PersonSection({ person, heading, subheading, aside, children }: PersonSectionProps) {
  return (
    <Card component="section" sx={{ borderRadius: 2.5, p: { xs: 2, sm: 2.5 }, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 2.5 }}>
        <Avatar
          src={person.avatarUrl}
          alt=""
          sx={{
            width: 44,
            height: 44,
            border: '2px solid',
            borderColor: (theme) => alpha(theme.palette.primary.main, 0.5),
          }}
        >
          {person.name.charAt(0).toUpperCase()}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: '1 1 180px' }}>
          <Typography variant="h6" component="h2" noWrap lineHeight={1.3}>
            {heading}
          </Typography>
          {subheading && (
            <Typography variant="body2" color="text.secondary">
              {subheading}
            </Typography>
          )}
        </Box>
        {aside && <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{aside}</Box>}
      </Box>
      {children}
    </Card>
  )
}
