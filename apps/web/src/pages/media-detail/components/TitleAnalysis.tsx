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
 * ONE OF THOSE QUESTIONS TURNED OUT NOT TO BE PRE-VIEWING. Where a work sits
 * can be the thing it withholds: measured on Incendies, a model answering the
 * tradition question correctly named the earlier work the film is patterned on,
 * which tells anyone who knows that one how this one ends. That is answered in
 * the prompt now — the tradition question carries its own rule about naming an
 * antecedent whose ending would travel across to this one.
 *
 * IT WAS BRIEFLY ANSWERED HERE INSTEAD, by collapsing the tradition run behind
 * a disclosure, and that is gone. Collapsing part of a short article costs
 * every reader a click on every title to protect a minority of them, and the
 * paragraph index the model writes is more useful as headings than as a gate.
 * The consequence is worth stating rather than rediscovering: the prompt rule
 * is now the only protection, and it is an instruction, so it will eventually
 * fail on some title.
 *
 * SO EACH RUN IS HEADED WITH WHAT IT ANSWERS — see `paragraphs` below and core's
 * analysis/segments.ts. The model is still forbidden from writing headings into
 * its own prose (a named empty section invites padding); these come from the
 * index it writes afterwards, which is the whole reason that index exists.
 *
 * Three states, and they must stay distinguishable:
 *   - an analysis    -> render it
 *   - asked, declined -> say so plainly; there is nothing more to get
 *   - never asked     -> offer the button
 * A panel that renders identically for "we looked and there is nothing" and
 * "nobody has looked" would send people clicking at a wall.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Collapse,
  Paper,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  ArrowForward as ArrowForwardIcon,
  AutoStories as AutoStoriesIcon,
  Autorenew as AutorenewIcon,
  ExpandMore as ExpandMoreIcon,
  Translate as TranslateIcon,
} from '@mui/icons-material'
import type { TFunction } from 'i18next'
import { useAuth } from '../../../hooks/useAuth'
import { pollOutcome } from '../analysisPoll'
import { readMinutes, sectionHeading } from '../analysisText'
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

/**
 * A run of the analysis and the questions it answers.
 *
 * The ids arrive raw rather than as finished labels, the way `sourceGrade` and
 * `declineReason` already do — the vocabulary is small, closed and stable, and
 * this side is the one holding 15 locales. An id with no translation renders no
 * heading rather than a raw key. The SPLIT is still core's, because this file's
 * `toParagraphs` does not divide the prose the way the model's paragraph map
 * counts it, so an index resolved here would label the wrong paragraph.
 */
type AnalysisQuestionId =
  | 'work'
  | 'structure'
  | 'tradition'
  | 'dispute'
  | 'intent'
  | 'circumstances'
  | 'reception'

interface AnalysisSegment {
  text: string
  questions: AnalysisQuestionId[]
}

/**
 * A machine translation of the analysis into the language the page is shown
 * in, already cut into the same labelled sections as the original (the server
 * reuses the original's paragraph index; core translation/store.ts). Absent
 * when there is none, or from an older server — the panel then shows the
 * original, exactly as before translations existed.
 */
interface AnalysisTranslation {
  language: string
  source_language: string
  text: string
  paragraphs: AnalysisSegment[]
}

interface AnalysisResponse {
  attempted: boolean
  translation?: AnalysisTranslation
  analysis: string | null
  /**
   * Absent from an older server, and empty for a declined row. Either way the
   * fallback below renders `analysis` as one unlabelled run, which is exactly
   * what this panel did before segments existed.
   */
  paragraphs?: AnalysisSegment[]
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
  /**
   * The server is writing one right now. Absent from an older server, which
   * reads as false and simply means the panel never starts a poll — the same
   * behaviour it had before polling existed.
   */
  generating?: boolean
  /**
   * How the last generation ended, when it ended badly. A failure writes no
   * row, so without this a poll cannot tell "it failed" from "nobody ever
   * asked" and the spinner would quietly turn back into the button.
   */
  failure?: string
}

/**
 * How often the panel asks whether the analysis is ready.
 *
 * Three seconds against a job measured in minutes is a cheap cache read per
 * viewer, and the interval is what decides how long a finished analysis sits
 * unseen — so it is sized for the end of the wait, not the length of it.
 */
const POLL_INTERVAL_MS = 3000

/**
 * Consecutive failed POLLS tolerated before giving up.
 *
 * A poll that fails is not a generation that failed - a dropped wifi connection
 * must not be reported as the model refusing - so it retries. It is bounded
 * because the alternative to giving up is a spinner that never stops.
 */
