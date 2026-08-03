import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Card,
  CardMedia,
  CardContent,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  CircularProgress,
  Skeleton,
  alpha,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import AddIcon from '@mui/icons-material/Add'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import StarIcon from '@mui/icons-material/Star'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { RankBadge } from '@aperture/ui'
import { Link } from 'react-router-dom'

const FALLBACK_POSTER = '/NO_POSTER_FOUND.png'

export interface SeerrStatus {
  requested: boolean
  requestStatus?: 'pending' | 'approved' | 'declined' | 'unknown'
}

export interface Genre {
  id: number
  name: string
}

export interface MediaPosterCardProps {
  tmdbId: number
  title: string
  year?: number | null
  posterUrl?: string | null
  rank?: number
  mediaType: 'movie' | 'series'

  // Library status
  inLibrary?: boolean
  libraryId?: string | null // For linking to detail page
  /** When false, hide the lower-left "In library" chip (hover overlay unchanged; dimming / link unchanged) */
  showInLibraryCornerBadge?: boolean

  // Seerr status
  seerrStatus?: SeerrStatus
  canRequest?: boolean
  isRequesting?: boolean
  onRequest?: () => void

  // Optional extras (for Discovery page / rich display)
  sourceLabel?: string
  sourceColor?: string
  matchScore?: number
  overview?: string | null
  voteAverage?: number | null
  genres?: Genre[]

  // Detail popper support
  onShowDetails?: () => void

  // Click behavior
  onClick?: () => void

  /** Fixed-height title/year block (e.g. person credits carousels) so movie vs TV rows align */
  compactMeta?: boolean
}

