/**
 * Content detail view for Tool UI
 * Rich display of a single movie or series
 *
 * The chat can be narrow on any screen (a phone, the dock), so the layout follows
 * the thread's width and never the window's. In a narrow thread the poster shrinks,
 * the actions take the full width under it, and the synopsis, tagline, crew and cast
 * wait behind "Show more", which appears only when it has something to reveal.
 *
 * Rating and Watching go through their providers, so this card, the title page and
 * every poster always agree, and rating here asks when they watched it like
 * anywhere else. Their labels stay visible: a tooltip never shows on a touch screen.
 */
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Alert, Box, Typography, Paper, Chip, Button, Divider, Portal, Snackbar } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import AddToQueueIcon from '@mui/icons-material/AddToQueue'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import InfoIcon from '@mui/icons-material/Info'
import StarIcon from '@mui/icons-material/Star'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { StarRating, getProxiedImageUrl } from '@aperture/ui'
import { useAuth } from '@/hooks/useAuth'
import { useMediaDetailModal } from '@/hooks/useMediaDetailModal'
import { useUserRatings } from '@/hooks/useUserRatings'
import { useWatchStatus } from '@/hooks/useWatchStatus'
import { useWatching } from '@/hooks/useWatching'
import { COMPACT_THREAD, NARROW_THREAD, chatText } from '../density'
import type { ContentDetailData } from './types'
import { genreLabel } from '@/lib/genreLabel'

interface ContentDetailProps {
  data: ContentDetailData
}

/** Beside the poster in a wide thread; behind "Show more" in a narrow one. */
const wideOnlySx = { [NARROW_THREAD]: { display: 'none' } }

/**
 * Fills the row in a narrow thread, so buttons that wrap don't leave half a line
 * empty, and makes each one big enough for a thumb.
 */
const actionSx = { [NARROW_THREAD]: { flex: '1 1 auto', minHeight: 44 } }