const MAX_POLL_FAILURES = 5

interface TitleAnalysisProps {
  mediaType: MediaType
  mediaId: string
}

export function TitleAnalysis({ mediaType, mediaId }: TitleAnalysisProps) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  // The language the page is displayed in rides along so the server can attach
  // a translation in it — only the client knows which one it rendered (the
  // synopsis does the same, `useMediaDetail`).
  const displayLanguage = i18n.resolvedLanguage ?? i18n.language
  const analysisUrl = `/api/analysis/${mediaType}/${mediaId}?lang=${encodeURIComponent(displayLanguage)}`
  const [showOriginal, setShowOriginal] = useState(false)
  const isAdmin = user?.isAdmin === true
  const [data, setData] = useState<AnalysisResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Collapsed by default on every title — see the spoiler note above.
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<number | 'all'>(0)
  const [showSources, setShowSources] = useState(false)

  // `analysisUrl` carries the title and the display language, so a change of
  // either reloads — and a new title starts on its translation again.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setGenerating(false)
    setShowOriginal(false)
    fetch(analysisUrl, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: AnalysisResponse | null) => {
        if (cancelled) return
        setData(json)
        // Somebody is already writing this one — this tab, before a reload, or
        // another reader entirely. Join the wait rather than offering a button
        // that would only answer 202.
        //
        // A stored `failure` is deliberately NOT surfaced here. An error means
        // "what you just asked for did not work", and nobody asked for
        // anything by opening the page; a joiner still sees it, because their
        // own press is what starts their poll.
        if (json?.generating) setGenerating(true)
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
  }, [analysisUrl])

  // Keyed on the TITLE, not `analysisUrl`: a change of display language reloads
  // the text but must not close a panel somebody is reading.
  useEffect(() => {
    setOpen(false)
    setTab(0)
    setShowSources(false)
  }, [mediaType, mediaId])

  // A failed run is reported inside the panel, and the Write button that starts
  // it sits in the header — so a failure while collapsed would be invisible.
  useEffect(() => {
    if (error) setOpen(true)
  }, [error])

  /**
   * THE WAIT LIVES HERE, NOT IN THE REQUEST.
   *
   * Writing an analysis is minutes, and the POST used to hold its connection
   * open for all of it, sending no byte until it finished — so whichever hop
   * in front of the API had the shortest patience cut the request long before
   * the work was done, while the server carried on and stored a perfectly good
   * row. The panel showed a dead spinner or a generic failure, and the
   * analysis appeared if you waited and reloaded.
   *
   * The POST answers 202 now and this polls the GET, which already knew how to
   * report `generating`. Nothing holds a connection open, so there is nothing
   * left to time out.
   */
  useEffect(() => {
    if (!generating) return
    let cancelled = false
    let timer: number | undefined
    let failures = 0

    const tick = async () => {
      try {
        const res = await fetch(analysisUrl, {
          credentials: 'include',
        })
        if (!res.ok) throw new Error(String(res.status))
        const json = (await res.json()) as AnalysisResponse
        if (cancelled) return
        failures = 0

        const outcome = pollOutcome(json)
        if (outcome.kind === 'wait') {
          timer = window.setTimeout(tick, POLL_INTERVAL_MS)
          return
        }

        setGenerating(false)
        if (outcome.kind === 'failed') {
          setError(outcome.error ?? t('mediaDetail.analysis.failed'))
          return
        }
        setData(json)
      } catch {
        if (cancelled) return
        failures += 1
        if (failures >= MAX_POLL_FAILURES) {
          setGenerating(false)
          setError(t('mediaDetail.analysis.failed'))
          return
        }
        timer = window.setTimeout(tick, POLL_INTERVAL_MS)
      }
    }

    timer = window.setTimeout(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [generating, analysisUrl, t])

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
          setGenerating(false)
          setError(json?.error ?? t('mediaDetail.analysis.failed'))
          return
        }
        // 202 means the work has started and the effect above collects it; 200
        // means it was already cached and there is nothing to wait for. There
        // is deliberately no `finally` clearing `generating` — leaving it true
        // is what starts the poll.
        if (res.status === 202) return
        setGenerating(false)
        setData(json as AnalysisResponse)
      } catch {
        setGenerating(false)
        setError(t('mediaDetail.analysis.failed'))
      }
    },
    [mediaType, mediaId, t]
  )

  // The text the reader is shown, for the read-time line. A memo (and above the
  // early return, with the other hooks) because it scans the whole text.
  const shownText = useMemo(() => {
    const shownTranslation = data?.translation
    return !showOriginal && shownTranslation && shownTranslation.paragraphs.length > 0
      ? shownTranslation.text
      : (data?.analysis ?? '')
  }, [data, showOriginal])
  const minutes = useMemo(() => readMinutes(shownText), [shownText])

  if (loading) return null

  const hasAnalysis = Boolean(data?.attempted && data.analysis)
  const declined = Boolean(data?.attempted && !data.analysis)
  // Offered only over an analysis that exists and is behind the current
  // prompt. It disappears of its own accord once used, because the rewritten
  // row is current — which is what bounds the spend without an admin gate:
  // one rewrite per title per prompt version, not a button anyone can lean on.
  const canRewrite = hasAnalysis && Boolean(data?.stale)
  // One open run holding everything is the fallback, not a special case: it is
  // what an ungated analysis produces anyway, so an older server and a row with
  // no usable paragraph map both land on the path that was here before.
  const original: AnalysisSegment[] =
    data?.paragraphs && data.paragraphs.length > 0
      ? data.paragraphs
      : data?.analysis
        ? [{ text: data.analysis, questions: [] }]
        : []
  // The translation, when there is one and the reader has not asked for the
  // original. It arrives already sectioned, under the same headings.
  const translation = data?.translation && data.translation.paragraphs.length > 0 ? data.translation : null
  const showingTranslation = translation !== null && !showOriginal
  const segments: AnalysisSegment[] = showingTranslation ? translation.paragraphs : original
  // WHETHER TO REBUILD THE PARAGRAPHS IS A FACT ABOUT THE WHOLE ANALYSIS, and
  // it has to be decided here because a segment cannot answer it. `toParagraphs`
  // reflows by sentence count when it finds no blank line, which is right for a
  // row the model wrote as one unbroken block and catastrophic per segment: a
  // single paragraph never contains a blank line, so every paragraph would be
  // reflowed and cut at four sentences. That shipped, and it split a six-
  // sentence opening into four sentences plus a stranded two-sentence stub.
  // Decided on the text actually shown: a translation keeps the original's
  // paragraph breaks, but it is the shown text the sections were cut from.
  const reflow = !/\n{2,}/.test((showingTranslation ? translation.text : data?.analysis) ?? '')
  const provenanceLine = data ? describeProvenance(data, t) : null
  const chip = analysisChip(data, t)

  // THE SECTIONS ARE TABS ONLY WHEN EVERY RUN CARRIES A HEADING. A row with no
  // paragraph map (older rows, a map the writer got wrong) arrives as one
  // unlabelled run, and a single tab named nothing is worse than the plain page
  // those rows had before.
  const headings = segments.map((segment) =>
    sectionHeading(segment.questions, (question) => questionLabel(t, question))
  )
  const tabbed = segments.length > 1 && headings.every(Boolean)
  const activeTab: number | 'all' =
    !tabbed || tab === 'all' ? 'all' : Math.min(tab, segments.length - 1)
  const sourceCount = data?.sources?.length ?? 0
  const subtitle = hasAnalysis
    ? tabbed
      ? t('mediaDetail.analysis.summary', { count: segments.length, minutes })
      : t('mediaDetail.analysis.summaryPlain', { minutes })
    : null

  // No outer padding or margin: this renders inside the detail page's left
  // column, which supplies both. It used to be a full-width band above the
  // two-column grid, where the prose ran the whole width of the page and the
  // panel's right edge had nothing to line up with.
  return (
    <Box data-tour="title-analysis">
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        {/* The header is the toggle. A div-backed ButtonBase rather than a
            button, because the generate button can sit inside it and a button
            inside a button is invalid; ButtonBase supplies the role, the
            keyboard activation and the focus ring, and ignores key presses
            that start on the nested button. */}
        <ButtonBase
          component="div"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          sx={{
            display: 'flex',
            width: '100%',
            alignItems: 'center',
            justifyContent: 'flex-start',
            textAlign: 'start',
            gap: 1.5,
            px: 2,
            py: 1.5,
          }}
        >
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              bgcolor: 'action.selected',
              color: 'primary.main',
            }}
          >
            <AutoStoriesIcon fontSize="small" />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* Wraps rather than overflowing: "No published sources" beside the
                heading is wider than a phone's column. */}
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                columnGap: 1,
                rowGap: 0.5,
              }}
            >
              <Typography variant="subtitle1" fontWeight={600}>
                {t(
                  mediaType === 'series'
                    ? 'mediaDetail.analysis.headingSeries'
                    : 'mediaDetail.analysis.headingMovie'
                )}
              </Typography>
              {/* What state this title is in, before anyone spends a click
                  finding out. See `analysisChip` for the five readings.

                  A title nobody has asked about yet gets no chip at all — it
                  gets the button, here rather than inside, because the panel is
                  collapsed by default and an action nobody can see is an action
                  nobody takes. */}
              {chip ? (
                <Tooltip title={chip.tooltip}>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={chip.color}
                    label={chip.label}
                    sx={{ height: 20, fontSize: '0.7rem' }}
                  />
                </Tooltip>
              ) : (
                <Button
                  size="small"
                  variant="outlined"
                  disabled={generating}
                  startIcon={generating ? <CircularProgress size={12} /> : undefined}
                  // The header toggles the panel. Without this the press
                  // toggles it instead of starting the run.
                  onClick={(event) => {
                    event.stopPropagation()
                    run(false)
                  }}
                  sx={{ py: 0, minHeight: 24, fontSize: '0.7rem', textTransform: 'none' }}
                >
                  {generating
                    ? t('mediaDetail.analysis.generating')
                    : t('mediaDetail.analysis.generate')}
                </Button>
              )}
            </Box>
            {subtitle && (
              <Typography variant="caption" color="text.secondary" display="block">
                {subtitle}
              </Typography>
            )}
          </Box>
          <Box
            aria-hidden
            sx={{
              display: 'flex',
              color: 'text.secondary',
              transition: 'transform 0.2s',
              transform: open ? 'rotate(180deg)' : 'none',
            }}
          >
            <ExpandMoreIcon />
          </Box>
        </ButtonBase>

        {/* What is inside, before anyone opens it. Names only — no prose, so
            nothing here can brush against an ending. */}
        {!open && hasAnalysis && tabbed && (
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 0.75,
              px: 2,
              pb: 1.5,
              pl: { xs: 2, sm: 8.5 },
            }}
          >
            {headings.map((heading, i) => (
              <Chip
                key={i}
                size="small"
                variant="outlined"
                label={heading}
                onClick={() => {
                  setTab(i)
                  setOpen(true)
                }}
                sx={{ height: 22, fontSize: '0.72rem' }}
              />
            ))}
          </Box>
        )}

        <Collapse in={open} unmountOnExit>
          {error && (
            <Alert severity="warning" sx={{ m: 2 }}>
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

                  One section at a time, with the whole thing a tab away: the
                  panel used to print every run in a single scroll, which made
                  it a wall on exactly the titles with the most to say. The
                  measure is still capped so a line stays trackable.

                  No breakpoints: this page also renders inside MediaDetailModal
                  and beside the assistant dock, where a window-width media
                  query would be wrong. */}
              {tabbed && (
                <Tabs
                  value={activeTab}
                  onChange={(_, value: number | 'all') => setTab(value)}
                  variant="scrollable"
                  scrollButtons="auto"
                  sx={{ borderBottom: 1, borderColor: 'divider', px: 1, minHeight: 40 }}
                >
                  {headings.map((heading, i) => (
                    <Tab
                      key={i}
                      value={i}
                      label={heading}
                      sx={{ textTransform: 'none', minHeight: 40 }}
                    />
                  ))}
                  <Tab
                    value="all"
                    label={t('mediaDetail.analysis.readAll')}
                    sx={{ textTransform: 'none', minHeight: 40, marginInlineStart: 'auto' }}
                  />
                </Tabs>
              )}
              <Box sx={{ px: 2.5, pt: 2, pb: 1 }}>
                <Box sx={{ maxWidth: '84ch' }}>
                  {/* The same control the synopsis has, with its strings, so
                      a reader meets one convention for machine translation. */}
                  {translation && (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 1,
                        mb: 1,
                      }}
                    >
                      {showingTranslation && (
                        <Typography variant="caption" color="text.secondary">
                          {t('mediaDetail.hero.machineTranslated')}
                        </Typography>
                      )}
                      <Button
                        size="small"
                        startIcon={<TranslateIcon />}
                        onClick={() => {
                          setShowOriginal((shown) => !shown)
                          // The two texts are cut into sections separately, so
                          // a tab index from one does not belong to the other.
                          setTab(0)
                        }}
                        sx={{ textTransform: 'none' }}
                      >
                        {showOriginal
                          ? t('mediaDetail.hero.showTranslation')
                          : t('mediaDetail.hero.showOriginal')}
                      </Button>
                    </Box>
                  )}
                  {segments.map((segment, i) =>
                    activeTab === 'all' || activeTab === i ? (
                      <AnalysisSection
                        key={i}
                        text={segment.text}
                        questions={segment.questions}
                        reflow={reflow}
                        // A single tab already says what it is.
                        showHeading={activeTab === 'all'}
                      />
                    ) : null
                  )}

                  {tabbed && activeTab !== 'all' && activeTab < segments.length - 1 && (
                    <Button
                      size="small"
                      endIcon={
                        <ArrowForwardIcon
                          fontSize="small"
                          sx={(theme) => (theme.direction === 'rtl' ? { transform: 'scaleX(-1)' } : {})}
                        />
                      }
                      onClick={() => setTab(activeTab + 1)}
                      sx={{ textTransform: 'none', mt: 0.5 }}
                    >
                      {headings[activeTab + 1]}
                    </Button>
                  )}

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
              </Box>

              {(sourceCount > 0 || (tabbed && activeTab !== 'all')) && (
                <Box
                  sx={{
                    borderTop: 1,
                    borderColor: 'divider',
                    bgcolor: 'action.hover',
                    px: 2,
                    py: 1,
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                    }}
                  >
                    <Box
                      sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, alignItems: 'center' }}
                    >
                      {tabbed && activeTab !== 'all' && (
                        <Typography variant="caption" color="text.secondary">
                          {t('mediaDetail.analysis.sectionOf', {
                            current: activeTab + 1,
                            total: segments.length,
                          })}
                        </Typography>
                      )}
                      {sourceCount > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          {t('mediaDetail.analysis.basedOnSources', { count: sourceCount })}
                        </Typography>
                      )}
                    </Box>
                    {sourceCount > 0 && (
                      <Button
                        size="small"
                        onClick={() => setShowSources((shown) => !shown)}
                        sx={{ textTransform: 'none', minHeight: 24, py: 0 }}
                      >
                        {showSources
                          ? t('mediaDetail.analysis.hideSources')
                          : t('mediaDetail.analysis.viewSources')}
                      </Button>
                    )}
                  </Box>
                  <Collapse in={showSources} unmountOnExit>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                      sx={{ mt: 1, mb: 0.5 }}
                    >
                      {t('mediaDetail.analysis.sourcesLabel')}
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, pb: 0.5 }}>
                      {/* The domain is the label because it is the part that
                          says something — whether this came from a film journal
                          or a listicle — while article titles are long and
                          mostly repeat the film’s name. The link rides
                          underneath, and only when the row carries one:
                          analyses written under native grounding store no URL
                          by design. */}
                      {(data?.sources ?? []).map((source, i) => (
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
                  </Collapse>
                </Box>
              )}
            </>
          )}

          <Box sx={{ px: 2.5, pb: 2, pt: hasAnalysis ? 1 : 2 }}>
            {declined && (
              <Typography variant="body2" color="text.secondary">
                {t(
                  data?.declineReason === 'thin_sources'
                    ? 'mediaDetail.analysis.declinedThinSources'
                    : 'mediaDetail.analysis.declinedNoCraft'
                )}
              </Typography>
            )}

            {/* No button down here: it is in the header, where it is reachable
              without opening the panel first. */}
            {!hasAnalysis && !declined && (
              <Typography variant="body2" color="text.secondary">
                {generating
                  ? t('mediaDetail.analysis.generating')
                  : t('mediaDetail.analysis.notYetGenerated')}
              </Typography>
            )}
            {/* The wait is minutes, and nothing on screen used to say so — which
              is most of why a slow run read as a broken one. It also says the
              page may be left, which is true now that the work outlives the
              request rather than merely happening to survive it. */}
            {generating && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                {t('mediaDetail.analysis.generatingNote')}
              </Typography>
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
                      generating ? (
                        <CircularProgress size={16} />
                      ) : (
                        <AutorenewIcon fontSize="small" />
                      )
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
          </Box>
        </Collapse>
      </Paper>
    </Box>
  )
}

