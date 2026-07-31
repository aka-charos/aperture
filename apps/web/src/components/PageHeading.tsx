import { Box, Typography, type SxProps, type Theme } from '@mui/material'
import type { ReactNode } from 'react'
import { usePageHeader, usePageHeaderValue } from '@/hooks/usePageHeader'

/**
 * Below this the app bar has no room to spare, so the heading renders in place.
 *
 * At md+ the bar's whole left half is empty — the hamburger and the wordmark are
 * mobile-only, and the jobs widget, search and avatar are all pinned right — so
 * the title goes there and the page keeps the ~80px it used to spend on the same
 * words. Under md that space is taken, and a title with nowhere to go is worse
 * than a title costing a couple of rows.
 */
const BAR_HAS_ROOM = 'md' as const

interface PageHeadingProps {
  title: string
  /** One line of orientation under the title. */
  description?: string
  /**
   * Decoration beside the title on the in-page block only.
   *
   * Deliberately not published to the bar: the header lives in state, and an
   * element prop is a new object on every render, so re-publishing it would
   * re-render the page, which would rebuild the element, which would re-publish.
   * The bar identifies the page by its words; the sidebar already marks it with
   * this same icon.
   */
  icon?: ReactNode
  /** Overrides the block's own bottom margin, for pages that space their own rows. */
  sx?: SxProps<Theme>
}

/**
 * A page's title and description.
 *
 * Publishes to the app bar and renders nothing at md+; renders the familiar
 * block below that. Pages keep their own action rows either way — only the
 * words move.
 */
export function PageHeading({ title, description, icon, sx }: PageHeadingProps) {
  usePageHeader(title, description)

  return (
    // The outer box stays in the tree at every width, collapsed to nothing.
    // Most callers sit it beside an action control in a `space-between` row, and
    // removing it outright would leave one child in that row — which flexbox
    // puts at the start, sliding every toolbar from the right edge to the left.
    <Box sx={{ minWidth: 0 }}>
      <Box
        sx={[
          { display: { xs: 'block', [BAR_HAS_ROOM]: 'none' }, mb: 2 },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {icon}
          <Typography variant="h5" fontWeight={700}>
            {title}
          </Typography>
        </Box>
        {description && (
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        )}
      </Box>
    </Box>
  )
}

/**
 * The app bar's copy of the same thing.
 *
 * Both lines truncate rather than wrap: the toolbar is a fixed 64px and a
 * two-line title would push the search and avatar out of it.
 */
export function AppBarPageHeading() {
  const header = usePageHeaderValue()
  if (!header) return null

  return (
    <Box
      sx={{
        display: { xs: 'none', [BAR_HAS_ROOM]: 'block' },
        // The spacer beside this keeps the controls hard right; `minWidth: 0` is
        // what lets a long title give way and truncate rather than shove them.
        minWidth: 0,
        overflow: 'hidden',
        marginInlineEnd: 2,
      }}
    >
      <Typography variant="subtitle1" fontWeight={600} noWrap sx={{ lineHeight: 1.3 }}>
        {header.title}
      </Typography>
      {header.description && (
        <Typography
          variant="caption"
          color="text.secondary"
          component="div"
          noWrap
          sx={{ lineHeight: 1.3 }}
        >
          {header.description}
        </Typography>
      )}
    </Box>
  )
}
