import { Fragment, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Button, Checkbox, Collapse, IconButton, Link, Paper, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import MovieIcon from '@mui/icons-material/Movie'
import type { GapCollectionListing, GapMissingTitle } from './listing'

const TMDB_THUMB = 'https://image.tmdb.org/t/p/w154'
/** Films named in the row before the rest collapse into "+N more". */
const PREVIEW_TITLES = 3

interface GapCollectionRowProps<T extends GapMissingTitle> {
  listing: GapCollectionListing<T>
  expanded: boolean
  onToggleExpand: () => void
  /** Open gaps not already requested from this page. */
  requestableCount: number
  selectedCount: number
  onToggleSelect: () => void
  canRequest: boolean
  onRequestAll: () => void
  onOpenTitle: (title: T) => void
  /** The expanded panel; mounted only while open. */
  children?: ReactNode
}

/**
 * One collection with gaps, readable without expanding: which films are
 * missing, how much of the collection is on the server, and a request for the
 * rest. The poster is a thumbnail with no caption — the row already carries the
 * name, and `MoviePoster`'s caption repeated it truncated underneath.
 */
export function GapCollectionRow<T extends GapMissingTitle>({
  listing,
  expanded,
  onToggleExpand,
  requestableCount,
  selectedCount,
  onToggleSelect,
  canRequest,
  onRequestAll,
  onOpenTitle,
  children,
}: GapCollectionRowProps<T>) {
  const { t } = useTranslation()
  const { name, total, owned, pending, missing } = listing
  const preview = missing.slice(0, PREVIEW_TITLES)
  const more = missing.length - preview.length
  const ownedPct = total > 0 ? (owned / total) * 100 : 0
  const pendingPct = total > 0 ? (pending / total) * 100 : 0
  const allSelected = requestableCount > 0 && selectedCount >= requestableCount

  const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation()

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      {/* The whole row toggles for a mouse; the chevron is the accessible control. */}
      <Box
        onClick={onToggleExpand}
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 1.5,
          rowGap: 1,
          px: 1.5,
          py: 1,
          cursor: 'pointer',
          transition: 'background-color 0.15s',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: '1 1 18rem', minWidth: 0 }}>
          <Checkbox
            size="small"
            checked={allSelected}
            indeterminate={selectedCount > 0 && !allSelected}
            disabled={requestableCount === 0}
            onClick={stop}
            onChange={onToggleSelect}
            inputProps={{ 'aria-label': t('admin.gaps.selectCollectionAria', { name }) }}
            sx={{ p: 0.5 }}
          />
          {listing.posterPath ? (
            <Box
              component="img"
              src={`${TMDB_THUMB}${listing.posterPath}`}
              alt=""
              loading="lazy"
              sx={{ width: 36, height: 54, objectFit: 'cover', borderRadius: 0.75, flexShrink: 0, display: 'block' }}
            />
          ) : (
            <Box
              sx={{
                width: 36,
                height: 54,
                borderRadius: 0.75,
                flexShrink: 0,
                bgcolor: 'action.selected',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <MovieIcon fontSize="small" color="disabled" />
            </Box>
          )}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography fontWeight={600} noWrap title={name}>
              {name}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                {t('admin.gaps.missingLabel')}
              </Typography>
              {/* Titles are inline spans, not buttons: a button is inline-block,
                  which the ellipsis cannot cut through. */}
              <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                {preview.map((m, i) => (
                  <Fragment key={m.tmdbId}>
                    {i > 0 && (
                      <Box component="span" sx={{ color: 'text.disabled', mx: 0.75 }}>
                        ·
                      </Box>
                    )}
                    <Link
                      component="span"
                      role="button"
                      tabIndex={0}
                      color="inherit"
                      underline="hover"
                      sx={{ cursor: 'pointer' }}
                      onClick={(e: MouseEvent) => {
                        stop(e)
                        onOpenTitle(m)
                      }}
                      onKeyDown={(e: KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          stop(e)
                          onOpenTitle(m)
                        }
                      }}
                    >
                      {m.releaseYear != null ? `${m.title} (${m.releaseYear})` : m.title}
                    </Link>
                  </Fragment>
                ))}
              </Typography>
              {more > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {t('admin.gaps.moreMissing', { count: more })}
                </Typography>
              )}
            </Box>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, ml: 'auto' }}>
          <Box sx={{ width: 150 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="caption" color="text.secondary" noWrap>
                {t('admin.gaps.ownedOfTotal', { owned, total })}
              </Typography>
              <Typography variant="caption" fontWeight={600}>
                {Math.round(ownedPct)}%
              </Typography>
            </Box>
            {/* The numbers beside it say the same thing in words. */}
            <Box
              aria-hidden
              sx={{
                mt: 0.5,
                height: 6,
                borderRadius: 3,
                bgcolor: 'action.selected',
                overflow: 'hidden',
                display: 'flex',
              }}
            >
              <Box sx={{ width: `${ownedPct}%`, bgcolor: 'success.main' }} />
              {pending > 0 && <Box sx={{ width: `${pendingPct}%`, bgcolor: 'info.main' }} />}
            </Box>
            {pending > 0 && (
              <Typography variant="caption" color="info.main" display="block" noWrap sx={{ mt: 0.25 }}>
                {t('admin.gaps.inSeerr', { count: pending })}
              </Typography>
            )}
          </Box>
          <Button
            size="small"
            variant="outlined"
            disabled={!canRequest || requestableCount === 0}
            onClick={(e) => {
              stop(e)
              onRequestAll()
            }}
            sx={{ whiteSpace: 'nowrap' }}
          >
            {t('admin.gaps.requestFilms', { count: requestableCount })}
          </Button>
          <IconButton
            size="small"
            aria-expanded={expanded}
            aria-label={t('admin.gaps.expandAria', { name })}
            onClick={(e) => {
              stop(e)
              onToggleExpand()
            }}
          >
            <ExpandMoreIcon
              sx={{ transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none' }}
            />
          </IconButton>
        </Box>
      </Box>
      <Collapse in={expanded} unmountOnExit>
        {children}
      </Collapse>
    </Paper>
  )
}
