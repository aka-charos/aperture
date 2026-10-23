/**
 * Single content item card for Tool UI.
 *
 * Two variants, two geometries:
 * - 'compact' (default): fixed-width card used in horizontal carousels
 *   ("Also worth checking", "From your taste profile", library search, etc.).
 *   Two columns: a fixed-width "meta rail" (poster, then ratings and genres
 *   under it, spending the rail's dead height) and the text column (title with
 *   year, director, synopsis, "why it fits", actions). The carousel
 *   makes every card in a row the same height, so this one grows to whatever
 *   its text needs and the row follows the tallest.
 * - 'list': fluid card used in the recommendation grids (web search, the
 *   user's own AI recommendations, and any section shown in a tab). Three
 *   bands: the poster with the title, year, rating and synopsis beside it, the
 *   synopsis cut where the poster ends; the reason across nearly the full
 *   width; and one row holding the director, genres and the heart. A column
 *   beside the poster that ran on past it left the reason squeezed into the
 *   narrow column for no reason, with empty space under the artwork.
 *
 * There is no Details button: the card, its title and the "More ›" that ends a
 * cut synopsis all open the title page, where playing starts. Only an episode
 * card has a Play action, since the title page it opens is its show's.
 *
 * The SYNOPSIS is the only clamped text, in both variants — it exists in full on
 * the detail page, which the card itself opens, so it is cut short on
 * "… More ›" and never expanded in place. The "why it fits"
 * is never clamped anywhere: it is the only text on the card with no second
 * home, and hiding it behind a control means reading a row of six picks one
 * expansion at a time.
 */
import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
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
import { alpha, darken, useTheme } from '@mui/material/styles'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StarIcon from '@mui/icons-material/Star'
import FavoriteIcon from '@mui/icons-material/Favorite'
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined'
import MovieCreationOutlinedIcon from '@mui/icons-material/MovieCreationOutlined'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { RankBadge, WatchedBadge, getProxiedImageUrl } from '@aperture/ui'
import { useMediaDetailModal } from '@/hooks/useMediaDetailModal'
import { COMPACT_THREAD, chatText } from '../density'
import { fitSynopsis } from './synopsisFit'
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

