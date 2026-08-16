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
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('mediaDetail.analysis.spoilerNote')}
          </Typography>

          {error && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {hasAnalysis && (
            <>
              {/* Plain paragraphs: the model writes markdown headings that would
                  need a renderer, and a renderer for one panel is not worth the
                  bundle. Blank-line splitting keeps the structure readable. */}
              {(data?.analysis ?? '').split(/\n{2,}/).map((para, i) => (
                <Typography key={i} variant="body2" sx={{ mb: 1.5, whiteSpace: 'pre-wrap' }}>
                  {para.trim()}
                </Typography>
              ))}

              {data?.sources && data.sources.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                    {t('mediaDetail.analysis.sourcesLabel')}
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {/* Domains, not links. Google's grounding URLs are
                        short-lived redirects, so a cache that lives for months
                        would be a wall of dead links. */}
                    {data.sources.map((source, i) => (
                      <Chip
                        key={`${source.domain}-${i}`}
                        size="small"
                        variant="outlined"
                        label={source.domain || source.title}
                        title={source.title}
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
