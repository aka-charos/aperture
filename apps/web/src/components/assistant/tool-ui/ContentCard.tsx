/**
 * Single content item card for Tool UI.
 *
 * Layout is two columns in both variants:
 * - a fixed-width "meta rail" — poster, then ratings and genres stacked
 *   underneath it. Those specs used to have their own rows in the text column
 *   while the space beside the poster went unused; moving them under the
 *   artwork spends the rail's dead height instead and lets the prose keep more
 *   lines at a shorter overall card height.
 * - the text column — title (with year and type), director, synopsis,
 *   "why it fits", actions.
 *
 * Two variants, same geometry:
 * - 'compact' (default): fixed-width card used in horizontal carousels
 *   (semantic "Also worth checking", library search/top-rated, etc.).
 * - 'list': full-width card used in the vertical web-search recommendations list.
 */
import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Typography,
  Button,
  Chip,
  Paper,
  IconButton,
  CircularProgress,
  Tooltip,
} from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import InfoIcon from '@mui/icons-material/Info'
import StarIcon from '@mui/icons-material/Star'
import FavoriteIcon from '@mui/icons-material/Favorite'
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined'
import MovieCreationOutlinedIcon from '@mui/icons-material/MovieCreationOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { RankBadge, getProxiedImageUrl } from '@aperture/ui'
import type { ContentItem } from './types'

interface ContentCardProps {
  item: ContentItem
  /** 'compact' = fixed-width carousel card; 'list' = full-width card. */
  variant?: 'compact' | 'list'
  onPlay?: (id: string, href: string) => void
  isFavorite?: boolean
  favoritePending?: boolean
  onToggleFavorite?: (item: ContentItem) => void
}

/** Meta rail width; the poster fills it at a 2:3 poster ratio. */
const RAIL_WIDTH = 84
const POSTER_HEIGHT = 126

// Truncate multi-line text with an ellipsis after `lines` rows.
const clampLines = (lines: number) => ({
  display: '-webkit-box',
  WebkitLineClamp: lines,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
})

/**
 * Split a card's meta line into the year and everything after it.
 *
 * Cards carry one pre-composed `subtitle` ("2018 · Action, Fantasy", sometimes
 * with a trailing segment such as "· 12 eps" or "· 3x"). Splitting it here
 * rather than sending year and genres as separate fields keeps reopened
 * conversations working: persisted messages only ever carry `subtitle`.
 */
function splitMeta(subtitle?: string): { year?: string; rest?: string } {
  if (!subtitle) return {}
  const parts = subtitle
    .split('·')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return {}
  if (!/^\d{4}$/.test(parts[0])) return { rest: subtitle }
  const rest = parts.slice(1).join(' · ')
  return { year: parts[0], rest: rest || undefined }
}

