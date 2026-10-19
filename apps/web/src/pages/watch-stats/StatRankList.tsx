import type { ReactNode } from 'react'
import { Avatar, Box, Chip, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { getProxiedImageUrl } from '@aperture/ui'
import { StudioLogo } from '../../components/StudioLogo'

export interface RankedEntry {
  name: string
  thumb: string | null
  /** Set on studio and network rows: how their logo is drawn (components/StudioLogo). */
  thumbKind?: 'tile' | 'mark' | null
  count: number
}

interface StatRankListProps {
  entries: RankedEntry[]
  /** Bar and chip colour. A CSS colour, since several of these are off-palette. */
  color: string
  /** Circular for people, rounded for logos. */
  shape?: 'circular' | 'rounded'
  /** Renders the count chip, e.g. "7 films". */
  formatCount: (count: number) => string
  onSelect: (entry: RankedEntry) => void
  empty: ReactNode
}

/**
 * The picture beside a ranked name: a person's photo in a circle, or a studio
 * or network logo in a 16:9 slot, the shape of a media-server tile, so a wide
 * logo is never cropped into a square. Initials when there is no picture.
 */
function EntryImage({
  entry,
  shape,
  color,
}: {
  entry: RankedEntry
  shape: 'circular' | 'rounded'
  color: string
}) {
  const avatar = (
    <Avatar
      src={shape === 'rounded' ? undefined : getProxiedImageUrl(entry.thumb)}
      alt={entry.name}
      variant={shape}
      sx={{
        width: 36,
        height: 36,
        bgcolor: alpha(color, 0.25),
        // The tint is translucent, so the letter reads against the card
        // beneath it rather than against an opaque swatch.
        color,
        fontSize: '0.75rem',
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {shape === 'rounded' ? entry.name.substring(0, 2).toUpperCase() : entry.name.charAt(0)}
    </Avatar>
  )
  if (shape !== 'rounded') return avatar

  return (
    <Box sx={{ width: 64, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <StudioLogo
        logo={entry.thumb && entry.thumbKind ? { url: entry.thumb, kind: entry.thumbKind } : null}
        name={entry.name}
        height={28}
        maxWidth={50}
        fallback={avatar}
      />
    </Box>
  )
}

/**
 * One ranked list — actors, directors, studios, networks.
 *
 * The four of these were four copies of the same hundred lines differing only
 * in colour and label, which is how the drill-in ended up wired to two of them
 * and not the other two. Bars are scaled against the leader, so the top row is
 * always full width and the list reads as a ranking rather than as a set of
 * absolute quantities.
 */
export function StatRankList({
  entries,
  color,
  shape = 'circular',
  formatCount,
  onSelect,
  empty,
}: StatRankListProps) {
  if (entries.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {empty}
      </Typography>
    )
  }

  const leader = entries[0].count || 1

  return (
    <Box display="flex" flexDirection="column">
      {entries.map((entry, index) => (
        <Box
          key={entry.name}
          onClick={() => onSelect(entry)}
          role="button"
          tabIndex={0}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect(entry)
            }
          }}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            cursor: 'pointer',
            borderRadius: 1.5,
            px: 1,
            py: 0.75,
            mx: -1,
            transition: 'background-color 0.15s',
            '&:hover': { bgcolor: alpha(color, 0.12) },
            '&:hover .stat-rank-chevron': { opacity: 1 },
            '&:focus-visible': {
              outline: `2px solid ${color}`,
              outlineOffset: -2,
            },
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ width: 16, textAlign: 'end', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
          >
            {index + 1}
          </Typography>
          <EntryImage entry={entry} shape={shape} color={color} />
          <Box flex={1} minWidth={0}>
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={1} mb={0.5}>
              <Typography variant="body2" fontWeight={500} noWrap sx={{ flex: 1 }}>
                {entry.name}
              </Typography>
              <Chip
                label={formatCount(entry.count)}
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  backgroundColor: alpha(color, 0.2),
                  flexShrink: 0,
                }}
              />
            </Box>
            <Box
              sx={{
                height: 4,
                borderRadius: 2,
                backgroundColor: alpha(color, 0.15),
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  height: '100%',
                  width: `${(entry.count / leader) * 100}%`,
                  backgroundColor: color,
                  borderRadius: 2,
                }}
              />
            </Box>
          </Box>
          <ChevronRightIcon
            className="stat-rank-chevron"
            fontSize="small"
            sx={{ color: 'text.secondary', opacity: 0, transition: 'opacity 0.15s', flexShrink: 0 }}
          />
        </Box>
      ))}
    </Box>
  )
}