/**
 * A run of the analysis, rendered as paragraphs.
 *
 * No pre-wrap. The model separates its sentences with single newlines as well
 * as its paragraphs with blank ones, and preserving the former broke every
 * sentence onto its own line — an article rendered as a list, each line ending
 * wherever the sentence did. Letting HTML collapse whitespace is what makes
 * paragraphs read as paragraphs; `toParagraphs` decides where the breaks go.
 */
function AnalysisProse({ text, reflow }: { text: string; reflow: boolean }) {
  return (
    <>
      {(reflow ? toParagraphs(text) : splitOnBlankLines(text)).map((para, i) => (
        <Typography key={i} variant="body2" sx={{ mb: 2, lineHeight: 1.75 }}>
          {para}
        </Typography>
      ))}
    </>
  )
}

/** An id with no translation renders no heading rather than a raw key. */
function questionLabel(t: TFunction, question: string): string {
  return t(`mediaDetail.analysis.section.${question}`, { defaultValue: '' })
}

/**
 * One run of the analysis, under a heading for what it answers.
 *
 * The heading is an `overline` rather than a real heading level: it names a part
 * of a short article instead of opening a section of a document, and it must
 * not out-weigh the panel's own title two rows above it.
 *
 * A run the model labelled with nothing renders with no heading at all — which
 * is also every row written before the paragraph index existed, so that is the
 * common case rather than an edge.
 */
