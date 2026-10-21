/**
 * Single content item card for Tool UI.
 *
 * Two variants, two geometries:
 * - 'compact' (default): fixed-width card used in horizontal carousels
 *   ("Also worth checking", "From your taste profile", library search, etc.).
 *   Two columns: a fixed-width "meta rail" (poster, then ratings and genres
 *   under it, spending the rail's dead height) and the text column (title with
 *   year and type, director, synopsis, "why it fits", actions). The carousel
 *   makes every card in a row the same height, so this one grows to whatever
 *   its text needs and the row follows the tallest.
 * - 'list': fluid card used in the recommendation grids (web search, the
 *   user's own AI recommendations, and any section shown in a tab). Three
 *   bands: the poster with the title, director and synopsis beside it, the
 *   synopsis cut where the poster ends; the reason across the full width; and
 *   one row holding Details, the rating, genres, type and the heart. A column
 *   beside the poster that ran on past it left the reason squeezed into the
 *   narrow column for no reason, with empty space under the artwork.
 *
 * Only an episode card has a Play action: for a film or show, Details opens the
 * title page and playing starts there.
 *
 * The SYNOPSIS is the only clamped text, in both variants — it exists in full on
 * the detail page, so a disclosure costs the reader nothing. The "why it fits"
 * is never clamped anywhere: it is the only text on the card with no second
 * home, and hiding it behind a control means reading a row of six picks one
 * expansion at a time.
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
import { alpha, useTheme } from '@mui/material/styles'
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
import { RankBadge, WatchedBadge, getProxiedImageUrl } from '@aperture/ui'
import { useMediaDetailModal } from '@/hooks/useMediaDetailModal'
import { COMPACT_THREAD, chatText } from '../density'
import type { ContentItem } from './types'

interface ContentCardProps {
  item: ContentItem
  /** 'compact' = fixed-width carousel card; 'list' = fluid grid card. */
  variant?: 'compact' | 'list'
  isFavorite?: boolean
  favoritePending?: boolean
  onToggleFavorite?: (item: ContentItem) => void
}

/** Compact (carousel) meta rail width; the poster fills it at a 2:3 ratio. */
const RAIL_WIDTH = 84
const POSTER_HEIGHT = 126

/**
 * List card poster, also 2:3. It is larger than the rail's because it sets the
 * height of the block beside it: the title, the director and the synopsis share
 * the poster's height, and the synopsis is cut where the poster ends.
 */
const LIST_POSTER_WIDTH = 100
const LIST_POSTER_HEIGHT = 150
/**
 * Carousel cards are a fixed width everywhere, so their clamp can be fixed too.
 *
 * The SYNOPSIS is the only thing clamped on a card, in either variant. It is
 * available in full on the detail page and on the poster grids, so cutting it
 * costs a reader nothing they cannot get elsewhere — which is exactly what is
 * not true of the reason (see where it is rendered).
 */
