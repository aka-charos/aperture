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
  /**
   * Written under an older prompt. Decided by the server, because the current
   * version is a server-side constant and a client comparing numbers itself
   * would have to be redeployed in lockstep with every prompt change.
   */
  stale?: boolean
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
  // Offered only over an analysis that exists and is behind the current
  // prompt. It disappears of its own accord once used, because the rewritten
  // row is current — which is what bounds the spend without an admin gate:
  // one rewrite per title per prompt version, not a button anyone can lean on.
  const canRewrite = hasAnalysis && Boolean(data?.stale)

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

                  The text and its sources sit side by side rather than stacked.
                  The measure has to be capped — this panel is as wide as the
                  page, and an uncapped desktop line runs past 200 characters,
                  roughly three times what the eye tracks — but capping it alone
                  left half the panel empty, which reads as a rendering fault
                  rather than a margin. The rail puts something worth reading in
                  that space and keeps provenance beside the claim.

                  No breakpoints: this page also renders inside MediaDetailModal
                  and beside the assistant dock, where a window-width media
                  query would be wrong. flex-wrap collapses the rail underneath
                  the text on its own when the container is narrow. */}
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'flex-start',
                  gap: 3,
                }}
              >
                <Box sx={{ flex: '1 1 30rem', maxWidth: '84ch' }}>
                  {(data?.analysis ?? '')
                    .split(/\n{2,}/)
                    .map((para, i) => (
                      <Typography
                        key={i}
                        variant="body2"
                        // No pre-wrap. The model separates its sentences with
                        // single newlines as well as its paragraphs with blank
                        // ones, and preserving the former broke every sentence
                        // onto its own line — an article rendered as a list,
                        // each line ending wherever the sentence did. Letting
                        // HTML collapse them is what makes paragraphs read as
                        // paragraphs; the blank-line split above is the only
                        // break that should survive.
                        sx={{ mb: 2, lineHeight: 1.75 }}
                      >
                        {para.trim()}
                      </Typography>
                    ))}

                  {canRewrite && (
                    <Box sx={{ mt: 1.5 }}>
                      <Button
                        variant="text"
                        size="small"
                        onClick={generate}
                        disabled={generating}
                        startIcon={generating ? <CircularProgress size={14} /> : undefined}
                      >
                        {generating
                          ? t('mediaDetail.analysis.generating')
                          : t('mediaDetail.analysis.rewrite')}
                      </Button>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('mediaDetail.analysis.staleNote')}
                      </Typography>
                    </Box>
                  )}
                </Box>

                {data?.sources && data.sources.length > 0 && (
                  <Box sx={{ flex: '1 1 12rem', maxWidth: 260 }}>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                      {t('mediaDetail.analysis.sourcesLabel')}
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {/* The domain is the label because it is the part that
                          says something — whether this came from a film journal
                          or a listicle — while article titles are long and
                          mostly repeat the film’s name. The link rides
                          underneath, and only when the row carries one:
                          analyses written under native grounding store no URL
                          by design. */}
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
              </Box>
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