export function ContentDetail({ data }: ContentDetailProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const theme = useTheme()
  // See ContentCard: null on surfaces where routing keeps the chat visible.
  const openMediaDetail = useMediaDetailModal()
  const ratings = useUserRatings()
  const watching = useWatching()
  const watchStatus = useWatchStatus()
  // An assumed session is read-only and the server refuses its writes, so don't
  // offer them: "try again" could never work.
  const readOnly = useAuth().impersonation !== null

  const [ratingBusy, setRatingBusy] = useState(false)
  const [watchingBusy, setWatchingBusy] = useState(false)
  // The message outlives `open`, so the Alert keeps its text while it fades out.
  const [failure, setFailure] = useState({ open: false, message: '' })
  const [expanded, setExpanded] = useState(false)
  const [synopsisCut, setSynopsisCut] = useState(false)
  const synopsisRef = useRef<HTMLSpanElement | null>(null)
  const moreId = useId()

  const detailsAction = data.actions.find(a => a.id === 'details')
  const playAction = data.actions.find(a => a.id === 'play')

  // The message may be days old, so the provider's answer wins once it has one.
  // Until it has (still loading, or the load failed) the message is all there is.
  const userRating =
    ratings.getRating(data.type, data.contentId) ??
    (ratings.loading || ratings.error ? (data.userRating ?? null) : null)
  // Rating an unplayed film can mark it played, long after this message was written.
  const isWatched =
    data.isWatched === true || watchStatus.isWatched(data.type, data.contentId)
  const isSeries = data.type === 'series'
  const isWatching = isSeries && watching.isWatching(data.contentId)

  const hasCrew = Boolean(data.director || data.network || data.status)
  const hasCast = Boolean(data.cast && data.cast.length > 0)
  const hasFolded = Boolean(data.tagline) || hasCrew || hasCast

  // Measured rather than guessed from the length: the same text fills three lines
  // on one phone and five on another. Only the collapsed state can be measured,
  // and in a wide thread nothing is clamped, so this reads false there.
  useLayoutEffect(() => {
    const element = synopsisRef.current
    if (!element || expanded) return
    const measure = () => setSynopsisCut(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [expanded, data.overview])

  const handleDetails = () => {
    if (!detailsAction?.href) return
    if (openMediaDetail) {
      openMediaDetail(data.type, data.contentId)
      return
    }
    navigate(detailsAction.href)
  }

  const handlePlay = () => {
    if (playAction?.href) {
      window.open(playAction.href, '_blank')
    }
  }

  const handleRating = async (rating: number | null) => {
    setRatingBusy(true)
    try {
      await ratings.setRating(data.type, data.contentId, rating)
    } catch {
      setFailure({ open: true, message: t('assistantToolUi.ratingFailed') })
    } finally {
      setRatingBusy(false)
    }
  }

  const handleWatching = async () => {
    setWatchingBusy(true)
    try {
      await watching.toggleWatching(data.contentId)
    } catch {
      setFailure({ open: true, message: t('assistantToolUi.watchingFailed') })
    } finally {
      setWatchingBusy(false)
    }
  }

  const tagline = data.tagline && (
    <Typography variant="body2" fontStyle="italic" color="text.secondary" sx={{ mb: 1 }}>
      "{data.tagline}"
    </Typography>
  )

  const crew = hasCrew && (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
      {[
        data.director && t('assistantToolUi.directorPrefix', { name: data.director }),
        data.network && t('assistantToolUi.networkPrefix', { name: data.network }),
        data.status,
      ]
        .filter(Boolean)
        .join(' · ')}
    </Typography>
  )

  return (
    <Paper
      sx={{
        p: 2,
        bgcolor: theme.palette.background.paper,
        borderRadius: 2,
        my: 2,
        [COMPACT_THREAD]: { p: 1.25, my: 1.25 },
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr)',
          gridTemplateAreas: '"poster info" "poster actions"',
          gridTemplateRows: 'auto 1fr',
          columnGap: 2,
          [COMPACT_THREAD]: { columnGap: 1.25 },
          [NARROW_THREAD]: {
            gridTemplateAreas: '"poster info" "actions actions"',
            gridTemplateRows: 'auto auto',
            rowGap: 1,
          },
        }}
      >
        {/* Poster */}
        <Box
          sx={{
            gridArea: 'poster',
            alignSelf: 'start',
            width: 120,
            aspectRatio: '2 / 3',
            borderRadius: 1.5,
            overflow: 'hidden',
            bgcolor: theme.palette.divider,
            [COMPACT_THREAD]: { width: 100 },
            [NARROW_THREAD]: { width: 84 },
          }}
        >
          {data.image ? (
            <Box
              component="img"
              src={getProxiedImageUrl(data.image)}
              alt={data.name}
              sx={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          ) : (
            <Box
              sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                color: 'text.secondary',
                fontSize: chatText(12),
              }}
            >
              {t('assistantToolUi.noImage')}
            </Box>
          )}
        </Box>

        {/* Content */}
        <Box sx={{ gridArea: 'info', minWidth: 0 }}>
          {/* Title and type */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
            <Typography
              variant="h6"
              fontWeight={700}
              sx={{
                color: 'text.primary',
                minWidth: 0,
                overflowWrap: 'anywhere',
                [NARROW_THREAD]: { fontSize: chatText(16), lineHeight: 1.25 },
              }}
            >
              {data.name}
            </Typography>
            <Chip
              label={data.type === 'movie' ? t('assistantToolUi.movie') : t('assistantToolUi.series')}
              size="small"
              sx={{
                height: 20,
                bgcolor: data.type === 'movie' ? alpha(theme.palette.primary.main, 0.15) : alpha(theme.palette.mediaType.series, 0.15),
                color: data.type === 'movie' ? theme.palette.mediaType.movie : theme.palette.mediaType.series,
              }}
            />
          </Box>

          {/* Year / Year Range */}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1, [NARROW_THREAD]: { mb: 0.5 } }}>
            {data.yearRange || data.year}
            {data.runtime && ` · ${data.runtime}`}
            {data.contentRating && ` · ${data.contentRating}`}
          </Typography>

          {/* Tagline */}
          {tagline && <Box sx={wideOnlySx}>{tagline}</Box>}

          {/* Ratings */}
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1,
              mb: 1.5,
              [NARROW_THREAD]: { gap: 0.5, mb: 0.75 },
            }}
          >
            {data.communityRating != null && (
              <Chip
                icon={<StarIcon sx={{ fontSize: 14 }} />}
                label={Number(data.communityRating).toFixed(1)}
                size="small"
                sx={{
                  height: 24,
                  bgcolor: alpha(theme.palette.warning.main, 0.15),
                  color: 'warning.main',
                  '& .MuiChip-icon': { color: 'warning.main' },
                }}
              />
            )}
            <StarRating
              value={userRating}
              onChange={(rating) => void handleRating(rating)}
              loading={ratings.loading || ratingBusy}
              readOnly={readOnly}
              size="medium"
              showValue
            />
            {isWatched && (
              <Chip
                icon={<CheckCircleIcon sx={{ fontSize: 14 }} />}
                label={
                  data.playCount && data.playCount > 1
                    ? t('assistantToolUi.watchedCount', { count: data.playCount })
                    : t('assistantToolUi.watched')
                }
                size="small"
                sx={{
                  height: 24,
                  bgcolor: (t) => alpha(t.palette.mediaType.series, 0.15),
                  color: 'mediaType.series',
                  '& .MuiChip-icon': { color: 'mediaType.series' },
                }}
              />
            )}
          </Box>

          {/* Genres */}
          {data.genres && data.genres.length > 0 && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 0.5,
                mb: 1.5,
                [NARROW_THREAD]: { mb: 0.75 },
              }}
            >
              {data.genres.map((genre) => (
                <Chip
                  key={genre}
                  label={genreLabel(genre)}
                  size="small"
                  sx={{
                    height: 22,
                    bgcolor: theme.palette.divider,
                    color: 'text.secondary',
                  }}
                />
              ))}
            </Box>
          )}

          {/* Director / Network */}
          {crew && <Box sx={wideOnlySx}>{crew}</Box>}

          {/* Series info */}
          {isSeries && ((data.seasonCount ?? 0) > 0 || (data.episodeCount ?? 0) > 0) && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {t('assistantToolUi.seriesCounts', {
                seasons: data.seasonCount ?? 0,
                episodes: data.episodeCount ?? 0,
              })}
              {data.episodesWatched !== undefined &&
                data.episodesWatched > 0 &&
                t('assistantToolUi.episodesWatchedSuffix', { count: data.episodesWatched })}
            </Typography>
          )}
        </Box>

        {/* Action buttons */}
        <Box
          sx={{
            gridArea: 'actions',
            display: 'flex',
            flexWrap: 'wrap',
            alignContent: 'flex-start',
            gap: 1,
            mt: 1,
            [NARROW_THREAD]: { mt: 0 },
          }}
        >
          <Button
            variant="outlined"
            startIcon={<InfoIcon />}
            onClick={handleDetails}
            sx={{
              ...actionSx,
              borderColor: theme.palette.surface.subtleBorder,
              color: 'text.secondary',
              '&:hover': {
                borderColor: theme.palette.primary.main,
                bgcolor: alpha(theme.palette.primary.main, 0.1),
              },
            }}
          >
            {t('assistantToolUi.viewDetails')}
          </Button>
          {playAction && (
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={handlePlay}
              sx={{
                ...actionSx,
                background: theme.palette.gradient.primaryToSecondary,
                '&:hover': {
                  background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.secondary.dark} 100%)`,
                },
              }}
            >
              {t('assistantToolUi.playOnEmby')}
            </Button>
          )}
          {isSeries && (
            <Button
              variant="outlined"
              color={isWatching ? 'primary' : 'inherit'}
              startIcon={isWatching ? <PlaylistAddCheckIcon /> : <AddToQueueIcon />}
              // A list that failed to load can't say which way this button should go.
              disabled={readOnly || watching.loading || watchingBusy || watching.error !== null}
              aria-label={t(
                isWatching
                  ? 'mediaDetail.hero.removeFromWatchingList'
                  : 'mediaDetail.hero.addToWatchingList'
              )}
              onClick={() => void handleWatching()}
              sx={actionSx}
            >
              {t(isWatching ? 'mediaDetail.hero.watching' : 'mediaDetail.hero.addToWatching')}
            </Button>
          )}
        </Box>
      </Box>

      <Box id={moreId}>
        {/* Overview */}
        {data.overview && (
          <>
            <Divider sx={{ my: 2, borderColor: theme.palette.divider, ...wideOnlySx }} />
            <Typography
              ref={synopsisRef}
              variant="body2"
              color="text.secondary"
              sx={{
                lineHeight: 1.6,
                [NARROW_THREAD]: {
                  mt: 1,
                  ...(!expanded && {
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }),
                },
              }}
            >
              {data.overview}
            </Typography>
          </>
        )}

        {/* What a wide thread shows beside the poster */}
        {expanded && (tagline || crew) && (
          <Box sx={{ display: 'none', [NARROW_THREAD]: { display: 'block', mt: 1 } }}>
            {tagline}
            {crew}
          </Box>
        )}

        {/* Cast */}
        {hasCast && (
          <Box sx={{ [NARROW_THREAD]: { display: expanded ? 'block' : 'none' } }}>
            <Divider sx={{ my: 2, borderColor: theme.palette.divider, [NARROW_THREAD]: { my: 1 } }} />
            <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              {t('assistantToolUi.castHeading')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {data.cast?.join(', ')}
            </Typography>
          </Box>
        )}
      </Box>

      {(hasFolded || synopsisCut || expanded) && (
        <Button
          size="small"
          aria-controls={moreId}
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          endIcon={
            <ExpandMoreIcon sx={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />
          }
          sx={{
            display: 'none',
            [NARROW_THREAD]: { display: 'inline-flex', mt: 0.5, minHeight: 44 },
          }}
        >
          {t(expanded ? 'common.showLess' : 'common.showMore')}
        </Button>
      )}

      {/* Out of the thread: its container query makes it the box a `fixed` child is
          placed against, so a message here would scroll away with the conversation. */}
      <Portal>
        <Snackbar
          open={failure.open}
          autoHideDuration={6000}
          onClose={() => setFailure((f) => ({ ...f, open: false }))}
        >
          <Alert severity="error" onClose={() => setFailure((f) => ({ ...f, open: false }))}>
            {failure.message}
          </Alert>
        </Snackbar>
      </Portal>
    </Paper>
  )
}
