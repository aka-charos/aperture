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
  Autorenew as AutorenewIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material'
import type { TFunction } from 'i18next'
import { useAuth } from '../../../hooks/useAuth'
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

/**
 * What produced the stored row: which model wrote it, which retrieval mode fed
 * it, how much text that came to. Sent to admins only, so the panel renders it
 * whenever it is present rather than re-deciding who may see it.
 */
interface AnalysisProvenance {
  model: string | null
  retrievalMode: 'crw' | 'grounding' | null
  sourceCount: number | null
  retrievedChars: number | null
  promptVersion: number
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
  provenance?: AnalysisProvenance
}

interface TitleAnalysisProps {
  mediaType: MediaType
  mediaId: string
}

export function TitleAnalysis({ mediaType, mediaId }: TitleAnalysisProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isAdmin = user?.isAdmin === true
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

  /**
   * `force` re-runs a title that already has a row, and is admin-only on the
   * server. It has to be passed explicitly at every call site: `onClick={run}`
   * would hand React's click event in as `force`, and an event object is
   * truthy — so an ordinary "Write an analysis" press would silently become a
   * forced regeneration.
   */
  const run = useCallback(
    async (force: boolean) => {
      setGenerating(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/analysis/${mediaType}/${mediaId}${force ? '?force=true' : ''}`,
          { method: 'POST', credentials: 'include' }
        )
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
    },
    [mediaType, mediaId, t]
  )

  if (loading) return null

  const hasAnalysis = Boolean(data?.attempted && data.analysis)
  const declined = Boolean(data?.attempted && !data.analysis)
  // Offered only over an analysis that exists and is behind the current
  // prompt. It disappears of its own accord once used, because the rewritten
  // row is current — which is what bounds the spend without an admin gate:
  // one rewrite per title per prompt version, not a button anyone can lean on.
  const canRewrite = hasAnalysis && Boolean(data?.stale)
  const provenanceLine = data ? describeProvenance(data, t) : null

  // No outer padding or margin: this renders inside the detail page's left
  // column, which supplies both. It used to be a full-width band above the
  // two-column grid, where the prose ran the whole width of the page and the
  // panel's right edge had nothing to line up with.
  return (
    <Box>
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
                  is not worth the bundle. `toParagraphs` is what turns the
                  model’s prose back into paragraphs here — see the note on it,
                  and note that it cannot be a plain blank-line split, because
                  some rows arrive with no blank lines in them at all.

                  The text and its sources sit side by side rather than stacked.
                  The measure has to be capped — an uncapped line here runs past
                  what the eye tracks — but capping it alone left the panel half
                  empty, which reads as a rendering fault rather than a margin.
                  The rail puts something worth reading in that space and keeps
                  provenance beside the claim.

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
                <Box sx={{ flex: '1 1 26rem', maxWidth: '84ch' }}>
                  {toParagraphs(data?.analysis ?? '').map((para, i) => (
                    <Typography
                      key={i}
                      variant="body2"
                      // No pre-wrap. The model separates its sentences with
                      // single newlines as well as its paragraphs with blank
                      // ones, and preserving the former broke every sentence
                      // onto its own line — an article rendered as a list, each
                      // line ending wherever the sentence did. Letting HTML
                      // collapse whitespace is what makes paragraphs read as
                      // paragraphs; `toParagraphs` decides where the breaks go.
                      sx={{ mb: 2, lineHeight: 1.75 }}
                    >
                      {para}
                    </Typography>
                  ))}

                  {canRewrite && (
                    <Box sx={{ mt: 1.5 }}>
                      <Button
                        variant="text"
                        size="small"
                        onClick={() => run(false)}
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
                onClick={() => run(false)}
                disabled={generating}
                startIcon={generating ? <CircularProgress size={16} /> : <AutoStoriesIcon />}
              >
                {generating
                  ? t('mediaDetail.analysis.generating')
                  : t('mediaDetail.analysis.generate')}
              </Button>
            </Box>
          )}
          {/* Admin re-run.

              Offered only over a row that already exists, because that is the
              case the cache otherwise makes a dead end: an ordinary POST is
              answered from storage, so the only way to try another model — or
              to give a DECLINED title a second chance under better retrieval —
              is to say so explicitly. A title never analysed already has the
              button above, where forcing would mean nothing.

              It sits under a rule and states its cost, because unlike every
              other control here it spends on a title that already has an
              answer, and can be leaned on. The provenance line beside it is
              what makes the re-run worth having at all: without knowing which
              model and which mode wrote the text on screen, a before and after
              compares nothing. */}
          {isAdmin && data?.attempted && (
            <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
                <Button
                  variant="outlined"
                  size="small"
                  color="secondary"
                  onClick={() => run(true)}
                  disabled={generating}
                  startIcon={
                    generating ? <CircularProgress size={16} /> : <AutorenewIcon fontSize="small" />
                  }
                >
                  {generating
                    ? t('mediaDetail.analysis.generating')
                    : t('mediaDetail.analysis.admin.rerun')}
                </Button>
                <Typography variant="caption" color="text.secondary" sx={{ flex: '1 1 16rem' }}>
                  {t('mediaDetail.analysis.admin.hint')}
                </Typography>
              </Box>
              {provenanceLine && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  sx={{ mt: 1, fontFamily: 'monospace', fontSize: '0.68rem' }}
                >
                  {provenanceLine}
                </Typography>
              )}
            </Box>
          )}
        </AccordionDetails>
      </Accordion>
    </Box>
  )
}

/** Sentences per paragraph when the model's own breaks have to be replaced. */
const SENTENCES_PER_PARAGRAPH = 4

/**
 * A shorter run than this is not a sentence — it is an abbreviation the split
 * below cut at ("The U.S.", "Directed by J. R. R."), so it joins what follows.
 */
const MIN_SENTENCE_CHARS = 40

/**
 * The analysis, broken into paragraphs.
 *
 * The prompt asks for paragraphs of three or four sentences separated by blank
 * lines, and when the model complies that is exactly what renders. It does not
 * always comply, and what it does instead varies by model and by title: some
 * rows separate their paragraphs with a single newline, and some arrive as one
 * unbroken block with no newline in them anywhere. Those two used to render as
 * a wall of six hundred words, because a blank-line split found nothing to
 * split on and produced a single paragraph.
 *
 * So the model's breaks are honoured where it wrote any and reconstructed where
 * it did not. This reflows text rather than displaying it verbatim, which is
 * worth being explicit about — but the shape it reflows to is the shape the
 * prompt asked for, and the alternative on those rows is unreadable.
 */
function toParagraphs(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  // Blank lines are the model doing what it was asked. Authoritative.
  const byBlankLine = trimmed
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
  if (byBlankLine.length > 1) return byBlankLine

  // Nothing to honour. Single newlines are the next-best evidence of where the
  // model meant to break; with none of those either, fall back to sentences.
  const lines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const units = lines.length > 1 ? lines : splitSentences(trimmed)

  // Accumulate until the paragraph is long enough, counting sentences rather
  // than units — so a line holding one sentence merges with its neighbours,
  // and a line already holding four stands alone.
  const paragraphs: string[] = []
  let current: string[] = []
  let sentences = 0
  for (const unit of units) {
    current.push(unit)
    sentences += splitSentences(unit).length
    if (sentences >= SENTENCES_PER_PARAGRAPH) {
      paragraphs.push(current.join(' '))
      current = []
      sentences = 0
    }
  }
  if (current.length > 0) paragraphs.push(current.join(' '))
  return paragraphs
}

/**
 * Sentences, for the case where they are the only break available.
 *
 * Splits after terminal punctuation followed by a capital, then rejoins any
 * piece too short to be a sentence — which is what keeps "U.S. Marines" and
 * "Mr. Bergman" whole without carrying a list of abbreviations around.
 */
function splitSentences(text: string): string[] {
  const pieces = text.split(/(?<=[.!?])\s+(?=["'“([]?[A-Z0-9])/)
  const merged: string[] = []
  for (const piece of pieces) {
    const previous = merged[merged.length - 1]
    if (previous !== undefined && previous.length < MIN_SENTENCE_CHARS) {
      merged[merged.length - 1] = `${previous} ${piece}`
    } else {
      merged.push(piece)
    }
  }
  return merged.filter(Boolean)
}

/**
 * One line saying what wrote this row. Every part is optional: rows written
 * before a column existed carry nulls, and a gap has to read as "not recorded"
 * rather than as a broken panel.
 */
function describeProvenance(data: AnalysisResponse, t: TFunction): string | null {
  const p = data.provenance
  if (!p) return null
  const parts: string[] = []
  if (p.model) parts.push(p.model)
  if (p.retrievalMode) parts.push(t(`mediaDetail.analysis.admin.mode.${p.retrievalMode}`))
  if (p.sourceCount != null) {
    parts.push(t('mediaDetail.analysis.admin.sourceCount', { count: p.sourceCount }))
  }
  if (p.retrievedChars != null) {
    parts.push(
      t('mediaDetail.analysis.admin.retrievedChars', { chars: p.retrievedChars.toLocaleString() })
    )
  }
  parts.push(t('mediaDetail.analysis.admin.promptVersion', { version: p.promptVersion }))
  if (data.analyzedAt) parts.push(new Date(data.analyzedAt).toLocaleString())
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Maps the stored grade onto an i18n key fragment. */
function gradeKey(grade: string): string {
  if (grade === 'substantial') return 'substantial'
  if (grade === 'reviews-only') return 'reviewsOnly'
  return 'almostNothing'
}
