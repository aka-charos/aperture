import { useState } from 'react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Typography,
  Paper,
  Chip,
  Divider,
  LinearProgress,
  Tooltip,
  Collapse,
  IconButton,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import HubOutlinedIcon from '@mui/icons-material/HubOutlined'
import ThumbUpIcon from '@mui/icons-material/ThumbUp'
import ShuffleIcon from '@mui/icons-material/Shuffle'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import QueryStatsIcon from '@mui/icons-material/QueryStats'
import GroupsIcon from '@mui/icons-material/Groups'
import { getProxiedImageUrl, FALLBACK_POSTER_URL } from '@aperture/ui'
import { gradients } from '@/theme'
import type { RecommendationInsights, MediaType } from '../types'

interface MovieInsightsProps {
  insights: RecommendationInsights
  mediaType?: MediaType
  /** Show an evidence item without routing (set when this sits inside a dialog). */
  onOpenMedia?: (mediaType: MediaType, id: string) => void
}

export function MovieInsights({ insights, mediaType = 'movie', onOpenMedia }: MovieInsightsProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const theme = useTheme()

  // One of the run's picks, as opposed to a title the run merely scored. This
  // used to be a second condition on the early return below, so the panel could
  // only ever explain a dozen films per user — everything else was scored,
  // discarded before it reached the database, and reported as never considered.
  // A pick opens expanded, because its prose explanation is the point of the
  // panel and a collapsed one would read as though there were nothing inside.
  // A merely-scored title opens collapsed: it is not a recommendation, so it
  // should not take a screen by default. Neither is a dead end any more — the
  // header carries all three component scores, so the collapsed panel already
  // says everything the meters below say.
  const isPick = insights.isSelected === true
  const [insightsExpanded, setInsightsExpanded] = useState(isPick)

  if (!insights.isRecommended) {
    return null
  }

  const isSeriesView = mediaType === 'series'
  const similarityTooltip = isSeriesView
    ? t('mediaDetail.insights.subtitleSeries')
    : t('mediaDetail.insights.subtitleMovie')
  const matchPct = Math.round((insights.scores?.final || 0) * 100)

  // The value the score blend actually consumed — the raw cosine rescaled
  // against the run's own candidate pool.
  //
  // Showing the raw cosine here was the bug: embeddings of one library sit in a
  // cone a few points wide, so a strong match reads as a middling percentage,
  // and worse, it is not the number `final` is made from. The panel showed
  // 78 / 72 / 85 under a headline of 90, which no weighted average of those
  // three can produce. Falls back to the raw value for runs written before
  // migration 0141 stored it, which at least keeps the card populated.
  const tasteMatch = insights.scores?.normalizedSimilarity ?? insights.scores?.similarity ?? null

  // Present only from 0141 on. Its absence is what hides the arithmetic line
  // rather than showing one that cannot be checked.
  //
  // The delta is derived from the two ROUNDED percentages, not rounded
  // separately from the underlying floats. Rounding each of three numbers
  // independently lets them disagree by a point — 0.824 and 0.897 render as 82
  // and 90 while their difference renders as 7 — and a line that visibly fails
  // to add up is worse than no line, since the whole purpose of it is that the
  // reader can check the arithmetic.
  const basePct = insights.scores?.base != null ? Math.round(insights.scores.base * 100) : null
  const preferenceDeltaPct = basePct != null ? matchPct - basePct : 0

  // Novelty's response curve floors well above zero (it is a peaked function,
  // not a fraction), so its bar is filled against the range it can occupy. The
  // scale comes from the API, which reads core's own constants — the web app
  // never imports @aperture/core, and hardcoding them here would let the bar
  // drift the first time the curve is retuned.
  const noveltyScale = insights.scoreScales?.novelty
  const noveltyFill =
    insights.scores?.novelty != null && noveltyScale && noveltyScale.max > noveltyScale.min
      ? Math.min(
          100,
          Math.max(
            0,
            ((insights.scores.novelty - noveltyScale.min) /
              (noveltyScale.max - noveltyScale.min)) *
              100
          )
        )
      : (insights.scores?.novelty ?? 0) * 100

  const discoveryTooltip = noveltyScale
    ? t('mediaDetail.insights.tooltipDiscoveryRanged', {
        min: Math.round(noveltyScale.min * 100),
        max: Math.round(noveltyScale.max * 100),
      })
    : t('mediaDetail.insights.tooltipDiscovery')

  // Present only when a reserved taste-twin slot put this title in the list
  // (recommender/shared/twinSlots.ts). The stored object carries the donor's
  // id, which is deliberately never read here: the line says "someone", and
  // resolving an identity should not be one refactor away.
  const fromTasteTwin =
    typeof insights.scoreBreakdown?.twinMatch === 'object' &&
    insights.scoreBreakdown.twinMatch !== null

  // Same for a stated interest. Both are *reserved slot* picks, which is the
  // distinction the evidence carousel below has to respect: a slot filler was
  // chosen by something other than the ranking, so labelling the similarity
  // lookup "why we think you'll like this" states a cause that isn't one.
  const fromInterest =
    typeof insights.scoreBreakdown?.interestMatch === 'object' &&
    insights.scoreBreakdown.interestMatch !== null
  const fromReservedSlot = fromTasteTwin || fromInterest

  // Empty unless a twin slot placed this title *and* the run that produced it
  // recorded the overlap, which runs generated before that shipped did not.
  const twinShared = insights.twinShared ?? []

  // The two lists partition the title's genres exactly (both routes filter the
  // same DB column against the viewer's top genres), so these counts always add
  // up to the number of chips rendered in the hero.
  const enjoyedCount = insights.genreAnalysis?.matchingGenres.length ?? 0
  const newCount = insights.genreAnalysis?.newGenres.length ?? 0

  const openItem = (id: string) =>
    onOpenMedia
      ? onOpenMedia(mediaType, id)
      : navigate(`/${mediaType === 'movie' ? 'movies' : 'series'}/${id}`)

  // The three components of the match, built once and rendered twice: as a
  // one-line summary in the header, and as meters in the body. Three `h4`
  // percentages in three padded cards used to cost 154px of page to say what
  // fits in the header of a collapsed panel.
  const scoreMeters: Array<{
    id: string
    icon: ReactElement
    label: string
    tooltip: string
    value: number | null
    /** Bar fill, which is not always the value — see novelty above. */
    fill: number
    color: 'info' | 'success' | 'warning'
  }> = [
    {
      id: 'taste',
      icon: <TrendingUpIcon sx={{ fontSize: 16 }} />,
      label: t('mediaDetail.insights.tasteMatch'),
      tooltip: similarityTooltip,
      value: tasteMatch,
      fill: (tasteMatch ?? 0) * 100,
      color: 'info',
    },
    {
      id: 'discovery',
      icon: <HubOutlinedIcon sx={{ fontSize: 16 }} />,
      label: t('mediaDetail.insights.discovery'),
      tooltip: discoveryTooltip,
      value: insights.scores?.novelty ?? null,
      fill: noveltyFill,
      color: 'success',
    },
    {
      id: 'quality',
      icon: <ThumbUpIcon sx={{ fontSize: 16 }} />,
      label: t('mediaDetail.insights.quality'),
      tooltip: t('mediaDetail.insights.tooltipQuality'),
      value: insights.scores?.rating ?? null,
      fill: (insights.scores?.rating ?? 0) * 100,
      color: 'warning',
    },
  ]

  const formatScore = (value: number | null) =>
    value != null ? `${Math.round(value * 100)}%` : t('mediaDetail.insights.na')

  return (
    <Box sx={{ mt: 4, px: 3 }}>
      <Paper
        sx={{
          borderRadius: 3,
          overflow: 'hidden',
          // A scored-but-not-picked title gets the same numbers without the
          // recommendation styling, so the page can't be misread as claiming
          // the recommender chose it.
          background: isPick
            ? `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.secondary.main, 0.1)} 100%)`
            : 'transparent',
          border: '1px solid',
          borderColor: isPick ? 'primary.main' : 'divider',
        }}
      >
        {/* Header. Carries the whole score story, so the panel says something
            while collapsed and the body below is elaboration rather than the
            only place the numbers exist. */}
        <Box
          sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            cursor: 'pointer',
            '&:hover': { bgcolor: 'action.hover' },
          }}
          onClick={() => setInsightsExpanded(!insightsExpanded)}
        >
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              columnGap: 2,
              rowGap: 1,
            }}
          >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: '1 1 16rem', minWidth: 0 }}>
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: 2,
                background: isPick
                  ? gradients.primaryToSecondary
                  : alpha(theme.palette.text.primary, 0.08),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isPick ? (
                <AutoAwesomeIcon sx={{ color: 'white', fontSize: 28 }} />
              ) : (
                <QueryStatsIcon sx={{ color: 'text.secondary', fontSize: 28 }} />
              )}
            </Box>
            <Box>
              <Typography variant="h6" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {isPick
                  ? t('mediaDetail.insights.recommendedForYou')
                  : t('mediaDetail.insights.consideredForYou')}
                {insights.rank != null && (
                  <Chip
                    label={`#${insights.rank}`}
                    size="small"
                    sx={{
                      bgcolor: isPick ? 'primary.main' : 'action.selected',
                      color: isPick ? 'white' : 'text.primary',
                      fontWeight: 700,
                      height: 22,
                    }}
                  />
                )}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {/* A rank means nothing without the size of the field it was
                    ranked in, so the two are never shown apart. */}
                {!isPick && insights.totalCandidates
                  ? t('mediaDetail.insights.consideredSubtitle', {
                      pct: matchPct,
                      total: insights.totalCandidates.toLocaleString(i18n.language),
                    })
                  : t('mediaDetail.insights.matchSubtitle', { pct: matchPct })}
              </Typography>
            </Box>
          </Box>

            {/* The three component scores, inline. Wraps under the title on a
                narrow container rather than at a breakpoint, because this
                panel also renders inside MediaDetailModal. */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5 }}>
              {scoreMeters.map(({ id, label, value, color }) => (
                <Box key={id} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography variant="body2" fontWeight={700} color={`${color}.main`}>
                    {formatScore(value)}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
          <IconButton>
            {insightsExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Box>

        <Collapse in={insightsExpanded}>
          <Divider />
          <Box sx={{ p: 2.5 }}>
            {/* Above the explanation because it is the reason this title is in
                the list at all — the scores below describe it, they did not
                choose it. */}
            {fromTasteTwin && (
              <Paper
                sx={{
                  p: 2,
                  mb: 2.5,
                  bgcolor: 'background.default',
                  borderRadius: 2,
                  borderInlineStart: '3px solid',
                  borderInlineStartColor: 'secondary.main',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <GroupsIcon sx={{ color: 'secondary.main', fontSize: 20 }} />
                  <Typography variant="body2" color="text.secondary">
                    {t('mediaDetail.insights.tasteTwin')}
                  </Typography>
                </Box>

                {/* The overlap that identified the twin in the first place, and
                    so the only evidence on this page that actually explains the
                    pick. Kept inside the same card as the claim it supports —
                    the similarity carousel further down is computed after
                    selection and had no part in it. */}
                {twinShared.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                      {isSeriesView
                        ? t('mediaDetail.insights.tasteTwinSharedSeries')
                        : t('mediaDetail.insights.tasteTwinSharedMovie')}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1 }}>
                      {twinShared.map((item) => (
                        <Box
                          key={item.id}
                          onClick={() => openItem(item.id)}
                          sx={{
                            flexShrink: 0,
                            width: 92,
                            cursor: 'pointer',
                            transition: 'transform 0.2s',
                            '&:hover': { transform: 'scale(1.05)' },
                          }}
                        >
                          <Box
                            component="img"
                            src={getProxiedImageUrl(item.poster_url)}
                            alt={item.title}
                            onError={(e) => {
                              const target = e.target as HTMLImageElement
                              target.src = FALLBACK_POSTER_URL
                            }}
                            sx={{
                              width: '100%',
                              height: 124,
                              objectFit: 'cover',
                              borderRadius: 1.5,
                              bgcolor: 'grey.800',
                              display: 'block',
                            }}
                          />
                          <Typography variant="caption" noWrap display="block" sx={{ mt: 0.5 }}>
                            {item.title}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {item.year ?? t('mediaDetail.insights.na')}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}
              </Paper>
            )}

            {/* Prose and numbers side by side rather than stacked.
                Everything below the header used to be one column down the
                middle of a full-page-width panel: four section headings, four
                32px gaps and a row of three padded score cards, about 550px of
                page for three percentages and two one-line facts, with the
                right half of every row empty.

                The split is flex basis, not breakpoints — same reasoning as
                TitleAnalysis, which this mirrors: the panel also renders
                inside MediaDetailModal and beside the assistant dock, so the
                window's width is not the width it gets. When there is no
                explanation to show, the rail is the only child and takes the
                full width, at which point its own auto-fit grid puts the three
                meters back in a row. One layout, both variants. */}
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-start',
                gap: 2.5,
                mb: 2.5,
              }}
            >
              {/* The generated "why" — prose before numbers, matching the order
                  the same text is written into the media-server plot. Absent
                  whenever AI explanations are switched off. */}
              {insights.aiExplanation && (
                <Box
                  sx={{
                    flex: '1 1 26rem',
                    minWidth: 0,
                    maxWidth: '80ch',
                    borderInlineStart: '3px solid',
                    borderInlineStartColor: 'primary.main',
                    pl: 2,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <AutoAwesomeIcon sx={{ color: 'primary.main', fontSize: 18 }} />
                    <Typography variant="subtitle2" fontWeight={600}>
                      {t('mediaDetail.insights.aiExplanationTitle')}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                    {insights.aiExplanation}
                  </Typography>
                </Box>
              )}

              <Box sx={{ flex: '1 1 17rem', minWidth: 0 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  sx={{ mb: 1 }}
                >
                  {t('mediaDetail.insights.howWeCalculated')}
                </Typography>

                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
                    columnGap: 2,
                    rowGap: 1.25,
                    mb: 1.5,
                  }}
                >
                  {scoreMeters.map(({ id, icon, label, tooltip, value, fill, color }) => (
                    <Tooltip key={id} title={tooltip} arrow>
                      <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                          <Box sx={{ display: 'flex', color: `${color}.main` }}>{icon}</Box>
                          <Typography variant="caption" sx={{ flex: 1 }} noWrap>
                            {label}
                          </Typography>
                          <Typography variant="body2" fontWeight={700} color={`${color}.main`}>
                            {formatScore(value)}
                          </Typography>
                        </Box>
                        {/* Discovery fills against the band its curve can
                            occupy rather than 0-100 — see noveltyFill. The
                            number above stays the real value, so the
                            arithmetic below still adds up. */}
                        <LinearProgress
                          variant="determinate"
                          value={fill}
                          sx={{
                            height: 4,
                            borderRadius: 1,
                            bgcolor: 'grey.800',
                            '& .MuiLinearProgress-bar': { bgcolor: `${color}.main` },
                          }}
                        />
                      </Box>
                    </Tooltip>
                  ))}
                </Box>

                <Box
                  sx={{
                    pt: 1.25,
                    borderTop: '1px solid',
                    borderColor: 'divider',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.75,
                  }}
                >
                  {/* How those three become the match.
                      Shown only when the run stored the pre-preference blend,
                      i.e. from migration 0141 on. Older runs kept neither that
                      nor the similarity value the blend consumed, and neither
                      is recoverable — so rather than imply an arithmetic it
                      cannot show, the panel simply omits this line for them. */}
                  {basePct != null && (
                    <Box
                      sx={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'baseline',
                        columnGap: 0.75,
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {t('mediaDetail.insights.blendedScore')}
                      </Typography>
                      <Typography variant="caption" fontWeight={700}>
                        {basePct}%
                      </Typography>
                      {preferenceDeltaPct !== 0 && (
                        <>
                          <Typography variant="caption" color="text.secondary">
                            {preferenceDeltaPct > 0
                              ? t('mediaDetail.insights.preferenceLift')
                              : t('mediaDetail.insights.preferenceDrop')}
                          </Typography>
                          <Typography
                            variant="caption"
                            fontWeight={700}
                            color={preferenceDeltaPct > 0 ? 'success.main' : 'error.main'}
                          >
                            {preferenceDeltaPct > 0 ? '+' : '−'}
                            {Math.abs(preferenceDeltaPct)}%
                          </Typography>
                        </>
                      )}
                      <Typography variant="caption" color="text.secondary">
                        {t('mediaDetail.insights.givesMatch')}
                      </Typography>
                      <Typography variant="caption" fontWeight={700} color="primary.main">
                        {matchPct}%
                      </Typography>
                    </Box>
                  )}

                  {/* Variety — a property of the LIST, not of the match. It
                      measures how much this pick differs from what was already
                      chosen, and is blended into the selection ordering rather
                      than into the score above. It is below the rule and
                      outside the meter grid for that reason; rendering it as a
                      fourth component of "How We Calculated Your Match"
                      claimed it was one. The explainer stays on screen rather
                      than moving into a tooltip, because that sentence is the
                      whole of the distinction. */}
                  {insights.scores?.diversity != null && (
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                      <ShuffleIcon sx={{ color: 'secondary.main', fontSize: 16 }} />
                      <Typography variant="caption" color="text.secondary">
                        {t('mediaDetail.insights.varietyHeading')}
                      </Typography>
                      <Typography variant="caption" fontWeight={700} color="secondary.main">
                        {Math.round(insights.scores.diversity * 100)}%
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('mediaDetail.insights.varietyExplainer')}
                      </Typography>
                    </Box>
                  )}

                  {/* Genre Analysis — the count only. The genres themselves are
                      chips on the title's own genre row at the top of the page,
                      styled there with this same enjoyed/new distinction. */}
                  {enjoyedCount + newCount > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      {enjoyedCount > 0 && (
                        <Box component="span" sx={{ color: 'success.main', fontWeight: 600 }}>
                          {t('mediaDetail.insights.genresEnjoy', { count: enjoyedCount })}
                        </Box>
                      )}
                      {enjoyedCount > 0 && newCount > 0 && ' • '}
                      {newCount > 0 && (
                        <Box component="span" sx={{ color: 'info.main', fontWeight: 600 }}>
                          {t('mediaDetail.insights.genresNew', { count: newCount })}
                        </Box>
                      )}
                    </Typography>
                  )}
                </Box>
              </Box>
            </Box>

            {/* Evidence - Items that contributed to this recommendation */}
            {insights.evidence && insights.evidence.length > 0 && (
              <Box>
                {/* These rows are the pick's nearest neighbours in the reader's
                    own history by embedding cosine, found *after* selection.
                    For a ranked pick that is a fair account of why it is here.
                    For a reserved-slot pick it is not — the ranking is exactly
                    what did not choose it — and calling it "why we think you'll
                    like this" directly contradicts the banner at the top of the
                    panel. Same rows either way; only the claim changes. */}
                {/* Heading and its qualifier on one wrapping line rather than
                    two stacked blocks — the qualifier is a clause about the
                    heading, and it read as a paragraph of its own. */}
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'baseline',
                    columnGap: 1,
                    mb: 1.5,
                  }}
                >
                  <Typography variant="subtitle2" fontWeight={600}>
                    {fromReservedSlot
                      ? t('mediaDetail.insights.closestInLibrary')
                      : t('mediaDetail.insights.whyWeThink')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {fromReservedSlot
                      ? isSeriesView
                        ? t('mediaDetail.insights.closestInLibrarySeries')
                        : t('mediaDetail.insights.closestInLibraryMovie')
                      : isSeriesView
                        ? t('mediaDetail.insights.basedOnHistorySeries')
                        : t('mediaDetail.insights.basedOnHistoryMovie')}
                  </Typography>
                </Box>
                {/* Same poster size as the taste-twin row above, which was
                    already the denser of the two treatments this file had for
                    the same kind of row. */}
                <Box sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1 }}>
                  {insights.evidence.map((ev) => {
                    const item = ev.similar_movie || ev.similar_series
                    if (!item) return null
                    const evidenceType: MediaType = ev.similar_movie ? 'movie' : 'series'

                    return (
                      <Paper
                        key={ev.id}
                        onClick={() =>
                          onOpenMedia
                            ? onOpenMedia(evidenceType, item.id)
                            : navigate(`/${evidenceType === 'movie' ? 'movies' : 'series'}/${item.id}`)
                        }
                        sx={{
                          flexShrink: 0,
                          width: 92,
                          cursor: 'pointer',
                          borderRadius: 2,
                          overflow: 'hidden',
                          transition: 'transform 0.2s',
                          '&:hover': { transform: 'scale(1.05)' },
                          bgcolor: 'background.default',
                        }}
                      >
                        <Box sx={{ height: 124, bgcolor: 'grey.800', position: 'relative' }}>
                          <Box
                            component="img"
                            src={getProxiedImageUrl(item.poster_url)}
                            alt={item.title}
                            onError={(e) => {
                              const target = e.target as HTMLImageElement
                              target.src = FALLBACK_POSTER_URL
                            }}
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                          <Chip
                            label={`${Math.round(ev.similarity * 100)}%`}
                            size="small"
                            sx={{
                              position: 'absolute',
                              top: 4,
                              right: 4,
                              height: 20,
                              fontSize: '0.65rem',
                              fontWeight: 700,
                              bgcolor: alpha(theme.palette.primary.main, 0.9),
                              color: 'white',
                            }}
                          />
                          <Chip
                            label={ev.evidence_type === 'favorite' ? '❤️' : ev.evidence_type === 'recent' ? '🕐' : '✓'}
                            size="small"
                            sx={{
                              position: 'absolute',
                              bottom: 4,
                              left: 4,
                              height: 20,
                              minWidth: 20,
                              fontSize: '0.7rem',
                              bgcolor: 'rgba(0,0,0,0.7)',
                            }}
                          />
                        </Box>
                        <Box sx={{ p: 1 }}>
                          <Typography variant="caption" fontWeight={500} noWrap display="block">
                            {item.title}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {item.year ?? t('mediaDetail.insights.na')}
                          </Typography>
                        </Box>
                      </Paper>
                    )
                  })}
                </Box>
              </Box>
            )}
          </Box>
        </Collapse>
      </Paper>
    </Box>
  )
}