/** The app's colour for the viewer's own rating, shared with the stats pages. */
const OWN_RATING_PINK = '#ec4899'
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
  // Opening the card covers playback for a film or a show: the title page has
  // the media server's Play button. An episode is the exception — the card
  // opens its show, not the episode — so it keeps a direct Play.
  const episodePlayAction = item.episode ? item.actions?.find(a => a.id === 'play') : undefined

  const { year, rest: genreLine } = splitMeta(item.subtitle)

  // The synopsis is never expanded in place. A cut one ends on "… More ›",
  // which opens the title's detail view, where the whole of it is.
  const bodyRef = useRef<HTMLDivElement>(null)
  const overviewRef = useRef<HTMLParagraphElement>(null)
  const [overviewLines, setOverviewLines] = useState(isList ? 3 : COMPACT_OVERVIEW_LINES)
  /** Characters shown before "… More ›"; null when the whole synopsis fits. */
  const [overviewCut, setOverviewCut] = useState<number | null>(null)
  const moreLabel = `${t('assistantToolUi.moreLink')} ${theme.direction === 'rtl' ? '‹' : '›'}`

  // A list card's synopsis ends at the poster's bottom edge: as many whole
  // lines as fit below where it starts, none when a long title already
  // reaches it. Measured rather than estimated, since how much room is left
  // depends on how many lines the title wrapped to, which only the rendered
  // card knows. `offsetTop` is read from the text column, which is positioned
  // for exactly this.
  // Before paint, or every card would first draw at the default line count
  // and snap to its measured one a frame later.
  //
  // Both variants then cut the synopsis themselves rather than with CSS
  // line-clamp, which can only end on a bare ellipsis: the cut leaves room for
  // "… More ›" on the last line (`fitSynopsis`).
  useLayoutEffect(() => {
    const overview = overviewRef.current
    const text = item.overview
    if (!overview || !text) return
    let cancelled = false
    const measure = () => {
      // A card in a hidden tab has no layout: every offset and height reads 0,
      // which would clamp as if the synopsis started at the poster's top. The
      // observer fires again when the tab is shown, and measures then.
      if (cancelled || overview.offsetParent === null) return
      let lines = COMPACT_OVERVIEW_LINES
      if (isList) {
        const lineHeight = Number.parseFloat(getComputedStyle(overview).lineHeight)
        if (!(lineHeight > 0)) return
        lines = Math.max(0, Math.floor((LIST_POSTER_HEIGHT - overview.offsetTop) / lineHeight))
      }
      setOverviewLines(lines)
      setOverviewCut(lines > 0 ? fitSynopsis(text, overview, lines, `… ${moreLabel}`, '600') : null)
    }
    measure()
    // The column is observed: a narrower column rewraps the title, which moves
    // where the synopsis starts, and rewraps the synopsis itself.
    const observer = new ResizeObserver(measure)
    if (bodyRef.current) observer.observe(bodyRef.current)
    // A web font arriving late changes every width the cut was made against.
    void document.fonts?.ready.then(measure)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [isList, item.overview, moreLabel])

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
        // Square: rounded corners read as a cropped poster.
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

  // Rating colours: the community score is the theme's amber, and the
  // viewer's own rating keeps the app's pink, deepened on the light theme where
  // the dark theme's pink is too pale to read as text.
  const ratingColor = theme.palette.warning.main
  const ownRatingColor = theme.palette.mode === 'dark' ? OWN_RATING_PINK : darken(OWN_RATING_PINK, 0.35)

  // Ratings. Community score as plain text rather than a chip: at rail width
  // two pills side by side wrap onto separate rows.
  const ratings = (item.rating != null || item.userRating) && (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', flexShrink: 0 }}>
      {item.rating != null && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <StarIcon sx={{ fontSize: 12, color: ratingColor }} />
          <Typography
            variant="caption"
            sx={{ color: ratingColor, fontWeight: 600, fontSize: chatText(11), lineHeight: 1.3 }}
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
          <StarIcon sx={{ fontSize: 12, color: ownRatingColor }} />
          <Typography
            variant="caption"
            sx={{ color: ownRatingColor, fontWeight: 600, fontSize: chatText(11), lineHeight: 1.3 }}
          >
            {item.userRating}
          </Typography>
        </Box>
      )}
    </Box>
  )

  // A carousel card shows the type as a chip beside the title; a list card
  // shows none.
  const isMovie = item.type === 'movie' && !item.episode
  const typeColor = isMovie ? theme.palette.mediaType.movie : theme.palette.mediaType.series
  // The accent "More ›" and the focus ring use: the dark theme's accent is its
  // primary, the light theme's primary is ink and its accent is secondary.
  const accent = theme.palette.mode === 'dark' ? theme.palette.primary.light : theme.palette.secondary.main

  const openDetails = (e: MouseEvent) => {
    e.stopPropagation()
    handleDetails()
  }

  // The title is a button: with no Details button, it and "More ›" are what a
  // keyboard reaches to open the title (the card's own click is mouse-only).
  const title = (
    <Box
      component="button"
      type="button"
      onClick={openDetails}
      sx={{
        display: 'block',
        width: '100%',
        p: 0,
        m: 0,
        border: 0,
        bgcolor: 'transparent',
        font: 'inherit',
        textAlign: 'start',
        cursor: 'pointer',
        color: 'inherit',
        '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 2, borderRadius: '2px' },
      }}
    >
      <Typography
        variant="body2"
        component="span"
        fontWeight={600}
        sx={{ color: 'text.primary', minWidth: 0, ...clampLines(2) }}
      >
        {item.name}
        {year && (
          <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>
            {' '}
            ({year})
          </Box>
        )}
      </Typography>
    </Box>
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
      component="p"
      sx={{
        // A block, so it has a width to measure the cut against.
        display: overviewLines > 0 ? 'block' : 'none',
        m: 0,
        color: 'text.secondary',
        lineHeight: 1.45,
      }}
    >
      {overviewCut == null ? (
        item.overview
      ) : (
        <>
          {item.overview.slice(0, overviewCut).trimEnd()}…{' '}
          <Box
            component="button"
            type="button"
            onClick={openDetails}
            aria-label={t('assistantToolUi.moreAbout', { title: item.name })}
            sx={{
              display: 'inline',
              p: 0,
              border: 0,
              bgcolor: 'transparent',
              font: 'inherit',
              fontWeight: 600,
              color: accent,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              '&:hover': { textDecoration: 'underline' },
              '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 2, borderRadius: '2px' },
            }}
          >
            {moreLabel}
          </Box>
        </>
      )}
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
        // In a list card it runs out to nearly the card's edges: it is the
        // card's main text, and the card's own padding left it inset twice.
        ...(isList && { mx: -1, px: 1, [COMPACT_THREAD]: { mx: -0.5, p: 0.75 } }),
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
          // meant expanding six cards one at a time. Cutting is right for
          // a synopsis you can go and read elsewhere; for the only copy of
          // something it is just a lock on the answer.
          //
          // The card grows instead. `MAX_REASON_CHARS` (320, server side)
          // is what bounds that, so the worst case is a known one.
        }}
      >
        {item.reason}
      </Typography>
    </Box>
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
    // - the poster with the title, year and rating and the synopsis beside it,
    //   the synopsis cut at the poster's bottom edge so the two end on one
    //   line, ending on "… More ›" when cut;
    // - the reason across nearly the whole card, never clamped;
    // - one row: Play (episodes only), director, genres, heart.
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
            {/* Title and year, with the rating at the top right. */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, minWidth: 0 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>{title}</Box>
              {ratings && <Box sx={{ mt: '2px', display: 'flex' }}>{ratings}</Box>}
            </Box>
            {overview}
          </Box>
        </Box>

        {reason}

        {/* One line: Play (episodes only) and the heart keep their size, and
            the director and genres between them shrink to an ellipsis rather
            than wrapping the row onto a second line. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 'auto', minWidth: 0 }}>
          {playButton}
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
            {director}
            {genreLine && (
              <Typography
                variant="caption"
                noWrap
                sx={{ color: 'text.secondary', fontSize: chatText(11), minWidth: 0, flexShrink: 1 }}
              >
                {genreLine}
              </Typography>
            )}
          </Box>
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
        {/* Title and year, with the type beside them. */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, minWidth: 0 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>{title}</Box>
          <Chip
            label={typeLabel}
            size="small"
            sx={{
              flexShrink: 0,
              mt: '1px',
              height: 18,
              bgcolor: alpha(typeColor, 0.15),
              color: typeColor,
              '& .MuiChip-label': { px: 0.625, fontSize: chatText(10) },
            }}
          />
        </Box>
        {director}
        {overview}
        {reason}

        {/* Action buttons */}
        {(playButton || favoriteButton) && (
          <Box sx={{ display: 'flex', gap: 1, mt: 'auto', pt: 1, [COMPACT_THREAD]: { pt: 0.75 } }}>
            {playButton}
            {favoriteButton}
          </Box>
        )}
      </Box>
    </Paper>
  )
}
