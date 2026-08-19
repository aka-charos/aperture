import { Fragment, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box,
  Typography,
  Button,
  Chip,
  Paper,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Snackbar,
  CircularProgress,
} from '@mui/material'
import { alpha, darken, useTheme } from '@mui/material/styles'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StarIcon from '@mui/icons-material/Star'
import TvIcon from '@mui/icons-material/Tv'
import MovieIcon from '@mui/icons-material/Movie'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import AddToQueueIcon from '@mui/icons-material/AddToQueue'
import NotesIcon from '@mui/icons-material/Notes'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import FavoriteIcon from '@mui/icons-material/Favorite'
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'
import OndemandVideoIcon from '@mui/icons-material/OndemandVideo'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import ThumbUpIcon from '@mui/icons-material/ThumbUp'
import HubOutlinedIcon from '@mui/icons-material/HubOutlined'
import type {
  Media,
  MediaServerInfo,
  MovieWatchStats,
  RecommendationInsights,
  SeriesWatchStats,
  WatchStatus,
} from '../types'
import { isMovie, isSeries } from '../types'
import { useServerDisplayName } from '../../../hooks/useServerDisplayName'
import { formatRuntime } from '../hooks'
import { hasCriticRatings, personPath } from '../helpers'
import { RatingBadges } from './RatingBadges'
import { CommunityStrip } from './CommunityStrip'
import {
  StarRating,
  getProxiedImageUrl,
  FALLBACK_POSTER_URL,
  TrailerModal,
} from '@aperture/ui'

// The "open in <server>" CTA is branded like the app it opens, not the instance's own
// theme — these are the media servers' own colors, not admin-configurable.
const EMBY_GREEN = '#52b54b'
const JELLYFIN_PURPLE = '#965ec7'

/**
 * Credits are a scan target, not a cast list — a director and a couple of
 * writers is what people look for at the top of a page. Anything past this is
 * counted rather than named.
 */
const CREW_NAMES_SHOWN = 4

interface MediaHeroProps {
  media: Media
  mediaServer: MediaServerInfo | null
  userRating: number | null
  ratingLoading?: boolean
  onRatingChange: (rating: number | null) => void
  /**
   * The recommender's read on this title's genres, when it scored it. Used to
   * style the genre chips below — this is the only place that classification is
   * rendered, so the insights panel no longer repeats the same genres in its
   * own format.
   */
  genreAnalysis?: RecommendationInsights['genreAnalysis']
  /**
   * Community watch counts, rendered as a single line between the genres and
   * the action buttons. Used to be a card in the info card, a screen further
   * down the page.
   */
  watchStats?: MovieWatchStats | SeriesWatchStats | null
  // Series-specific
  isWatching?: boolean
  onWatchingToggle?: () => void
  // Movie-specific
  watchStatus?: WatchStatus | null
  canManageWatchHistory?: boolean
  userId?: string
  onMarkedUnwatched?: () => void
  onMarkedWatched?: () => void
  isFavorite?: boolean | null
  favoriteLoading?: boolean
  onFavoriteToggle?: () => Promise<boolean>
}