export function MediaPosterCard({
  tmdbId,
  title,
  year,
  posterUrl,
  rank,
  mediaType,
  inLibrary = false,
  showInLibraryCornerBadge: _showInLibraryCornerBadge = true,
  libraryId,
  seerrStatus,
  canRequest = false,
  isRequesting = false,
  onRequest,
  sourceLabel,
  sourceColor,
  matchScore,
  overview,
  voteAverage,
  genres,
  onShowDetails,
  onClick,
  compactMeta = false,
}: MediaPosterCardProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const [imageError, setImageError] = useState(false)

  const finalPosterUrl = posterUrl && !imageError ? posterUrl : FALLBACK_POSTER
  const isRequested = seerrStatus?.requested || false
  const requestStatus = seerrStatus?.requestStatus

  // Greyed out: in library (owned / not requestable) or pending Seerr request
  const isGreyedOut = inLibrary || (isRequested && !inLibrary)

  const handleRequest = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!isRequesting && !isRequested && canRequest && onRequest) {
      onRequest()
    }
  }

  const handleCardClick = (e: React.MouseEvent) => {
    if (onClick) {
      e.preventDefault()
      onClick()
    }
  }

  // Build the detail link for library items
  const detailPath = inLibrary && libraryId
    ? mediaType === 'movie' ? `/movies/${libraryId}` : `/series/${libraryId}`
    : undefined

  // TMDb link for non-library items
  const tmdbUrl = mediaType === 'movie'
    ? `https://www.themoviedb.org/movie/${tmdbId}`
    : `https://www.themoviedb.org/tv/${tmdbId}`

  // Determine if we should show extended info (overview, genres, etc.)
  const showExtendedInfo = overview !== undefined || voteAverage !== undefined || genres !== undefined

  // Explicit request control rendered in the card's action area. This replaces
  // the old full-poster hover overlay, whose click-through scrim made a poster
  // click ambiguous (it opened details while still showing a big "Request"
  // button). Now a poster click always opens details, and requesting is a
  // discrete button — same model as the list view.
  const showRequestButton = !inLibrary && canRequest && !!onRequest
  const requestButton = showRequestButton ? (
    <Tooltip
      title={
        isRequested
          ? requestStatus === 'declined'
            ? t('discovery.requestStatusDeclined')
            : t('discovery.requestStatusRequested')
          : t('mediaPoster.request')
      }
    >
      <span>
        <IconButton
          size="small"
          aria-label={t('mediaPoster.request')}
          onClick={handleRequest}
          disabled={isRequesting || isRequested}
          sx={{ p: 0.5, color: isRequested ? 'text.secondary' : 'primary.main' }}
        >
          {isRequesting ? (
            <CircularProgress size={16} />
          ) : isRequested ? (
            requestStatus === 'approved' ? (
              <CheckCircleIcon sx={{ fontSize: 16 }} />
            ) : (
              <HourglassEmptyIcon sx={{ fontSize: 16 }} />
            )
          ) : (
            <AddIcon sx={{ fontSize: 16 }} />
          )}
        </IconButton>
      </span>
    </Tooltip>
  ) : null

  const cardContent = (
    <Card
      sx={{
        position: 'relative',
        borderRadius: 2,
        overflow: 'hidden',
        backgroundColor: 'background.paper',
        transition: 'transform 0.2s, box-shadow 0.2s, opacity 0.2s',
        cursor: inLibrary ? 'default' : 'pointer',
        opacity: isGreyedOut ? 0.6 : 1,
        height: compactMeta ? 'auto' : '100%',
        display: 'flex',
        flexDirection: 'column',
        '&:hover': {
          transform: inLibrary ? 'none' : 'translateY(-4px)',
          boxShadow: (theme) =>
            inLibrary ? undefined : `0 12px 24px ${alpha(theme.palette.common.black, 0.3)}`,
        },
      }}
      onClick={handleCardClick}
    >
      {/* Poster */}
      <Box sx={{ position: 'relative', aspectRatio: '2/3' }}>
        <CardMedia
          component="img"
          image={finalPosterUrl}
          alt={title}
          onError={() => setImageError(true)}
          sx={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: isGreyedOut ? 'grayscale(80%)' : 'none',
            transition: 'filter 0.2s',
          }}
        />

        {/* Fallback icon when no poster */}
        {imageError && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'action.hover',
            }}
          >
            {mediaType === 'movie' ? (
              <MovieIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
            ) : (
              <TvIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
            )}
          </Box>
        )}

        {/* Rank Badge */}
        {rank !== undefined && <RankBadge rank={rank} size="medium" />}

        {/* Community rating badge - top right (below the source chip when both show).
            These covers come from TMDb, never from library artwork, so the badge is
            not gated by the hide-poster-rating preference. */}
        {voteAverage != null && voteAverage > 0 && (
          <Chip
            icon={<StarIcon fontSize="small" />}
            label={voteAverage.toFixed(1)}
            size="small"
            sx={{
              position: 'absolute',
              top: sourceLabel ? 36 : 8,
              right: 8,
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              color: 'warning.main',
              fontWeight: 600,
              fontSize: '0.7rem',
              height: 24,
              '& .MuiChip-icon': {
                color: 'warning.main',
              },
            }}
          />
        )}

        {/* Source Chip (for Discovery) */}
        {sourceLabel && (
          <Chip
            label={sourceLabel}
            size="small"
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              backgroundColor: alpha(sourceColor || theme.palette.primary.main, 0.9),
              color: 'white',
              fontWeight: 600,
              fontSize: '0.7rem',
              height: 22,
            }}
          />
        )}

        {/* Match Score (for Discovery) */}
        {matchScore !== undefined && (
          <Box
            sx={{
              position: 'absolute',
              bottom: 8,
              right: 8,
              backgroundColor: alpha('#000', 0.75),
              borderRadius: 1,
              px: 1,
              py: 0.5,
            }}
          >
            <Typography variant="caption" fontWeight={600} color="white">
              {t('mediaPoster.matchPercent', { pct: (matchScore * 100).toFixed(0) })}
            </Typography>
          </Box>
        )}

        {/* In Library Badge */}
        {inLibrary && (
          <Box
            sx={{
              position: 'absolute',
              bottom: 8,
              left: 8,
              backgroundColor: alpha(theme.palette.success.main, 0.9),
              borderRadius: 1,
              px: 1,
              py: 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            <CheckCircleIcon sx={{ fontSize: 14, color: 'white' }} />
            <Typography variant="caption" fontWeight={600} color="white">
              {t('mediaPoster.inLibrary')}
            </Typography>
          </Box>
        )}

        {/* Already Requested Badge (for non-library items) */}
        {!inLibrary && isRequested && (
          <Box
            sx={{
              position: 'absolute',
              bottom: 8,
              left: 8,
              backgroundColor: requestStatus === 'declined'
                ? alpha(theme.palette.error.main, 0.9)
                : alpha(theme.palette.secondary.main, 0.9), // Aperture purple for requested/pending/approved
              borderRadius: 1,
              px: 1,
              py: 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            <HourglassEmptyIcon sx={{ fontSize: 14, color: 'white' }} />
            <Typography variant="caption" fontWeight={600} color="white">
              {requestStatus === 'declined'
                ? t('discovery.requestStatusDeclined')
                : t('discovery.requestStatusRequested')}
            </Typography>
          </Box>
        )}

      </Box>

      {/* Info */}
      <CardContent
        sx={{
          flexGrow: compactMeta ? 0 : 1,
          flexShrink: 0,
          p: 1.5,
          ...(compactMeta && {
            minHeight: 88,
            maxHeight: 88,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            boxSizing: 'border-box',
          }),
        }}
      >
        <Typography
          variant="subtitle2"
          fontWeight={600}
          noWrap={!compactMeta}
          sx={{
            lineHeight: compactMeta ? 1.25 : 1.3,
            mb: 0.5,
            color: isGreyedOut ? 'text.disabled' : 'text.primary',
            ...(compactMeta && {
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }),
          }}
          title={title}
        >
          {title}
        </Typography>
        
        {/* Extended info row with year, rating, and action buttons */}
        {showExtendedInfo ? (
          <>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Typography variant="caption" color="text.secondary">
                {year || t('mediaPoster.tba')}
              </Typography>
              <Box display="flex" alignItems="center" gap={0.5}>
                {requestButton}
                {onShowDetails && (
                  <Tooltip title={t('mediaPoster.viewDetails')}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        onShowDetails()
                      }}
                      sx={{ p: 0.5 }}
                    >
                      <InfoOutlinedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title={t('mediaPoster.viewOnTmdb')}>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      window.open(tmdbUrl, '_blank')
                    }}
                    sx={{ p: 0.5 }}
                  >
                    <OpenInNewIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
            {overview ? (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  lineHeight: 1.4,
                  mt: 0.5,
                }}
              >
                {overview}
              </Typography>
            ) : genres && genres.filter(g => g.name).length > 0 ? (
              <Typography variant="caption" color="text.secondary" noWrap display="block" mt={0.5}>
                {genres.filter(g => g.name).slice(0, 3).map(g => g.name).join(' • ')}
              </Typography>
            ) : genres && genres.length > 0 ? (
              <Skeleton variant="text" width="70%" sx={{ mt: 0.5 }} />
            ) : null}
          </>
        ) : (
          <Box display="flex" alignItems="center" justifyContent="space-between" gap={0.5}>
            <Typography variant="caption" color="text.secondary" noWrap>
              {year || t('mediaPoster.unknownYear')}
            </Typography>
            {requestButton}
          </Box>
        )}
      </CardContent>
    </Card>
  )

  // Wrap in Link for library items, otherwise just return the card
  if (detailPath) {
    return (
      <Link to={detailPath} style={{ textDecoration: 'none', display: 'block', height: '100%' }}>
        {cardContent}
      </Link>
    )
  }

  // For non-library items, clicking opens TMDb (unless custom onClick provided)
  if (!onClick) {
    return (
      <Box
        component="a"
        href={tmdbUrl}
        target="_blank"
        rel="noopener noreferrer"
        sx={{ textDecoration: 'none', display: 'block', height: '100%' }}
      >
        {cardContent}
      </Box>
    )
  }

  return cardContent
}