const COMPACT_OVERVIEW_LINES = 3

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
  isFavorite,
  favoritePending,
  onToggleFavorite,
}: ContentCardProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const theme = useTheme()
  const isList = variant === 'list'

  const detailsAction = item.actions?.find(a => a.id === 'details')
  // Details covers playback for a film or a show: the title page it opens has
  // the media server's Play button. An episode is the exception — Details opens
  // its show, not the episode — so its card keeps a direct Play.
  const episodePlayAction = item.episode ? item.actions?.find(a => a.id === 'play') : undefined

  const { year, rest: genreLine } = splitMeta(item.subtitle)

  // One expand control per card, and it now covers the synopsis alone in both
  // variants — the reason is never clamped, so there is nothing else for it to
  // reveal.
  const bodyRef = useRef<HTMLDivElement>(null)
  const overviewRef = useRef<HTMLSpanElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const [listOverviewLines, setListOverviewLines] = useState(3)
  const overviewLines = isList ? listOverviewLines : COMPACT_OVERVIEW_LINES

  // Measured, not estimated from a character count (the PersonDetail bio
  // approach): how much room is left depends on how many lines the title
  // wrapped to and whether there is a director line, which only the rendered
  // card knows. Skipped while expanded — nothing is clamped then, and the last
  // known value is what keeps the "show less" control on screen.
  useEffect(() => {
    if (expanded) return
    const overview = overviewRef.current
    if (!overview) return
    const measure = () => {
      // A card in a hidden tab has no layout: every offset and height reads 0,
      // which would clamp as if the synopsis started at the poster's top. The
      // observer fires again when the tab is shown, and measures then.
      if (overview.offsetParent === null) return
      if (isList) {
        // A list card's synopsis ends at the poster's bottom edge: as many
        // whole lines as fit below where it starts, none when a long title
        // and the director already reach it (Show more still offers it).
        // `offsetTop` is measured from the text column, which is positioned
        // for exactly this.
        const lineHeight = Number.parseFloat(getComputedStyle(overview).lineHeight)
        if (lineHeight > 0) {
          const room = LIST_POSTER_HEIGHT - overview.offsetTop
          setListOverviewLines(Math.max(0, Math.floor(room / lineHeight)))
        }
      }
      // Read against the clamp that is currently applied, which on a width
      // change is still the previous one. Settling it takes a second pass:
      // a new line count changes the block's own height, so the observer
      // below fires again and this runs once more with the final clamp.
      setOverflowing(overview.scrollHeight > overview.clientHeight + 1)
    }
    measure()
    // The column is observed alongside the text: a clamped block that gains a
    // line of hidden content keeps the same box height, so watching the text
    // alone would miss overflow that only appears once the panel narrows.
    const observer = new ResizeObserver(measure)
    for (const element of [overview, bodyRef.current]) {
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [expanded, isList, item.overview])

  // Chat surfaces that own the whole viewport open the item here instead of
  // routing, so the conversation and its scroll position survive a look at a
  // pick. Docked chat has no opener and routes the main pane as before.
  const openMediaDetail = useMediaDetailModal()

  const handleDetails = () => {
    if (!detailsAction?.href) return
    if (openMediaDetail) {
      // An episode card's `id` is the episode (the carousel keys on it), and no
      // detail view takes one — the parent show is the destination.
      openMediaDetail(item.type, item.episode?.seriesId ?? item.id)
      return
    }
    navigate(detailsAction.href)
  }

  const typeLabel = item.episode
    ? t('assistantToolUi.episode')
    : item.type === 'movie'
      ? t('assistantToolUi.movie')
      : t('assistantToolUi.series')

  const poster = (width: number | string, height: number) => (
    <Box
      sx={{
        width,
        height,
        flexShrink: 0,
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: theme.palette.divider,
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
            color: 'text.disabled',
            fontSize: chatText(10),
            textAlign: 'center',
            px: 0.5,
          }}
        >
          {t('assistantToolUi.noImage')}
        </Box>
      )}
      {/* Rank badge */}
      {item.rank && <RankBadge rank={item.rank} size="small" />}
      {/* Watched marker. `=== true` on purpose: the field is absent when the
          tool never looked it up, and "unknown" must not render as "not
          watched". Top-right, out of the rank badge's corner — the two used
          to be drawn on top of each other. */}
      {item.watched === true && (
        <WatchedBadge label={t('assistantToolUi.watched')} size={18} sx={{ top: 4, insetInlineEnd: 4 }} />
      )}
    </Box>
  )

  // Ratings. Community score as plain text rather than a chip: at rail width
  // two pills side by side wrap onto separate rows.
  const ratings = (item.rating != null || item.userRating) && (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', flexShrink: 0 }}>
      {item.rating != null && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <StarIcon sx={{ fontSize: 12, color: '#ffc107' }} />
          <Typography
            variant="caption"
            sx={{ color: '#ffc107', fontWeight: 600, fontSize: chatText(11), lineHeight: 1.3 }}
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
            sx={{ color: '#ec4899', fontWeight: 600, fontSize: chatText(11), lineHeight: 1.3 }}
          >
            {item.userRating}
          </Typography>
        </Box>
      )}
    </Box>
  )

  const typeChip = (
    <Chip
      label={typeLabel}
      size="small"
      sx={{
        flexShrink: 0,
        height: 18,
        bgcolor: item.type === 'movie' ? alpha(theme.palette.primary.main, 0.15) : alpha(theme.palette.mediaType.series, 0.15),
        color: item.type === 'movie' ? theme.palette.mediaType.movie : theme.palette.mediaType.series,
        '& .MuiChip-label': { px: 0.625, fontSize: chatText(10) },
      }}
    />
  )

  const title = (
    <Typography
      variant="body2"
      fontWeight={600}
      sx={{ color: 'text.primary', flex: 1, minWidth: 0, ...clampLines(2) }}
    >
      {item.name}
      {year && (
        <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>
          {' '}
          ({year})
        </Box>
      )}
    </Typography>
  )

  // Director (movies) / creator (series) — the same DB column serves both
  const director = item.director && (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <MovieCreationOutlinedIcon sx={{ fontSize: 12, color: 'text.secondary', flexShrink: 0 }} />
      <Typography variant="caption" noWrap sx={{ color: 'text.secondary', minWidth: 0 }}>
        {item.type === 'movie'
          ? t('assistantToolUi.directedBy', { name: item.director })
          : t('assistantToolUi.createdBy', { name: item.director })}
      </Typography>
    </Box>
  )

  // Synopsis. Rendered in BOTH variants: the secondary "Also worth checking"
  // carousel used to be a row of bare cards sitting next to fully explained ones.
  const overview = item.overview && (
    <Typography
      ref={overviewRef}
      variant="caption"
      sx={{
        color: 'text.secondary',
        lineHeight: 1.45,
        // `line-clamp: 0` is not a clamp at all, so no room is a zero height.
        ...(expanded ? {} : overviewLines > 0 ? clampLines(overviewLines) : { maxHeight: 0, overflow: 'hidden' }),
      }}
    >
      {item.overview}
    </Typography>
  )

  const reason = item.reason && (
    <Box
      sx={{
        display: 'flex',
        gap: 0.75,
        mt: 0.25,
        p: 1,
        [COMPACT_THREAD]: { p: 0.75 },
        borderRadius: 1,
        bgcolor: alpha(theme.palette.primary.main, 0.08),
        borderInlineStart: `2px solid ${theme.palette.primary.main}`,
      }}
    >
      <LightbulbOutlinedIcon sx={{ fontSize: 15, color: theme.palette.primary.light, flexShrink: 0, mt: '1px' }} />
      <Typography
        variant="caption"
        sx={{
          // From the theme, never a hex: the old light grey was a dark-theme
          // value and vanished on the light theme's pale tint.
          color: alpha(theme.palette.text.primary, 0.85),
          lineHeight: 1.45,
          // NEVER clamped, in either variant. It runs one or two
          // model-written sentences, it is the only text on the card that
          // exists nowhere else in the app — no detail page, no grid, no
          // second chance — and it is the whole reason the card is in
          // front of this reader rather than some other card.
          //
          // It was clamped to three lines on carousel cards, which cut
          // most of them, so reading why a row of six films was picked
          // meant expanding six cards one at a time. A disclosure is
          // right for a synopsis you can go and read elsewhere; for the
          // only copy of something it is just a lock on the answer.
          //
          // The card grows instead. `MAX_REASON_CHARS` (320, server side)
          // is what bounds that, so the worst case is a known one.
        }}
      >
        {item.reason}
      </Typography>
    </Box>
  )

  // Disclosure, shown only once something is actually cut off.
  const disclosure = (overflowing || expanded) && (
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
        fontSize: chatText(11),
        textTransform: 'none',
        color: theme.palette.primary.light,
        '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.1) },
      }}
    >
      {expanded ? t('assistantToolUi.showLess') : t('assistantToolUi.showMore')}
    </Button>
  )

  const detailsButton = (
    <Button
      size="small"
      variant="outlined"
      startIcon={<InfoIcon sx={{ fontSize: 14 }} />}
      onClick={(e) => {
        e.stopPropagation()
        handleDetails()
      }}
      sx={{
        flexShrink: 0,
        minWidth: 0,
        px: 1,
        py: 0.25,
        fontSize: chatText(11),
        borderColor: theme.palette.surface.subtleBorder,
        color: 'text.secondary',
        '&:hover': {
          borderColor: theme.palette.primary.main,
          bgcolor: alpha(theme.palette.primary.main, 0.1),
        },
      }}
    >
      {t('assistantToolUi.details')}
    </Button>
  )

  const playButton = episodePlayAction?.href && (
    <Button
      size="small"
      variant="contained"
      startIcon={<PlayArrowIcon sx={{ fontSize: 14 }} />}
      href={episodePlayAction.href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      sx={{
        flexShrink: 0,
        minWidth: 0,
        px: 1,
        py: 0.25,
        fontSize: chatText(11),
        background: theme.palette.gradient.primaryToSecondary,
        '&:hover': {
          background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.secondary.dark} 100%)`,
        },
      }}
    >
      {t('assistantToolUi.play')}
    </Button>
  )

  // Favorite toggle. In the action row rather than floating on the poster: as
  // a 16px outline in the artwork's corner it read as part of the image and
  // went unnoticed.
  const favoriteButton = onToggleFavorite && (
    <Tooltip title={isFavorite ? t('assistantToolUi.removeFavorite') : t('assistantToolUi.favorite')}>
      <Box component="span" sx={{ marginInlineStart: 'auto', flexShrink: 0 }}>
        <IconButton
          size="small"
          disabled={favoritePending}
          aria-label={isFavorite ? t('assistantToolUi.removeFavorite') : t('assistantToolUi.favorite')}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorite(item)
          }}
          sx={{
            p: 0.5,
            borderRadius: 1,
            border: '1px solid',
            borderColor: isFavorite ? 'rgba(236, 72, 153, 0.5)' : theme.palette.surface.subtleBorder,
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
            <FavoriteBorderIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
          )}
        </IconButton>
      </Box>
    </Tooltip>
  )

  // The surface both variants share. Their hover differs on purpose: a list
  // card is a grid cell and lifts nothing, a carousel card lifts out of its row.
  const surfaceSx = {
    bgcolor: theme.palette.background.paper,
    borderRadius: 2,
    cursor: 'pointer',
  }

  if (isList) {
    // List card, three bands:
    // - the poster with the identity and the synopsis beside it, the synopsis
    //   cut at the poster's bottom edge so the two end on one line;
    // - the reason across the whole card, never clamped;
    // - one row of facts and actions: Details, rating, genres, type, heart.
    return (
      <Paper
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
          p: 1.75,
          width: '100%',
          // A compact thread is narrow enough to hold one card per row, so
          // there its padding is the difference between reading two cards
          // at a time and reading one.
          [COMPACT_THREAD]: { p: 1.25, gap: 1 },
          ...surfaceSx,
          border: '1px solid transparent',
          transition: 'background-color 0.2s, border-color 0.2s',
          '&:hover': {
            bgcolor: theme.palette.surface.raised,
            borderColor: alpha(theme.palette.primary.main, 0.35),
          },
        }}
        onClick={handleDetails}
      >
        <Box sx={{ display: 'flex', gap: 1.75, alignItems: 'flex-start', [COMPACT_THREAD]: { gap: 1.25 } }}>
          {poster(LIST_POSTER_WIDTH, LIST_POSTER_HEIGHT)}
          <Box
            ref={bodyRef}
            sx={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5,
              // The synopsis clamp is measured from here.
              position: 'relative',
            }}
          >
            {title}
            {director}
            {overview}
            {/* Right after the synopsis it controls, which puts it just
                under the poster line, in the synopsis's own column. */}
            {disclosure}
          </Box>
        </Box>

        {reason}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 'auto' }}>
          {detailsButton}
          {playButton}
          {ratings}
          {genreLine && (
            <Typography
              variant="caption"
              noWrap
              sx={{ color: 'text.secondary', fontSize: chatText(11), minWidth: 0, flexShrink: 1 }}
            >
              {genreLine}
            </Typography>
          )}
          {typeChip}
          {favoriteButton}
        </Box>
      </Paper>
    )
  }

  return (
    <Paper
      sx={{
        display: 'flex',
        gap: 1.5,
        p: 1.5,
        ...surfaceSx,
        // Wider than the text column alone needs: the rail takes fixed
        // width out of the card, so the prose would otherwise lose room.
        minWidth: 300,
        maxWidth: 340,
        transition: 'all 0.2s',
        '&:hover': {
          bgcolor: theme.palette.surface.raisedHover,
          transform: 'translateY(-2px)',
        },
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
        {poster('100%', POSTER_HEIGHT)}
        {ratings}
        {/* Genres (and whatever else the meta line carried — episode counts,
            play counts) */}
        {genreLine && (
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', fontSize: chatText(10), lineHeight: 1.35, ...clampLines(2) }}
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
          {title}
          <Box sx={{ mt: '1px', display: 'flex' }}>{typeChip}</Box>
        </Box>
        {director}
        {overview}
        {reason}
        {disclosure}

        {/* Action buttons */}
        <Box sx={{ display: 'flex', gap: 1, mt: 'auto', pt: 1, [COMPACT_THREAD]: { pt: 0.75 } }}>
          {detailsButton}
          {playButton}
          {favoriteButton}
        </Box>
      </Box>
    </Paper>
  )
}