export function ContentCard({
  item,
  variant = 'compact',
  onPlay,
  isFavorite,
  favoritePending,
  onToggleFavorite,
}: ContentCardProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isList = variant === 'list'

  const detailsAction = item.actions?.find(a => a.id === 'details')
  const playAction = item.actions?.find(a => a.id === 'play')

  const { year, rest: genreLine } = splitMeta(item.subtitle)

  // One expand control per card covers both the synopsis and the reason: they
  // are the same block of prose to a reader, and two separate toggles on a
  // carousel-sized card is more chrome than text.
  const bodyRef = useRef<HTMLDivElement>(null)
  const overviewRef = useRef<HTMLSpanElement>(null)
  const reasonRef = useRef<HTMLSpanElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  // Measured, not estimated from a character count (the PersonDetail bio
  // approach): the same card renders ~600px wide in the vertical list and
  // ~200px wide in a carousel, so no single threshold fits both. Skipped while
  // expanded — nothing is clamped then, and the last known value is what keeps
  // the "show less" control on screen.
  useEffect(() => {
    if (expanded) return
    const elements = [overviewRef.current, reasonRef.current].filter(
      (element): element is HTMLSpanElement => element !== null
    )
    if (elements.length === 0) return
    const measure = () =>
      setOverflowing(elements.some((element) => element.scrollHeight > element.clientHeight + 1))
    measure()
    // The column is observed alongside the text: a clamped block that gains a
    // line of hidden content keeps the same box height, so watching the texts
    // alone would miss overflow that only appears once the panel narrows.
    const observer = new ResizeObserver(measure)
    for (const element of [...elements, bodyRef.current]) {
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [expanded, item.overview, item.reason])

  const handleDetails = () => {
    if (detailsAction?.href) {
      navigate(detailsAction.href)
    }
  }

  const handlePlay = () => {
    if (playAction?.href) {
      if (onPlay) {
        onPlay(item.id, playAction.href)
      } else {
        window.open(playAction.href, '_blank')
      }
    }
  }

  return (
    <Paper
      sx={{
        display: 'flex',
        gap: isList ? 1.75 : 1.5,
        p: isList ? 1.75 : 1.5,
        bgcolor: '#1a1a1a',
        borderRadius: 2,
        cursor: 'pointer',
        ...(isList
          ? {
              width: '100%',
              border: '1px solid transparent',
              transition: 'background-color 0.2s, border-color 0.2s',
              '&:hover': {
                bgcolor: '#212121',
                borderColor: 'rgba(99, 102, 241, 0.35)',
              },
            }
          : {
              // Wider than the text column alone needs: the rail takes fixed
              // width out of the card, so the prose would otherwise lose room.
              minWidth: 300,
              maxWidth: 340,
              transition: 'all 0.2s',
              '&:hover': {
                bgcolor: '#252525',
                transform: 'translateY(-2px)',
              },
            }),
      }}
      onClick={handleDetails}
    >
      {/* Meta rail: poster + specs */}
      <Box
        sx={{
          width: RAIL_WIDTH,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
        }}
      >
        <Box
          sx={{
            width: '100%',
            height: POSTER_HEIGHT,
            borderRadius: 1,
            overflow: 'hidden',
            bgcolor: '#2a2a2a',
            position: 'relative',
          }}
        >
          {item.image ? (
            <Box
              component="img"
              src={getProxiedImageUrl(item.image)}
              alt={item.name}
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
                color: '#666',
                fontSize: 10,
                textAlign: 'center',
                px: 0.5,
              }}
            >
              {t('assistantToolUi.noImage')}
            </Box>
          )}
          {/* Rank badge */}
          {item.rank && <RankBadge rank={item.rank} size="small" />}
        </Box>

        {/* Ratings. Community score as plain text rather than a chip: at rail
            width two pills side by side wrap onto separate rows. */}
        {(item.rating != null || item.userRating) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            {item.rating != null && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                <StarIcon sx={{ fontSize: 12, color: '#ffc107' }} />
                <Typography
                  variant="caption"
                  sx={{ color: '#ffc107', fontWeight: 600, fontSize: 11, lineHeight: 1.3 }}
                >
                  {Number(item.rating).toFixed(1)}
                </Typography>
              </Box>
            )}
            {item.userRating && (
              // Star, not a heart: the heart in the action row means "favorite",
              // and the same icon carrying two meanings on one card is what made
              // it ambiguous.
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                <StarIcon sx={{ fontSize: 12, color: '#ec4899' }} />
                <Typography
                  variant="caption"
                  sx={{ color: '#ec4899', fontWeight: 600, fontSize: 11, lineHeight: 1.3 }}
                >
                  {item.userRating}
                </Typography>
              </Box>
            )}
          </Box>
        )}

        {/* Genres (and whatever else the meta line carried — episode counts,
            play counts) */}
        {genreLine && (
          <Typography
            variant="caption"
            sx={{ color: '#71717a', fontSize: 10, lineHeight: 1.35, ...clampLines(2) }}
          >
            {genreLine}
          </Typography>
        )}
      </Box>

      {/* Text column */}
      <Box
        ref={bodyRef}
        sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}
      >
        {/* Title, year and type read as one line of identity: "Dark City (1998)
            Movie". The chip is a sibling of the clamped title rather than inline
            text inside it — inside the clamp a long title would push it onto a
            hidden third line and the movie/series marker would vanish. */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, minWidth: 0 }}>
          <Typography
            variant="body2"
            fontWeight={600}
            sx={{ color: '#fff', flex: 1, minWidth: 0, ...clampLines(2) }}
          >
            {item.name}
            {year && (
              <Box component="span" sx={{ color: '#a1a1aa', fontWeight: 400 }}>
                {' '}
                ({year})
              </Box>
            )}
          </Typography>
          <Chip
            label={item.type === 'movie' ? t('assistantToolUi.movie') : t('assistantToolUi.series')}
            size="small"
            sx={{
              flexShrink: 0,
              mt: '1px',
              height: 18,
              bgcolor: item.type === 'movie' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              color: item.type === 'movie' ? '#818cf8' : '#10b981',
              '& .MuiChip-label': { px: 0.625, fontSize: 10 },
            }}
          />
        </Box>

        {/* Director (movies) / creator (series) — the same DB column serves both */}
        {item.director && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <MovieCreationOutlinedIcon sx={{ fontSize: 12, color: '#71717a', flexShrink: 0 }} />
            <Typography variant="caption" noWrap sx={{ color: '#a1a1aa', minWidth: 0 }}>
              {item.type === 'movie'
                ? t('assistantToolUi.directedBy', { name: item.director })
                : t('assistantToolUi.createdBy', { name: item.director })}
            </Typography>
          </Box>
        )}

        {/* Synopsis + "why it fits".
            Rendered in BOTH variants: the secondary "Also worth checking" carousel
            used to be a row of bare cards sitting next to fully explained ones. */}
        {item.overview && (
          <Typography
            ref={overviewRef}
            variant="caption"
            sx={{
              color: '#a1a1aa',
              lineHeight: 1.45,
              ...(expanded ? {} : clampLines(isList ? 4 : 3)),
            }}
          >
            {item.overview}
          </Typography>
        )}
        {item.reason && (
          <Box
            sx={{
              display: 'flex',
              gap: 0.75,
              mt: 0.25,
              p: 1,
              borderRadius: 1,
              bgcolor: 'rgba(99, 102, 241, 0.08)',
              borderInlineStart: '2px solid #6366f1',
            }}
          >
            <LightbulbOutlinedIcon sx={{ fontSize: 15, color: '#818cf8', flexShrink: 0, mt: '1px' }} />
            <Typography
              ref={reasonRef}
              variant="caption"
              sx={{ color: '#c7c7d1', lineHeight: 1.45, ...(expanded ? {} : clampLines(3)) }}
            >
              {item.reason}
            </Typography>
          </Box>
        )}

        {/* Disclosure, shown only once something is actually cut off. */}
        {(overflowing || expanded) && (
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((prev) => !prev)
            }}
            endIcon={
              <ExpandMoreIcon
                sx={{
                  fontSize: 14,
                  transition: 'transform 0.2s',
                  transform: expanded ? 'rotate(180deg)' : 'none',
                }}
              />
            }
            sx={{
              alignSelf: 'flex-start',
              minWidth: 0,
              px: 0.5,
              py: 0,
              fontSize: 11,
              textTransform: 'none',
              color: '#818cf8',
              '&:hover': { bgcolor: 'rgba(99, 102, 241, 0.1)' },
            }}
          >
            {expanded ? t('assistantToolUi.showLess') : t('assistantToolUi.showMore')}
          </Button>
        )}

        {/* Action buttons */}
        <Box sx={{ display: 'flex', gap: 1, mt: 'auto', pt: 1 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<InfoIcon sx={{ fontSize: 14 }} />}
            onClick={(e) => {
              e.stopPropagation()
              handleDetails()
            }}
            sx={{
              minWidth: 0,
              px: 1,
              py: 0.25,
              fontSize: 11,
              borderColor: '#3a3a3a',
              color: '#a1a1aa',
              '&:hover': {
                borderColor: '#6366f1',
                bgcolor: 'rgba(99, 102, 241, 0.1)',
              },
            }}
          >
            {t('assistantToolUi.details')}
          </Button>
          {playAction && (
            <Button
              size="small"
              variant="contained"
              startIcon={<PlayArrowIcon sx={{ fontSize: 14 }} />}
              onClick={(e) => {
                e.stopPropagation()
                handlePlay()
              }}
              sx={{
                minWidth: 0,
                px: 1,
                py: 0.25,
                fontSize: 11,
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                '&:hover': {
                  background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                },
              }}
            >
              {t('assistantToolUi.play')}
            </Button>
          )}

          {/* Favorite toggle. In the action row rather than floating on the
              poster: as a 16px outline in the artwork's corner it read as part
              of the image and went unnoticed. */}
          {onToggleFavorite && (
            <Tooltip
              title={
                isFavorite
                  ? t('assistantToolUi.removeFavorite')
                  : t('assistantToolUi.favorite')
              }
            >
              <Box component="span" sx={{ marginInlineStart: 'auto' }}>
                <IconButton
                  size="small"
                  disabled={favoritePending}
                  aria-label={
                    isFavorite
                      ? t('assistantToolUi.removeFavorite')
                      : t('assistantToolUi.favorite')
                  }
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleFavorite(item)
                  }}
                  sx={{
                    p: 0.5,
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: isFavorite ? 'rgba(236, 72, 153, 0.5)' : '#3a3a3a',
                    bgcolor: isFavorite ? 'rgba(236, 72, 153, 0.12)' : 'transparent',
                    '&:hover': {
                      borderColor: '#ec4899',
                      bgcolor: 'rgba(236, 72, 153, 0.18)',
                    },
                  }}
                >
                  {favoritePending ? (
                    <CircularProgress size={15} sx={{ color: '#ec4899' }} />
                  ) : isFavorite ? (
                    <FavoriteIcon sx={{ fontSize: 15, color: '#ec4899' }} />
                  ) : (
                    <FavoriteBorderIcon sx={{ fontSize: 15, color: '#a1a1aa' }} />
                  )}
                </IconButton>
              </Box>
            </Tooltip>
          )}
        </Box>
      </Box>
    </Paper>
  )
}