function AnalysisSection({
  text,
  questions,
  reflow,
  showHeading = true,
}: {
  text: string
  questions: AnalysisQuestionId[]
  reflow: boolean
  showHeading?: boolean
}) {
  const { t } = useTranslation()
  const heading = sectionHeading(questions, (question) => questionLabel(t, question))

  return (
    <Box sx={{ mb: 1 }}>
      {showHeading && heading && (
        <Typography
          variant="overline"
          color="text.secondary"
          display="block"
          sx={{ lineHeight: 1.6, letterSpacing: '0.08em' }}
        >
          {heading}
        </Typography>
      )}
      <AnalysisProse text={text} reflow={reflow} />
    </Box>
  )
}

/**
 * The model's own paragraphs, honoured exactly.
 *
 * This is the ordinary path. Segments arrive already split on blank lines by
 * core's `splitAnalysisParagraphs`, so a segment holds one or more whole
 * paragraphs joined the way the model wrote them, and nothing here may second-
 * guess where they end.
 */
function splitOnBlankLines(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
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
 *
 * CALL IT WITH A WHOLE ANALYSIS, NEVER WITH ONE SEGMENT. Its first branch asks
 * whether the text carries blank lines, and one paragraph never does — so per
 * segment the question always answers "no" and the sentence fallback runs on
 * prose that never needed it. The caller decides once, on `data.analysis`, and
 * passes the answer down as `reflow`.
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

/**
 * The header chip: what state this title's analysis is in, at a glance.
 *
 * Five readings, and the point of all of them is to answer "is there anything
 * behind this chevron" before the click rather than after it:
 *
 *   substantial     -> Available, green      (grade on the tooltip)
 *   reviews-only    -> Partial, blue         (grade on the tooltip)
 *   almost-nothing  -> Sparse sources, grey  (the label IS the grade)
 *   declined        -> red, and WHICH decline
 *   never asked     -> no chip; the caller puts the generate button here
 *
 * The two declines stay apart because one red label cannot be true for both:
 * "No published sources" is simply false for a title with a shelf of writing
 * about it and nothing to say about how it was made. The body still carries
 * the full sentence for either.
 */
function analysisChip(
  data: AnalysisResponse | null,
  t: TFunction
): { label: string; color: 'success' | 'info' | 'default' | 'error'; tooltip: string } | null {
  if (!data?.attempted) return null

  if (data.analysis) {
    if (data.sourceGrade === 'reviews-only') {
      return {
        label: t('mediaDetail.analysis.partial'),
        color: 'info',
        tooltip: t('mediaDetail.analysis.grade.reviewsOnly'),
      }
    }
    if (data.sourceGrade === 'almost-nothing') {
      return {
        label: t('mediaDetail.analysis.grade.almostNothing'),
        color: 'default',
        tooltip: '',
      }
    }
    // Including rows written before the grade column existed, which carry
    // none. The analysis is there either way, and inventing a grade for it
    // would be worse than showing none.
    return {
      label: t('mediaDetail.analysis.available'),
      color: 'success',
      tooltip: data.sourceGrade ? t('mediaDetail.analysis.grade.substantial') : '',
    }
  }

  return {
    label: t(
      data.declineReason === 'thin_sources'
        ? 'mediaDetail.analysis.noPublishedSources'
        : 'mediaDetail.analysis.nothingToReport'
    ),
    color: 'error',
    tooltip: '',
  }
}
