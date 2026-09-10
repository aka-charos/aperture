/**
 * A title's stored analysis, rendered in chat.
 *
 * Deliberately close to the detail page's TitleAnalysis panel — same segment
 * headings, from the same `mediaDetail.analysis.section.*` keys, because the
 * question vocabulary is closed and a second set of labels would drift across
 * 15 locales the first time a question is renamed.
 *
 * What is NOT shared with that panel is the generate button. This surface only
 * ever reads: writing an analysis is minutes of work on a row every user shares,
 * and a chat question must not commit that on everyone's behalf. A title with no
 * analysis says so and points at the detail page, where the operator's own
 * controls live.
 *
 * The three miss states are rendered apart for the same reason the tool reports
 * them apart: "nobody has run this" and "this was run and the sources were not
 * there" look identical as an empty panel and mean opposite things.
 */
import { useState } from 'react'
import { Box, Typography, Paper, Button, Divider, Chip } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import InfoIcon from '@mui/icons-material/Info'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getProxiedImageUrl } from '@aperture/ui'
import { useMediaDetailModal } from '@/hooks/useMediaDetailModal'
import { extraColors } from '@/theme'
import { chatText } from '../density'
import type { AnalysisData, AnalysisSegmentData } from './types'

interface AnalysisCardProps {
  data: AnalysisData
}

/** Poster rail, matching ContentCard's proportions so the two sit together. */
const RAIL_WIDTH = 84
const POSTER_HEIGHT = 126

function SegmentBlock({ segment }: { segment: AnalysisSegmentData }) {
  const { t } = useTranslation()
  const theme = useTheme()
  // A run can answer two questions — the model is told to merge what belongs
  // together — so both labels survive, in the order it listed them.
  const heading = segment.questions
    .map((question) => t(`mediaDetail.analysis.section.${question}`, { defaultValue: '' }))
    .filter(Boolean)
    .join(' · ')

  // A spoiler-shaped run is collapsed HERE and nowhere else. The detail page
  // deliberately shows everything: a reader who opened an article about a film
  // chose to read about it. In chat nobody opened anything — the analysis
  // arrives beside an answer to some other question — so the one run that can
  // carry a film's ending across asks first. One click, on a minority of runs.
  const [revealed, setRevealed] = useState(false)
  const hidden = segment.spoilerRisk && !revealed

  return (
    <Box sx={{ mb: 1.5 }}>
      {heading && (
        <Typography
          variant="overline"
          color="text.secondary"
          display="block"
          sx={{ lineHeight: 1.6, letterSpacing: '0.08em' }}
        >
          {heading}
        </Typography>
      )}
      {hidden ? (
        <Button
          size="small"
          onClick={() => setRevealed(true)}
          startIcon={<VisibilityOffIcon sx={{ fontSize: 15 }} />}
          sx={{
            textTransform: 'none',
            fontSize: chatText(12),
            color: theme.palette.primary.light,
            justifyContent: 'flex-start',
            px: 1,
            py: 0.5,
            width: '100%',
            borderRadius: 1,
            bgcolor: alpha(theme.palette.primary.main, 0.07),
            '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.14) },
          }}
        >
          {t('assistantToolUi.analysisSpoilerReveal')}
        </Button>
      ) : (
        <Typography variant="body2" sx={{ color: '#c7c7d1', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {segment.text}
        </Typography>
      )}
    </Box>
  )
}

export function AnalysisCard({ data }: AnalysisCardProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const navigate = useNavigate()
  const openMediaDetail = useMediaDetailModal()

  const { analysis } = data
  const href =
    analysis.contentId && analysis.type
      ? `/${analysis.type === 'movie' ? 'movies' : 'series'}/${analysis.contentId}`
      : null

  const openDetail = () => {
    if (!href || !analysis.contentId || !analysis.type) return
    if (openMediaDetail) {
      openMediaDetail(analysis.type, analysis.contentId)
      return
    }
    navigate(href)
  }

  // Nothing was found for the name the model looked up. Rendering the query
  // back is what makes a wrong resolution visible instead of silent.
  if (analysis.status === 'notInLibrary') {
    return (
      <Paper sx={{ my: 2, p: 1.75, bgcolor: theme.palette.background.paper, borderRadius: 2 }}>
        <Typography variant="body2" sx={{ color: '#a1a1aa' }}>
          {t('assistantToolUi.analysisNotInLibrary', { title: analysis.query })}
        </Typography>
      </Paper>
    )
  }

  const title = analysis.title ?? analysis.query

  return (
    <Paper
      sx={{
        my: 2,
        p: 1.75,
        bgcolor: theme.palette.background.paper,
        borderRadius: 2,
        width: '100%',
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Identity row */}
      <Box sx={{ display: 'flex', gap: 1.75, mb: 1.5 }}>
        <Box
          onClick={openDetail}
          sx={{
            width: RAIL_WIDTH,
            height: POSTER_HEIGHT,
            flexShrink: 0,
            borderRadius: 1,
            overflow: 'hidden',
            bgcolor: theme.palette.divider,
            cursor: href ? 'pointer' : 'default',
          }}
        >
          {analysis.poster && (
            <Box
              component="img"
              src={getProxiedImageUrl(analysis.poster)}
              alt={title}
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
            <MenuBookIcon sx={{ fontSize: 15, color: theme.palette.primary.light }} />
            <Typography variant="caption" sx={{ color: theme.palette.primary.light }}>
              {t('assistantToolUi.analysisHeading')}
            </Typography>
          </Box>
          <Typography variant="body2" fontWeight={600} sx={{ color: '#fff' }}>
            {title}
            {analysis.year && (
              <Box component="span" sx={{ color: '#a1a1aa', fontWeight: 400 }}>
                {' '}
                ({analysis.year})
              </Box>
            )}
          </Typography>

          {/* Source provenance. A count and a grade, never the URLs — the model
              must not be handed links it would then cite as if it read them. */}
          {analysis.status === 'available' && analysis.sourceCount != null && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5, flexWrap: 'wrap' }}>
              <Typography variant="caption" sx={{ color: '#71717a' }}>
                {t('assistantToolUi.analysisSources', { count: analysis.sourceCount })}
              </Typography>
              {analysis.sourceGrade && (
                <Chip
                  label={analysis.sourceGrade}
                  size="small"
                  sx={{
                    height: 16,
                    bgcolor: alpha(theme.palette.primary.main, 0.12),
                    color: theme.palette.primary.light,
                    '& .MuiChip-label': { px: 0.625, fontSize: chatText(10) },
                  }}
                />
              )}
            </Box>
          )}

          {href && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<InfoIcon sx={{ fontSize: 14 }} />}
              onClick={openDetail}
              sx={{
                mt: 0.75,
                minWidth: 0,
                px: 1,
                py: 0.25,
                fontSize: chatText(11),
                borderColor: extraColors.subtleBorder,
                color: '#a1a1aa',
                '&:hover': {
                  borderColor: theme.palette.primary.main,
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                },
              }}
            >
              {t('assistantToolUi.details')}
            </Button>
          )}
        </Box>
      </Box>

      <Divider sx={{ mb: 1.5 }} />

      {analysis.status === 'available' ? (
        analysis.segments.map((segment, i) => <SegmentBlock key={i} segment={segment} />)
      ) : (
        <Typography variant="body2" sx={{ color: '#a1a1aa' }}>
          {analysis.status === 'declined'
            ? t('assistantToolUi.analysisDeclined')
            : t('assistantToolUi.analysisNotYet')}
        </Typography>
      )}
    </Paper>
  )
}
