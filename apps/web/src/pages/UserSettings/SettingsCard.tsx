import type { ReactElement, ReactNode } from 'react'
import { Box, Card, CardContent, Typography } from '@mui/material'

/**
 * The square icon at the head of every settings card. Same size, colour and
 * shape as the Emby home screen tab's row cards, so the four tabs read as one
 * page rather than four that were written at different times.
 */
export function SettingsCardIcon({ children }: { children: ReactNode }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: 40,
        height: 40,
        flex: '0 0 auto',
        borderRadius: 1.5,
        display: 'grid',
        placeItems: 'center',
        color: 'primary.main',
        backgroundColor: 'action.hover',
      }}
    >
      {children}
    </Box>
  )
}

interface SettingsCardProps {
  icon: ReactElement
  title: ReactNode
  description?: ReactNode
  /** Right of the title: the card's one main control (a switch, a toggle, a button). */
  action?: ReactNode
  children?: ReactNode
  /** A closing caption, for when a change takes effect or what it does not cover. */
  footer?: ReactNode
  id?: string
  /** What a tour step names to point at this card (components/tour/tours.ts). */
  tourAnchor?: string
}

/**
 * One setting, one card: what it is and what it does on top, the control that
 * decides it on the right, and anything it needs below. Every card on every
 * settings tab has this shape; a card that needs more room says so in its
 * children, not by inventing a second header.
 */
export function SettingsCard({ icon, title, description, action, children, footer, id, tourAnchor }: SettingsCardProps) {
  return (
    <Card id={id} data-tour={tourAnchor} variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <SettingsCardIcon>{icon}</SettingsCardIcon>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={600} component="h3">
              {title}
            </Typography>
            {description && (
              <Typography variant="body2" color="text.secondary">
                {description}
              </Typography>
            )}
          </Box>
          {action && <Box sx={{ display: 'flex', alignItems: 'center', flex: '0 0 auto' }}>{action}</Box>}
        </Box>
        {children && <Box sx={{ mt: 2 }}>{children}</Box>}
        {footer && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2 }}>
            {footer}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}

interface SettingRowProps {
  label: ReactNode
  /** What turning it ON does. Written once, never swapped with the state: a label that changes with the switch reads as either answer. */
  description?: ReactNode
  control: ReactNode
}

/** One of several switches inside a card: what it does on the left, the switch on the right. */
export function SettingRow({ label, description, control }: SettingRowProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1, borderTop: 1, borderColor: 'divider' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={500}>
          {label}
        </Typography>
        {description && (
          <Typography variant="caption" color="text.secondary" component="p">
            {description}
          </Typography>
        )}
      </Box>
      <Box sx={{ flex: '0 0 auto' }}>{control}</Box>
    </Box>
  )
}

interface SettingsSectionProps {
  title: ReactNode
  description?: ReactNode
  /** Right of the heading: an action that belongs to the whole section. */
  action?: ReactNode
  children: ReactNode
}

/** A titled group of cards on a settings tab. */
export function SettingsSection({ title, description, action, children }: SettingsSectionProps) {
  return (
    <Box component="section">
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" fontWeight={600} component="h2">
            {title}
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          )}
        </Box>
        {action}
      </Box>
      {children}
    </Box>
  )
}

interface SettingsGridProps {
  children: ReactNode
  /** The most cards side by side. Fewer when the pane is narrower than that many minimum widths. */
  columns?: number
  /**
   * Cards in a row share its height. Off where a card can open to show more
   * (a weight list, a review list): stretching would pad its neighbour with
   * empty space for as long as it is open.
   */
  stretch?: boolean
}

/**
 * Cards side by side, sized off the pane rather than the window: with the
 * assistant docked the pane is half the window, and a window breakpoint would
 * keep two columns in a space with room for one.
 *
 * A child that renders null takes no cell, so a card that is not offered to
 * this viewer leaves no hole and needs no gating by its parent.
 */
export function SettingsGrid({ children, columns = 2, stretch = false }: SettingsGridProps) {
  const gap = 16
  return (
    <Box
      sx={{
        display: 'grid',
        gap: `${gap}px`,
        alignItems: stretch ? 'stretch' : 'start',
        // A card fills its cell when the row stretches; otherwise it keeps its
        // own height (a percentage height would resolve against the row anyway).
        '& > *': stretch ? undefined : { height: 'auto' },
        // At most `columns` across, none narrower than 380px, one column below that.
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, max(380px, calc((100% - ${(columns - 1) * gap}px) / ${columns}))), 1fr))`,
      }}
    >
      {children}
    </Box>
  )
}

/**
 * Two independent columns of cards, one column when the pane is too narrow for
 * two. For cards of very different heights — a one-line input beside a long
 * list — where a grid row would either stretch the short card into an empty
 * box or leave a hole under it. In one column the left column's cards come
 * first, so put them in reading order.
 */
export function SettingsColumns({ left, right }: { left: ReactNode; right: ReactNode }) {
  const column = { flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, '& > *': { height: 'auto' } } as const
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }}>
      <Box sx={column}>{left}</Box>
      <Box sx={column}>{right}</Box>
    </Box>
  )
}