export function MediaHero({
  media,
  mediaServer,
  userRating,
  ratingLoading = false,
  onRatingChange,
  genreAnalysis,
  watchStats,
  isWatching,
  onWatchingToggle,
  watchStatus,
  canManageWatchHistory,
  userId,
  onMarkedUnwatched,
  onMarkedWatched,
  isFavorite,
  favoriteLoading = false,
  onFavoriteToggle,
}: MediaHeroProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const serverName = useServerDisplayName()
  const [showFullPlot, setShowFullPlot] = useState(false)
  // Only worth offering when it actually adds something: OMDb answers plot=full
  // with the short blurb whenever IMDb has no long synopsis, and for a good
  // number of titles the two are the same string.
  const hasLongerPlot = Boolean(
    media.plot_full && (!media.overview || media.plot_full.length > media.overview.length)
  )
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [marking, setMarking] = useState(false)
  const [markingWatched, setMarkingWatched] = useState(false)
  const [posterOffRatio, setPosterOffRatio] = useState(false)
  const [snackbar, setSnackbar] = useState<{
    open: boolean
    message: string
    severity: 'success' | 'error'
  }>({ open: false, message: '', severity: 'success' })
  const [trailerLoading, setTrailerLoading] = useState(false)
  const [trailerModal, setTrailerModal] = useState<{
    open: boolean
    watchUrl: string | null
    title: string | null
  }>({ open: false, watchUrl: null, title: null })

  const handleOpenTrailer = useCallback(async () => {
    const tmdb = media.tmdb_id
    if (!tmdb) return
    const path =
      isMovie(media) ? `/api/movies/${media.id}/trailer` : `/api/series/${media.id}/trailer`
    setTrailerLoading(true)
    try {
      const res = await fetch(path, { credentials: 'include' })
      const data = (await res.json()) as {
        trailerUrl?: string | null
        name?: string | null
        error?: string
      }
      if (data.trailerUrl) {
        setTrailerModal({
          open: true,
          watchUrl: data.trailerUrl,
          title: data.name ?? media.title,
        })
      } else {
        setSnackbar({
          open: true,
          message: data.error || t('mediaDetail.hero.noTrailer'),
          severity: 'error',
        })
      }
    } catch {
      setSnackbar({ open: true, message: t('mediaDetail.hero.failedTrailer'), severity: 'error' })
    } finally {
      setTrailerLoading(false)
    }
  }, [media, t])

  const handlePlayOnMediaServer = () => {
    if (!mediaServer?.baseUrl || !media.provider_item_id) return

    const webClientUrl = mediaServer.webClientUrl || `${mediaServer.baseUrl}/web/index.html`
    const serverIdParam = mediaServer.serverId ? `&serverId=${mediaServer.serverId}` : ''
    const itemPath =
      mediaServer.type === 'jellyfin'
        ? `#!/details?id=${media.provider_item_id}${serverIdParam}`
        : `#!/item?id=${media.provider_item_id}${serverIdParam}`

    window.open(`${webClientUrl}${itemPath}`, '_blank')
  }

  const handleMarkUnwatched = async () => {
    if (!userId || !isMovie(media)) return

    setMarking(true)
    try {
      const response = await fetch(`/api/users/${userId}/watch-history/movies/${media.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (response.ok) {
        setSnackbar({ open: true, message: t('mediaDetail.hero.snackbarMarked'), severity: 'success' })
        onMarkedUnwatched?.()
      } else {
        const error = await response.json()
        setSnackbar({
          open: true,
          message: error.error || t('mediaDetail.hero.snackbarMarkFailed'),
          severity: 'error',
        })
      }
    } catch {
      setSnackbar({ open: true, message: t('mediaDetail.hero.snackbarMarkFailed'), severity: 'error' })
    } finally {
      setMarking(false)
      setConfirmOpen(false)
    }
  }

  const handleMarkWatched = async () => {
    if (!userId || !isMovie(media)) return

    setMarkingWatched(true)
    try {
      const response = await fetch(`/api/users/${userId}/watch-history/movies/${media.id}`, {
        method: 'POST',
        credentials: 'include',
      })

      if (response.ok) {
        setSnackbar({
          open: true,
          message: t('mediaDetail.hero.snackbarMarkedWatched'),
          severity: 'success',
        })
        onMarkedWatched?.()
      } else {
        const error = await response.json()
        setSnackbar({
          open: true,
          message: error.error || t('mediaDetail.hero.snackbarMarkWatchedFailed'),
          severity: 'error',
        })
      }
    } catch {
      setSnackbar({
        open: true,
        message: t('mediaDetail.hero.snackbarMarkWatchedFailed'),
        severity: 'error',
      })
    } finally {
      setMarkingWatched(false)
    }
  }

  const handleFavoriteToggle = async () => {
    if (!onFavoriteToggle) return

    const wasFavorite = isFavorite === true
    const ok = await onFavoriteToggle()
    setSnackbar({
      open: true,
      message: ok
        ? wasFavorite
          ? t('mediaDetail.hero.snackbarFavoriteRemoved')
          : t('mediaDetail.hero.snackbarFavoriteAdded')
        : t('mediaDetail.hero.snackbarFavoriteFailed'),
      severity: ok ? 'success' : 'error',
    })
  }

  // Build year display
  const getYearDisplay = () => {
    if (isSeries(media)) {
      return media.end_year
        ? `${media.year} – ${media.end_year}`
        : media.year
          ? `${media.year} – ${t('mediaDetail.hero.yearPresent')}`
          : null
    }
    return media.year
  }

  const yearDisplay = getYearDisplay()
  const serverBrandColor = mediaServer?.type === 'jellyfin' ? JELLYFIN_PURPLE : EMBY_GREEN

  // The credits worth naming at the top of a page. Rendered here rather than
  // in the info card several screens down, where the director of the film you
  // are looking at sat below the whole cast.
  const crewCredits: Array<{ id: string; label: string; names: string[] }> = []
  if (media.directors && media.directors.length > 0) {
    crewCredits.push({
      id: 'directors',
      label: isSeries(media)
        ? t('mediaDetail.infoCard.createdBy')
        : t('mediaDetail.infoCard.director'),
      names: media.directors,
    })
  }
  if (media.writers && media.writers.length > 0) {
    crewCredits.push({
      id: 'writers',
      label: t('mediaDetail.infoCard.writers'),
      names: media.writers,
    })
  }

  // Two sets rather than a lookup per chip: a title has a handful of genres and
  // this runs on every render, so building them is cheaper than memoising them.
  // Both are empty until the insights request lands, and stay empty for a title
  // no run has scored — in which case the chips keep their neutral styling.
  const enjoyedGenres = new Set(genreAnalysis?.matchingGenres ?? [])
  const unexploredGenres = new Set(genreAnalysis?.newGenres ?? [])

  // OMDb writes the summary for both media types; `awards` is the older
  // series-only column, kept as a fallback so a show enriched before OMDb was
  // configured still says something.
  const awardsLine = media.awards_summary ?? (isSeries(media) ? media.awards : null)
  const showRatingLine =
    media.community_rating != null ||
    hasCriticRatings(media) ||
    (isSeries(media) && media.critic_rating != null)

  // Shared styling so every action reads as one consistent button group:
  // fixed height, no per-button text wrapping, no shrinking (they wrap the row instead).
  const actionBtnSx = {
    borderRadius: 2,
    textTransform: 'none' as const,
    fontWeight: 600,
    height: 42,
    px: 2.25,
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
    minWidth: 'auto',
  }

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          gap: 4,
          flexDirection: { xs: 'column', md: 'row' },
          mt: { xs: -18, md: -28 },
          position: 'relative',
          zIndex: 1,
          px: 3,
        }}
      >
        {/* Poster */}
        <Paper
          elevation={8}
          sx={{
            width: { xs: 200, md: 280 },
            height: { xs: 300, md: 420 },
            flexShrink: 0,
            borderRadius: 2,
            overflow: 'hidden',
            position: 'relative',
            alignSelf: { xs: 'center', md: 'flex-start' },
          }}
        >
          {media.poster_url ? (
            <>
              {/* Library artwork isn't guaranteed 2:3 — objectFit: 'cover' would crop
                  off-ratio posters top/bottom. Off-ratio posters render with 'contain'
                  plus a blurred fill behind. */}
              {posterOffRatio && (
                <Box
                  component="img"
                  src={getProxiedImageUrl(media.poster_url)}
                  alt=""
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    filter: 'blur(20px)',
                    transform: 'scale(1.15)',
                  }}
                />
              )}
              <Box
                component="img"
                src={getProxiedImageUrl(media.poster_url)}
                alt={media.title}
                onLoad={(e) => {
                  const { naturalWidth, naturalHeight } = e.currentTarget
                  if (naturalWidth > 0 && naturalHeight > 0) {
                    setPosterOffRatio(Math.abs(naturalWidth / naturalHeight - 2 / 3) > 0.02)
                  }
                }}
                onError={(e) => {
                  const target = e.target as HTMLImageElement
                  target.src = FALLBACK_POSTER_URL
                }}
                sx={{
                  position: 'relative',
                  width: '100%',
                  height: '100%',
                  objectFit: posterOffRatio ? 'contain' : 'cover',
                }}
              />
            </>
          ) : (
            <Box
              sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'grey.800',
              }}
            >
              {isMovie(media) ? (
                <MovieIcon sx={{ fontSize: 64, color: 'grey.600' }} />
              ) : (
                <TvIcon sx={{ fontSize: 64, color: 'grey.600' }} />
              )}
            </Box>
          )}
        </Paper>

        {/* Info */}
        <Box sx={{ flex: 1 }}>
          {/* Status badges */}
          <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
            {/* Series status */}
            {isSeries(media) && media.status && (
              <Chip
                label={media.status}
                size="small"
                color={media.status === 'Continuing' ? 'success' : 'default'}
                sx={{ fontWeight: 600 }}
              />
            )}
            {isSeries(media) && media.content_rating && (
              <Chip
                label={media.content_rating}
                size="small"
                variant="outlined"
                sx={{ fontWeight: 600 }}
              />
            )}
            {/* Movie availability */}
            {isMovie(media) && (
              <Chip
                label={t('mediaDetail.hero.available')}
                size="small"
                sx={{ bgcolor: 'success.main', color: 'white', fontWeight: 600 }}
              />
            )}
            {/* Movie watch status */}
            {isMovie(media) && watchStatus?.isWatched && (
              <Chip
                icon={<CheckCircleIcon sx={{ fontSize: 16 }} />}
                label={
                  watchStatus.playCount > 1
                    ? t('mediaDetail.hero.watchedCount', { count: watchStatus.playCount })
                    : t('mediaDetail.hero.watched')
                }
                size="small"
                sx={{ bgcolor: 'primary.main', color: 'white', fontWeight: 600 }}
              />
            )}
          </Box>

          {/* Title, with the viewer's own rating (indigo star, distinct from
              the red favorite heart) beside it.

              The rating used to sit on its own line below the genres, where it
              read as a fifth action button. Up here it reads as a property of
              the title.

              Beside means beside: the title takes its own width (`0 1 auto`)
              rather than growing, so the stars follow the last letter. Letting
              the title grow pushed them to the far edge of a 1400px hero,
              which paired them with nothing and made them look like a stray
              control in the backdrop.

              The wrap is driven by flex basis, not a breakpoint — the stars
              drop under the title once the two no longer fit the *container*,
              which is what a phone does, and also what MediaDetailModal and
              the assistant dock do at full window width. No `ml: 'auto'`: an
              auto margin would still be in force on the wrapped line and would
              strand the stars against the right edge there too. */}
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              columnGap: 2,
              rowGap: 1,
              mb: 1,
            }}
          >
            <Typography
              variant="h3"
              fontWeight={700}
              sx={{ flex: '0 1 auto', minWidth: 0, textShadow: '2px 2px 4px rgba(0,0,0,0.5)' }}
            >
              {media.title}
            </Typography>
            <Box sx={{ flex: '0 0 auto' }}>
              <StarRating
                value={userRating}
                onChange={onRatingChange}
                loading={ratingLoading}
                size="medium"
                showValue
              />
            </Box>
          </Box>

          {media.original_title && media.original_title !== media.title && (
            <Typography variant="h6" color="text.secondary" sx={{ mb: 2, fontStyle: 'italic' }}>
              {media.original_title}
            </Typography>
          )}

          {/* Tagline (series only) */}
          {isSeries(media) && media.tagline && (
            <Typography variant="body1" color="text.secondary" sx={{ mb: 2, fontStyle: 'italic' }}>
              "{media.tagline}"
            </Typography>
          )}

          {/* Meta row — tight against the credits line below it, which is part
              of the same "what is this" block rather than a new one. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
            {yearDisplay && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <CalendarTodayIcon fontSize="small" color="action" />
                <Typography variant="body1">{yearDisplay}</Typography>
              </Box>
            )}
            {/* Movie runtime */}
            {isMovie(media) && media.runtime_minutes && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <AccessTimeIcon fontSize="small" color="action" />
                <Typography variant="body1">{formatRuntime(media.runtime_minutes)}</Typography>
              </Box>
            )}
            {/* Series seasons/episodes */}
            {isSeries(media) && media.total_seasons && (
              <Typography variant="body1" color="text.secondary">
                {t('mediaDetail.hero.seasons', { count: media.total_seasons })}
              </Typography>
            )}
            {isSeries(media) && media.total_episodes && (
              <Typography variant="body1" color="text.secondary">
                {t('mediaDetail.hero.episodes', { count: media.total_episodes })}
              </Typography>
            )}
            {isSeries(media) && media.average_episode_runtime_minutes != null && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <AccessTimeIcon fontSize="small" color="action" />
                <Typography variant="body1" color="text.secondary">
                  {t('mediaDetail.hero.avgPerEpisode', {
                    runtime: formatRuntime(media.average_episode_runtime_minutes),
                  })}
                </Typography>
              </Box>
            )}
            {/* Series network */}
            {isSeries(media) && media.network && (
              <Chip label={media.network} size="small" variant="outlined" />
            )}
          </Box>

          {/* Credits */}
          {crewCredits.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 3, rowGap: 0.5, mb: 3 }}>
              {crewCredits.map(({ id, label, names }) => (
                <Typography key={id} variant="body2" color="text.secondary">
                  {label}{' '}
                  {names.slice(0, CREW_NAMES_SHOWN).map((name, idx) => (
                    <Fragment key={`${name}-${idx}`}>
                      {idx > 0 && ', '}
                      <Box
                        component={RouterLink}
                        to={personPath(name)}
                        sx={{
                          color: 'text.primary',
                          fontWeight: 600,
                          textDecoration: 'none',
                          '&:hover': { textDecoration: 'underline' },
                        }}
                      >
                        {name}
                      </Box>
                    </Fragment>
                  ))}
                  {names.length > CREW_NAMES_SHOWN &&
                    ` ${t('mediaDetail.hero.plusMore', {
                      count: names.length - CREW_NAMES_SHOWN,
                    })}`}
                </Typography>
              ))}
            </Box>
          )}

          {/* Genres, carrying the recommender's read on them where there is one:
              a genre this viewer already watches, or one that would be new to
              them. The insights panel used to render exactly these genres a
              second time in its own colours — same fact, two formats, two
              places. */}
          {media.genres && media.genres.length > 0 && (
            <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
              {media.genres.map((genre) => {
                const enjoyed = enjoyedGenres.has(genre)
                const unexplored = unexploredGenres.has(genre)
                const chip = (
                  <Chip
                    label={genre}
                    size="small"
                    variant={unexplored ? 'outlined' : 'filled'}
                    icon={
                      enjoyed ? (
                        <ThumbUpIcon sx={{ color: 'white !important', fontSize: 16 }} />
                      ) : unexplored ? (
                        <HubOutlinedIcon sx={{ color: 'info.main', fontSize: 16 }} />
                      ) : undefined
                    }
                    sx={
                      enjoyed
                        ? { bgcolor: 'success.main', color: 'white', fontWeight: 500 }
                        : unexplored
                          ? { borderColor: 'info.main', color: 'info.main' }
                          : {
                              bgcolor: 'rgba(255,255,255,0.1)',
                              '&:hover': { bgcolor: 'rgba(255,255,255,0.15)' },
                            }
                    }
                  />
                )

                // Colour alone doesn't say what it means, and there is no
                // legend now that the panel's chips are gone.
                return enjoyed || unexplored ? (
                  <Tooltip
                    key={genre}
                    title={
                      enjoyed
                        ? t('mediaDetail.hero.genreEnjoyedTooltip')
                        : t('mediaDetail.hero.genreNewTooltip')
                    }
                  >
                    {chip}
                  </Tooltip>
                ) : (
                  <Fragment key={genre}>{chip}</Fragment>
                )
              })}
            </Box>
          )}

          {/* What the rest of the household did with this title. One line
              between the genres and the actions, rather than a bordered card
              most of a page below. */}
          <CommunityStrip media={media} watchStats={watchStats} />

          {/* Action buttons — one consistent group; the primary "open" action leads,
              secondary actions follow. Wraps as a whole instead of squishing individual buttons. */}
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1.5,
              mb: 3,
              alignItems: 'center',
            }}
          >
            {/* Primary CTA: open in media server, colored like that server's own brand */}
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={handlePlayOnMediaServer}
              disabled={!mediaServer?.baseUrl}
              sx={{
                ...actionBtnSx,
                color: 'white',
                backgroundColor: serverBrandColor,
                boxShadow: `0 4px 14px ${alpha(serverBrandColor, 0.35)}`,
                '&:hover': {
                  backgroundColor: darken(serverBrandColor, 0.1),
                  boxShadow: `0 6px 18px ${alpha(serverBrandColor, 0.45)}`,
                },
              }}
            >
              {mediaServer?.type === 'jellyfin'
                ? t('mediaDetail.hero.openJellyfin')
                : t('mediaDetail.hero.openEmby')}
            </Button>
            {/* Series watching toggle */}
            {isSeries(media) && onWatchingToggle && (
              <Tooltip
                title={
                  isWatching
                    ? t('mediaDetail.hero.removeFromWatchingList')
                    : t('mediaDetail.hero.addToWatchingList')
                }
              >
                <Button
                  variant={isWatching ? 'contained' : 'outlined'}
                  startIcon={isWatching ? <PlaylistAddCheckIcon /> : <AddToQueueIcon />}
                  onClick={onWatchingToggle}
                  sx={{
                    ...actionBtnSx,
                    ...(isWatching && {
                      color: 'white',
                      background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.9)} 0%, ${alpha(theme.palette.secondary.main, 0.9)} 100%)`,
                    }),
                  }}
                >
                  {isWatching ? t('mediaDetail.hero.watching') : t('mediaDetail.hero.addToWatching')}
                </Button>
              </Tooltip>
            )}
            {media.tmdb_id && (
              <Tooltip title={t('mediaDetail.hero.trailerTooltip')}>
                <span>
                  <Button
                    variant="outlined"
                    startIcon={
                      trailerLoading ? (
                        <CircularProgress size={18} color="inherit" />
                      ) : (
                        <OndemandVideoIcon />
                      )
                    }
                    onClick={handleOpenTrailer}
                    disabled={trailerLoading}
                    sx={actionBtnSx}
                  >
                    {t('mediaDetail.hero.trailer')}
                  </Button>
                </span>
              </Tooltip>
            )}
            {/* Movie favorite toggle (synced to the media server) */}
            {isMovie(media) && onFavoriteToggle && (
              <Tooltip
                title={
                  isFavorite
                    ? serverName
                      ? t('mediaDetail.hero.removeFavoriteTooltipNamed', { serverName })
                      : t('mediaDetail.hero.removeFavoriteTooltip')
                    : serverName
                      ? t('mediaDetail.hero.addFavoriteTooltipNamed', { serverName })
                      : t('mediaDetail.hero.addFavoriteTooltip')
                }
              >
                <span>
                  <Button
                    variant={isFavorite ? 'contained' : 'outlined'}
                    color="error"
                    startIcon={
                      favoriteLoading ? (
                        <CircularProgress size={18} color="inherit" />
                      ) : isFavorite ? (
                        <FavoriteIcon />
                      ) : (
                        <FavoriteBorderIcon />
                      )
                    }
                    onClick={handleFavoriteToggle}
                    disabled={isFavorite === null || favoriteLoading}
                    sx={actionBtnSx}
                  >
                    {isFavorite
                      ? t('mediaDetail.hero.favorited')
                      : t('mediaDetail.hero.favorite')}
                  </Button>
                </span>
              </Tooltip>
            )}
            {/* Movie mark watched */}
            {isMovie(media) && watchStatus && !watchStatus.isWatched && canManageWatchHistory && (
              <Tooltip
                title={
                  serverName
                    ? t('mediaDetail.hero.markWatchedTooltipNamed', { serverName })
                    : t('mediaDetail.hero.markWatchedTooltip')
                }
              >
                <span>
                  <Button
                    variant="outlined"
                    color="success"
                    startIcon={
                      markingWatched ? (
                        <CircularProgress size={18} color="inherit" />
                      ) : (
                        <VisibilityIcon />
                      )
                    }
                    onClick={handleMarkWatched}
                    disabled={markingWatched}
                    sx={actionBtnSx}
                  >
                    {t('mediaDetail.hero.markWatched')}
                  </Button>
                </span>
              </Tooltip>
            )}
            {/* Movie mark unwatched */}
            {isMovie(media) && watchStatus?.isWatched && canManageWatchHistory && (
              <Tooltip title={t('mediaDetail.hero.markUnwatchedTooltip')}>
                <Button
                  variant="outlined"
                  color="warning"
                  startIcon={<VisibilityOffIcon />}
                  onClick={() => setConfirmOpen(true)}
                  sx={actionBtnSx}
                >
                  {t('mediaDetail.hero.markUnwatched')}
                </Button>
              </Tooltip>
            )}
          </Box>

          {/* Every score on one line: the community rating this page has always
              led with, then the external ones, which used to sit in their own
              panel in the sidebar. Guards are `!= null` because pg returns
              NUMERIC as a string — '0.0' is truthy, a numeric 0 is not. */}
          {showRatingLine && (
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5, flexWrap: 'wrap' }}
            >
              {media.community_rating != null && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 0.5 }}>
                  <StarIcon sx={{ color: 'warning.main' }} />
                  <Typography variant="h6" fontWeight={600}>
                    {Number(media.community_rating).toFixed(1)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('mediaDetail.hero.outOfTen')}
                  </Typography>
                </Box>
              )}
              {/* Series critic rating */}
              {isSeries(media) && media.critic_rating != null && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t('mediaDetail.hero.critic')}
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {Number(media.critic_rating).toFixed(0)}%
                  </Typography>
                </Box>
              )}
              <RatingBadges media={media} />
            </Box>
          )}

          {/* The Rotten Tomatoes consensus, which is about the scores above it
              and travelled with them. */}
          {media.rt_consensus && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mb: 1.5, fontStyle: 'italic', maxWidth: 600 }}
            >
              "{media.rt_consensus}"
            </Typography>
          )}

          {/* Awards, on the line below the scores — one sentence, not a panel. */}
          {awardsLine && (
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, maxWidth: 600 }}
            >
              <EmojiEventsIcon sx={{ color: 'warning.main', fontSize: 20, flexShrink: 0 }} />
              <Typography variant="body2" color="text.secondary">
                {awardsLine}
              </Typography>
            </Box>
          )}

          {/* Overview, with IMDb's longer synopsis available on request.
              Collapsed by default and never swapped in silently: the long plot
              is a user-submitted synopsis that narrates the whole story, so for
              anything with a twist it gives it away. Only offered when it is
              actually longer — OMDb returns the short blurb when IMDb has no
              long one, and a "read more" that reveals nothing is worse than
              no button. */}
          {(media.overview || media.plot_full) && (
            <Box sx={{ maxWidth: 600 }}>
              <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                {showFullPlot && media.plot_full ? media.plot_full : media.overview}
              </Typography>
              {hasLongerPlot && (
                <Button
                  size="small"
                  startIcon={showFullPlot ? <ExpandLessIcon /> : <NotesIcon />}
                  onClick={() => setShowFullPlot((shown) => !shown)}
                  sx={{ mt: 0.5, ml: -1, textTransform: 'none' }}
                >
                  {showFullPlot ? t('mediaDetail.hero.showShortPlot') : t('mediaDetail.hero.showFullPlot')}
                </Button>
              )}
            </Box>
          )}
        </Box>
      </Box>

      {/* Confirmation Dialog for Mark Unwatched */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('mediaDetail.hero.confirmUnwatchedTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('mediaDetail.hero.confirmUnwatchedBody', { title: media.title })}
          </DialogContentText>
          <DialogContentText sx={{ mt: 1, fontWeight: 500, color: 'warning.main' }}>
            {t('mediaDetail.hero.cannotUndo')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={marking}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleMarkUnwatched} color="error" variant="contained" disabled={marking}>
            {marking ? t('mediaDetail.hero.marking') : t('mediaDetail.hero.markUnwatched')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        message={snackbar.message}
      />

      <TrailerModal
        open={trailerModal.open}
        onClose={() => setTrailerModal({ open: false, watchUrl: null, title: null })}
        watchUrl={trailerModal.watchUrl}
        title={trailerModal.title}
      />
    </>
  )
}

