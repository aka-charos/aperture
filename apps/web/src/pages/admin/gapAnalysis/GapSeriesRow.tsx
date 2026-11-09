import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Button, Checkbox, Chip, Collapse, IconButton, Paper, Tooltip, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import StarIcon from '@mui/icons-material/Star'
import TvIcon from '@mui/icons-material/Tv'
import { useGenreLabel } from '../../../lib/genreLabel'
import type { SeriesGapShow } from './seriesListing'

const TMDB_THUMB = 'https://image.tmdb.org/t/p/w154'
/** Genres drawn as chips; the rest go into a "+N" chip whose tooltip names them. */
const GENRES_SHOWN = 3
/**
 * The row's own width, not the window's: the sidebar and a docked assistant narrow
 * the pane. Past this the title, the rating column at a fixed width and the season
 * bar fit on one line, so the column can line up down the list.
 */
const ROW_ROOMY = '@container gapSeriesRow (min-width: 1080px)'
/** Read by screen readers, not drawn. */
const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const

interface GapSeriesRowProps {
  show: SeriesGapShow
  expanded: boolean
  onToggleExpand: () => void
  requestableCount: number
  selectedCount: number
  onToggleSelect: () => void
  canRequest: boolean
  onRequestAll: () => void
  /** The expanded panel; mounted only while open. */
  children?: ReactNode
}

/**
 * One show with season gaps, readable without expanding: which seasons, on which
 * network, how much of the show is here, and a request for the rest.
 */
export function GapSeriesRow({
  show,
  expanded,
  onToggleExpand,
  requestableCount,
  selectedCount,
  onToggleSelect,
  canRequest,
  onRequestAll,
  children,
}: GapSeriesRowProps) {
  const { t, i18n } = useTranslation()
  const genreLabel = useGenreLabel()
  const { title, total, owned, pending } = show
  const rating =
    show.rating != null
      ? show.rating.toLocaleString(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      : null
  // Two stored names can read the same once translated, and a server can repeat one.
  const genres = [...new Set(show.genres.map(genreLabel))]
  const hiddenGenres = genres.slice(GENRES_SHOWN)
  const ownedPct = total > 0 ? (owned / total) * 100 : 0
  const pendingPct = total > 0 ? (pending / total) * 100 : 0
  const allSelected = requestableCount > 0 && selectedCount >= requestableCount
  const missing = show.seasons.filter((s) => s.standing === 'missing')
  const partial = show.seasons.filter((s) => s.standing === 'partial')

  const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation()

  return (
    <Paper
      variant="outlined"
      sx={{ borderRadius: 2, overflow: 'hidden', containerType: 'inline-size', containerName: 'gapSeriesRow' }}
    >
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
          {!show.numberingDiffers && (
            <Checkbox
              size="small"
              checked={allSelected}
              indeterminate={selectedCount > 0 && !allSelected}
              disabled={requestableCount === 0}
              onClick={stop}
              onChange={onToggleSelect}
              inputProps={{ 'aria-label': t('admin.gaps.series.selectShowAria', { name: title }) }}
              sx={{ p: 0.5 }}
            />
          )}
          {show.posterPath ? (
            <Box
              component="img"
              src={`${TMDB_THUMB}${show.posterPath}`}
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
              <TvIcon fontSize="small" color="disabled" />
            </Box>
          )}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <Typography fontWeight={600} noWrap title={title} sx={{ minWidth: 0 }}>
                {title}
              </Typography>
              {show.networks.length > 0 && (
                <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 1, minWidth: 0 }}>
                  {show.networks.join(' · ')}
                </Typography>
              )}
            </Box>
            {show.numberingDiffers ? (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label={t('admin.gaps.series.numberingChip')}
                sx={{ mt: 0.25 }}
              />
            ) : (
              <>
                {missing.length > 0 && (
                  <Typography variant="body2" noWrap>
                    {t('admin.gaps.series.missingSeasons', {
                      count: missing.length,
                      list: missing.map((s) => s.seasonNumber).join(', '),
                    })}
                  </Typography>
                )}
                {partial.length > 0 && (
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {t('admin.gaps.series.partialSeasons', {
                      count: partial.length,
                      list: partial
                        .map((s) =>
                          t('admin.gaps.series.partialEntry', {
                            season: s.seasonNumber,
                            held: s.heldEpisodes,
                            aired: s.airedEpisodes,
                          })
                        )
                        .join(', '),
                    })}
                  </Typography>
                )}
              </>
            )}
          </Box>
        </Box>

        {/* A fixed width once the row has room, so ratings and genres line up down the
            list; narrower, it sizes to its content and wraps with the rest. */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            minWidth: 0,
            [ROW_ROOMY]: { width: '22rem' },
          }}
        >
          <Box
            role="img"
            aria-label={rating ? t('admin.gaps.series.ratingAria', { rating }) : t('admin.gaps.series.unrated')}
            title={rating ? undefined : t('admin.gaps.series.unrated')}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: '3.25rem', flexShrink: 0 }}
          >
            <StarIcon aria-hidden sx={{ fontSize: 16, color: rating ? 'warning.light' : 'action.disabled' }} />
            <Typography aria-hidden variant="body2" fontWeight={600} color={rating ? 'text.primary' : 'text.disabled'}>
              {rating ?? '–'}
            </Typography>
          </Box>
          {genres.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.5, minWidth: 0, overflow: 'hidden' }}>
              {genres.slice(0, GENRES_SHOWN).map((genre) => (
                <Chip key={genre} size="small" variant="outlined" label={genre} sx={{ flexShrink: 1, minWidth: 0 }} />
              ))}
              {hiddenGenres.length > 0 && (
                // Focusable so the tooltip opens from the keyboard, opens at a tap, and
                // a tap does not also expand the row; screen readers read the names.
                <Tooltip title={hiddenGenres.join(', ')} enterTouchDelay={0}>
                  <Chip
                    size="small"
                    variant="outlined"
                    tabIndex={0}
                    onClick={stop}
                    label={
                      <>
                        <span aria-hidden>{t('admin.gaps.series.moreGenres', { count: hiddenGenres.length })}</span>
                        <Box component="span" sx={visuallyHidden}>
                          {hiddenGenres.join(', ')}
                        </Box>
                      </>
                    }
                    sx={{ flexShrink: 0 }}
                  />
                </Tooltip>
              )}
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, ml: 'auto' }}>
          <Box sx={{ width: 150 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="caption" color="text.secondary" noWrap>
                {t('admin.gaps.series.seasonsOwned', { owned, total })}
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
          {!show.numberingDiffers && (
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
              {t('admin.gaps.series.requestSeasons', { count: requestableCount })}
            </Button>
          )}
          <IconButton
            size="small"
            aria-expanded={expanded}
            aria-label={t('admin.gaps.series.expandAria', { name: title })}
            onClick={(e) => {
              stop(e)
              onToggleExpand()
            }}
          >
            <ExpandMoreIcon sx={{ transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none' }} />
          </IconButton>
        </Box>
      </Box>
      <Collapse in={expanded} unmountOnExit>
        {children}
      </Collapse>
    </Paper>
  )
}
