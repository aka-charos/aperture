/**
 * Grounded critical analysis of the title — how it was made, what its makers
 * were attempting, where it sits, what critics argue about.
 *
 * Distinct from MovieInsights in the way that matters: that panel is about the
 * READER (why this was picked for you, from measured pipeline output). This one
 * is about the WORK, is identical for every user, and is written from web
 * sources rather than from anything the recommender computed.
 *
 * Collapsed by default. An analysis is more likely to brush against the ending
 * than a synopsis is, because meaning lives there — the prompt asks only
 * pre-viewing questions to keep that structural rather than instructional, but
 * the same caution that puts `plot_full` behind a button in MediaHero applies.
 * That structural answer is also why no standing disclaimer sits above the
 * text: a notice hedging about spoilers on every title, forever, is a worse
 * trade than the closed question set it would be apologising for.
 *
 * Three states, and they must stay distinguishable:
 *   - an analysis    -> render it
 *   - asked, declined -> say so plainly; there is nothing more to get
 *   - never asked     -> offer the button
 * A panel that renders identically for "we looked and there is nothing" and
 * "nobody has looked" would send people clicking at a wall.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Typography,
} from '@mui/material'
import {
  AutoStories as AutoStoriesIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material'
import type { MediaType } from '../types'

interface AnalysisSource {
  title: string
  domain: string
  /**
   * Absent for anything written under native grounding, whose citations are
   * short-lived redirects and are deliberately not stored, and for rows
   * written before the field existed. A source without one is normal.
   */
  url?: string
}

interface AnalysisResponse {
  attempted: boolean
  analysis: string | null
  declineReason?: string | null
  sources?: AnalysisSource[]
  sourceGrade?: string | null
  analyzedAt?: string
}

interface TitleAnalysisProps {
  mediaType: MediaType
  mediaId: string
}

export function TitleAnalysis({ mediaType, mediaId }: TitleAnalysisProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<AnalysisResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/analysis/${mediaType}/${mediaId}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: AnalysisResponse | null) => {
        if (!cancelled) setData(json)
      })
      .catch(() => {
        // A missing analysis is not an error worth a banner — the panel simply
        // offers the button instead.
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [mediaType, mediaId])

  const generate = useCallback(async () => {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/analysis/${mediaType}/${mediaId}`, {
        method: 'POST',
        credentials: 'include',
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error ?? t('mediaDetail.analysis.failed'))
        return
      }
      setData(json as AnalysisResponse)
    } catch {
      setError(t('mediaDetail.analysis.failed'))
    } finally {
      setGenerating(false)
    }
  }, [mediaType, mediaId, t])

  if (loading) return null

  const hasAnalysis = Boolean(data?.attempted && data.analysis)
  const declined = Boolean(data?.attempted && !data.analysis)

  return (
    <Box sx={{ mt: 3, px: { xs: 2, sm: 3 } }}>
      <Accordion
        // Collapsed by default even when present — see the spoiler note above.
        defaultExpanded={false}
        disableGutters
        sx={{ borderRadius: 2, '&:before': { display: 'none' } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoStoriesIcon fontSize="small" color="primary" />
            <Typography variant="subtitle1" fontWeight={600}>
              {t(
                mediaType === 'series'
                  ? 'mediaDetail.analysis.headingSeries'
                  : 'mediaDetail.analysis.headingMovie'
              )}
            </Typography>
            {hasAnalysis && data?.sourceGrade && (
              <Chip
                size="small"
                variant="outlined"
                label={t(`mediaDetail.analysis.grade.${gradeKey(data.sourceGrade)}`)}
                sx={{ height: 20, fontSize: '0.7rem' }}
              />
            )}
          </Box>
        </AccordionSummary>

        <AccordionDetails>
          {error && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {hasAnalysis && (
            <>
              {/* Plain paragraphs, no markdown renderer: the prompt asks for
                  prose with no headings or lists, and a renderer for one panel
                  is not worth the bundle. Blank-line splitting is what turns
                  the model’s paragraphs back into paragraphs here.

                  The measure is capped because this panel is as wide as the
                  page: on a desktop screen an uncapped line runs past 200
                  characters, roughly three times what the eye tracks
                  comfortably, and several hundred words of that is exhausting
                  however well it is written. */}
              <Box sx={{ maxWidth: '78ch' }}>
                {(data?.analysis ?? '').split(/\n{2,}/).map((para, i) => (
                  <Typography
                    key={i}
                    variant="body2"
                    sx={{ mb: 2, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}
                  >
                    {para.trim()}
                  </Typography>
                ))}
              </Box>

              {data?.sources && data.sources.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                    {t('mediaDetail.analysis.sourcesLabel')}
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {/* The domain is the label because it is the part that says
                        something — whether this came from a film journal or a
                        listicle — while article titles are long and mostly
                        repeat the film’s name. The link rides underneath, and
                        only when the row carries one: analyses written under
                        native grounding store no URL by design. */}
                    {data.sources.map((source, i) => (
                      <Chip
                        key={`${source.domain}-${i}`}
                        size="small"
                        variant="outlined"
                        label={source.domain || source.title}
                        title={source.title}
                        {...(source.url
                          ? {
                              component: 'a' as const,
                              href: source.url,
                              target: '_blank',
                              rel: 'noopener noreferrer',
                              clickable: true,
                            }
                          : {})}
                        sx={{ height: 20, fontSize: '0.7rem' }}
                      />
                    ))}
                  </Box>
                </Box>
              )}
            </>
          )}

          {declined && (
            <Typography variant="body2" color="text.secondary">
              {t(
                data?.declineReason === 'thin_sources'
                  ? 'mediaDetail.analysis.declinedThinSources'
                  : 'mediaDetail.analysis.declinedNoCraft'
              )}
            </Typography>
          )}

          {!hasAnalysis && !declined && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {t('mediaDetail.analysis.notYetGenerated')}
              </Typography>
              <Button
                variant="outlined"
                size="small"
                onClick={generate}
                disabled={generating}
                startIcon={generating ? <CircularProgress size={16} /> : <AutoStoriesIcon />}
              >
                {generating
                  ? t('mediaDetail.analysis.generating')
                  : t('mediaDetail.analysis.generate')}
              </Button>
            </Box>
          )}
        </AccordionDetails>
      </Accordion>
    </Box>
  )
}

/** Maps the stored grade onto an i18n key fragment. */
function gradeKey(grade: string): string {
  if (grade === 'substantial') return 'substantial'
  if (grade === 'reviews-only') return 'reviewsOnly'
  return 'almostNothing'
}
