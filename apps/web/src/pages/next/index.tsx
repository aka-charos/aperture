import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import SkipNextOutlinedIcon from '@mui/icons-material/SkipNextOutlined'
import ViewListIcon from '@mui/icons-material/ViewList'
import HubIcon from '@mui/icons-material/Hub'
import CasinoIcon from '@mui/icons-material/Casino'
import DirectionsWalkIcon from '@mui/icons-material/DirectionsWalk'
import { PageHeading } from '@/components/PageHeading'
import { MediaDetailModalProvider } from '@/hooks/MediaDetailModalProvider'
import { useOpenMedia } from '@/hooks/useOpenMedia'
import { useWatchedRevision } from '@/hooks/useWatchedRevision'
import { TitlePicker } from './TitlePicker'
import { TitleTile } from './TitleTile'
import { TrailStrip } from './TrailStrip'
import { SaveTrailButton } from './SaveTrailButton'
import { fetchNext, useTrailData, useTrailLimits } from './api'
import { ROW_KINDS, extendTrail, stepTrail } from './trail'
import type { TrailEntityKind, TrailLink, TrailTitle } from './types'
import { NextMap } from './NextMap'
import { PeopleRow } from './PeopleRow'
import {
  itemLink,
  nextQuery,
  orderReasons,
  readNextUrl,
  reasonText,
  rowLink,
  rowShown,
  writeNextUrl,
  type NextUrlState,
} from './reasons'
import { useReasonText } from './useReasonText'
import type { NextFromHereResponse, NextItem, NextPeopleRow, NextRowMember, NextWalkResponse } from './types'

/** Reasons shown under each title; the rest are not more convincing. */
const REASONS_SHOWN = 3

/**
 * Next from here: what to watch after a title, and the way back. One page for
 * what Trails, the Explore graph and the first Next from here each did part of:
 *
 * - **Close in feel** (the graph's embedding neighbours), each title with the
 *   reasons it is there in the viewer's own terms: people on both, people they
 *   keep returning to, themes the two share, a network they favour.
 * - **The people behind it** (Trails' threads), one row per person who shaped
 *   the start, ordered by what the viewer's record says of them, never by
 *   rarity; their other work unseen first. Its **themes and studios** follow,
 *   rarest first, and chips narrow the rows to the kinds wanted.
 * - **The map** (the Explore graph): the same titles drawn around the start,
 *   every line a named reason.
 * - **The trail** (Trails' strip): every step taken from a suggestion is kept,
 *   can be gone back to and saved as a playlist, and is never suggested again.
 *   **Take me somewhere** walks a few steps for the viewer, each to the best
 *   suggestion from the step before.
 *
 * The work is the API's; this page states it.
 */
export function NextFromHerePage() {
  return (
    <MediaDetailModalProvider>
      <NextFromHere />
    </MediaDetailModalProvider>
  )
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; notFound: boolean }
  | { status: 'ready'; data: NextFromHereResponse }

function NextFromHere() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const openMedia = useOpenMedia()
  const limits = useTrailLimits()
  const maxTrail = limits?.maxTrailLength ?? null
  const state = useMemo(() => readNextUrl(params, maxTrail ?? undefined), [params, maxTrail])
  const update = useCallback(
    (patch: Partial<NextUrlState>) => setParams(writeNextUrl({ ...state, ...patch })),
    [state, setParams]
  )
  const { trail } = state
  const trailKey = trail.join(',')
  const { cards, links, remember, rememberLink } = useTrailData(trail, maxTrail)

  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [surprising, setSurprising] = useState(false)
  // A failed Surprise me is said beside its button; the page on screen stays.
  const [surpriseFailed, setSurpriseFailed] = useState(false)
  const [walking, setWalking] = useState(false)
  const [walkNote, setWalkNote] = useState<{ severity: 'info' | 'warning'; text: string } | null>(null)
  // The trail as it is now, for a walk answering after the viewer stepped elsewhere.
  const currentTrail = useRef(trailKey)
  currentTrail.current = trailKey

  // A title marked watched in the dialog leaves the suggestions: the answer is
  // asked again when the viewer's watched set moves.
  const watchRevision = useWatchedRevision()

  // A refresh of the same start (the watched set moved) keeps the lists on
  // screen while it asks; a new start shows the spinner.
  const loadedKey = useRef<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    if (loadedKey.current !== trailKey) setLoad({ status: 'loading' })
    fetch(`/api/next-from-here${nextQuery(trailKey ? trailKey.split(',') : [])}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          loadedKey.current = null
          setLoad({ status: 'error', notFound: response.status === 404 })
          return
        }
        const data = (await response.json()) as NextFromHereResponse
        if (data.start) remember([data.start])
        loadedKey.current = trailKey
        setLoad({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoad({ status: 'error', notFound: false })
      })
    return () => controller.abort()
  }, [trailKey, attempt, watchRevision, remember])

  const data = load.status === 'ready' ? load.data : null
  const start = data?.start ?? null

  /** Start again from a title: a trail of one. */
  const startFrom = useCallback(
    (title: TrailTitle) => {
      remember([title])
      update({ trail: [title.ref] })
    },
    [remember, update]
  )

  /** Step on from the start to `title`, keeping the way here. */
  const stepTo = useCallback(
    (title: TrailTitle, link: TrailLink | null) => {
      if (!start) return
      // With no trail in the address the API chose the start; the trail begins there.
      const from = trail.length > 0 ? trail : [start.ref]
      remember([start, title])
      rememberLink(start.ref, title.ref, link)
      update({ trail: stepTrail(from, title.ref, maxTrail ?? undefined) })
    },
    [start, trail, remember, rememberLink, update, maxTrail]
  )

  const stepFromItem = useCallback((item: NextItem) => stepTo(item.title, itemLink(item)), [stepTo])
  const stepFromRow = useCallback(
    (row: NextPeopleRow, member: NextRowMember) => stepTo(member.title, rowLink(row, member)),
    [stepTo]
  )
  const open = useCallback((title: TrailTitle) => openMedia(title.type, title.id), [openMedia])

  const surprise = () => {
    setSurprising(true)
    setSurpriseFailed(false)
    fetchNext<{ title: TrailTitle }>('start')
      .then((response) => startFrom(response.title))
      .catch(() => setSurpriseFailed(true))
      .finally(() => setSurprising(false))
  }

  /** "Take me somewhere": a few steps from the start, each kept on the trail with what it went through. */
  const walk = () => {
    if (!start) return
    const from = trail.length > 0 ? trail : [start.ref]
    const askedFrom = trailKey
    setWalking(true)
    setWalkNote(null)
    fetchNext<NextWalkResponse>(`walk${nextQuery(from)}`)
      .then((response) => {
        // The viewer stepped elsewhere while it walked: this walk is no longer theirs.
        if (currentTrail.current !== askedFrom) return
        if (response.steps.length === 0) {
          setWalkNote({ severity: 'info', text: t('next.walk.none') })
          return
        }
        remember([response.start, ...response.steps.map((step) => step.title)])
        let previous = response.start.ref
        for (const step of response.steps) {
          rememberLink(previous, step.title.ref, step.via)
          previous = step.title.ref
        }
        update({ trail: extendTrail(from, response.steps.map((step) => step.title.ref), maxTrail ?? undefined) })
        if (limits && response.steps.length < limits.walkSteps) {
          setWalkNote({ severity: 'info', text: t('next.walk.short', { count: response.steps.length }) })
        }
      })
      .catch(() => setWalkNote({ severity: 'warning', text: t('next.walk.failed') }))
      .finally(() => setWalking(false))
  }

  /** A chip toggles its own kind; with none chosen every row shows. */
  const toggleKind = (kind: TrailEntityKind) =>
    update({ kinds: state.kinds.includes(kind) ? state.kinds.filter((k) => k !== kind) : [...state.kinds, kind] })

  const trailTitles = trail.map((ref) => cards.get(ref)).filter((card): card is TrailTitle => card != null)
  const nothing =
    data && start && data.close.length === 0 && data.people.length === 0 && data.moreRows.length === 0
  const allRows = data ? [...data.people, ...data.moreRows] : []
  // A kind chosen on an earlier start keeps its chip even when this start has
  // no row of it, so a filter carried in the address can always be undone.
  const kindsOffered = ROW_KINDS.filter(
    (kind) => state.kinds.includes(kind) || allRows.some((row) => row.entity.kind === kind)
  )
  const peopleShown = data ? data.people.filter((row) => rowShown(row, state.kinds)) : []
  const moreShown = data ? data.moreRows.filter((row) => rowShown(row, state.kinds)) : []

  return (
    <Box>
      <PageHeading
        title={t('next.title')}
        description={t('next.description')}
        icon={<SkipNextOutlinedIcon sx={{ color: 'primary.main', fontSize: 32 }} />}
      />

      <Stack spacing={1.5} sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <Box sx={{ flex: '1 1 320px', maxWidth: 480 }}>
            <TitlePicker label={t('next.picker.label')} value={start} onChange={(title) => title && startFrom(title)} />
          </Box>
          <Button
            variant="outlined"
            startIcon={surprising ? <CircularProgress size={16} /> : <CasinoIcon />}
            onClick={surprise}
            disabled={surprising}
          >
            {t('next.actions.surprise')}
          </Button>
        </Box>
        {surpriseFailed && (
          <Alert severity="warning" onClose={() => setSurpriseFailed(false)}>
            {t('next.errors.surprise')}
          </Alert>
        )}
        {data && data.starts.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
              {t('next.picker.recent')}
            </Typography>
            {data.starts.map((title) => (
              <Chip
                key={title.ref}
                label={title.year ? `${title.title} (${title.year})` : title.title}
                size="small"
                color={title.ref === start?.ref ? 'primary' : 'default'}
                variant={title.ref === start?.ref ? 'filled' : 'outlined'}
                onClick={() => startFrom(title)}
              />
            ))}
          </Box>
        )}
      </Stack>

      {trailTitles.length > 1 && (
        <Box component="section" sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle2">{t('next.trail.title')}</Typography>
            <Box sx={{ flex: 1 }} />
            <SaveTrailButton titles={trailTitles} />
            <Button size="small" onClick={() => update({ trail: trail.slice(-1) })}>
              {t('next.trail.clear')}
            </Button>
          </Box>
          <TrailStrip
            trail={trail}
            cards={cards}
            links={links}
            onStepBack={(position) => update({ trail: trail.slice(0, position + 1) })}
            onOpen={open}
          />
        </Box>
      )}

      {load.status === 'loading' && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {load.status === 'error' && (
        <Alert
          severity={load.notFound ? 'info' : 'warning'}
          action={
            load.notFound ? undefined : (
              <Chip label={t('next.actions.retry')} size="small" onClick={() => setAttempt((n) => n + 1)} />
            )
          }
        >
          {load.notFound ? t('next.errors.notFound') : t('next.errors.load')}
        </Alert>
      )}

      {data && !start && <Alert severity="info">{t('next.empty.noStart')}</Alert>}

      {data && start && (
        <>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 3, flexWrap: 'wrap' }}>
            <TitleTile title={start} onOpen={open} width={84} emphasised />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="overline" color="text.secondary">
                {t('next.after')}
              </Typography>
              <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
                {start.title}
                {start.year ? ` (${start.year})` : ''}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <Tooltip title={limits ? t('next.walk.tooltip', { count: limits.walkSteps }) : ''}>
                <span>
                  <Button
                    variant="contained"
                    startIcon={walking ? <CircularProgress size={16} color="inherit" /> : <DirectionsWalkIcon />}
                    onClick={walk}
                    disabled={walking}
                  >
                    {t('next.walk.button')}
                  </Button>
                </span>
              </Tooltip>
              <FormControlLabel
                control={<Switch checked={state.hideSeen} onChange={(_, checked) => update({ hideSeen: checked })} />}
                label={t('next.controls.hideSeen')}
              />
              <ToggleButtonGroup
                size="small"
                exclusive
                value={state.view}
                onChange={(_, view) => view && update({ view })}
                aria-label={t('next.controls.view')}
              >
                <ToggleButton value="list" aria-label={t('next.controls.list')}>
                  <ViewListIcon fontSize="small" sx={{ mr: 0.75 }} />
                  {t('next.controls.list')}
                </ToggleButton>
                <ToggleButton value="map" aria-label={t('next.controls.map')}>
                  <HubIcon fontSize="small" sx={{ mr: 0.75 }} />
                  {t('next.controls.map')}
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Box>

          {walkNote && (
            <Alert severity={walkNote.severity} onClose={() => setWalkNote(null)} sx={{ mb: 2 }}>
              {walkNote.text}
            </Alert>
          )}

          {nothing && <Alert severity="info">{t('next.empty.nothing', { title: start.title })}</Alert>}

          {state.view === 'map' ? (
            <NextMap data={data} onOpen={open} onStepItem={stepFromItem} onStepRow={stepFromRow} />
          ) : (
            <>
              {data.close.length > 0 && (
                <Box component="section" sx={{ mb: 4 }}>
                  <Typography variant="h6">{t('next.sections.close.title')}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {t('next.sections.close.description')}
                  </Typography>
                  <Box
                    sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}
                  >
                    {data.close.map((item) => (
                      <ItemCard key={item.title.ref} item={item} start={start} onOpen={open} onStep={stepFromItem} />
                    ))}
                  </Box>
                </Box>
              )}
              {(kindsOffered.length > 1 || state.kinds.length > 0) && (
                <Box
                  role="group"
                  aria-label={t('next.kinds.label')}
                  sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 2 }}
                >
                  <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                    {t('next.kinds.label')}
                  </Typography>
                  <Chip
                    label={t('next.kinds.all')}
                    size="small"
                    color={state.kinds.length === 0 ? 'primary' : 'default'}
                    variant={state.kinds.length === 0 ? 'filled' : 'outlined'}
                    aria-pressed={state.kinds.length === 0}
                    onClick={() => update({ kinds: [] })}
                  />
                  {kindsOffered.map((kind) => {
                    const chosen = state.kinds.includes(kind)
                    return (
                      <Chip
                        key={kind}
                        label={t(`next.kinds.${kind}`)}
                        size="small"
                        color={chosen ? 'primary' : 'default'}
                        variant={chosen ? 'filled' : 'outlined'}
                        aria-pressed={chosen}
                        onClick={() => toggleKind(kind)}
                      />
                    )
                  })}
                </Box>
              )}
              {allRows.length > 0 && peopleShown.length === 0 && moreShown.length === 0 && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  {t('next.kinds.noneLeft')}
                </Alert>
              )}
              {peopleShown.length > 0 && (
                <Box component="section" sx={{ mb: 4 }}>
                  <Typography variant="h6">{t('next.sections.people.title')}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {t('next.sections.people.description')}
                  </Typography>
                  <Stack spacing={1.5}>
                    {peopleShown.map((row) => (
                      <PeopleRow
                        // Per start: a row expanded on one title must not arrive
                        // expanded on the next, where the same person has a row too.
                        key={`${start.ref}:${row.entity.key}`}
                        row={row}
                        startType={start.type}
                        hideSeen={state.hideSeen}
                        onOpen={open}
                        onStep={stepFromRow}
                      />
                    ))}
                  </Stack>
                </Box>
              )}
              {moreShown.length > 0 && (
                <Box component="section" sx={{ mb: 4 }}>
                  <Typography variant="h6">{t('next.sections.more.title')}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {t('next.sections.more.description')}
                  </Typography>
                  <Stack spacing={1.5}>
                    {moreShown.map((row) => (
                      <PeopleRow
                        key={`${start.ref}:${row.entity.key}`}
                        row={row}
                        startType={start.type}
                        hideSeen={state.hideSeen}
                        onOpen={open}
                        onStep={stepFromRow}
                      />
                    ))}
                  </Stack>
                </Box>
              )}
            </>
          )}
        </>
      )}
    </Box>
  )
}

function ItemCard({
  item,
  start,
  onOpen,
  onStep,
}: {
  item: NextItem
  start: TrailTitle
  onOpen: (title: TrailTitle) => void
  onStep: (item: NextItem) => void
}) {
  const { t } = useTranslation()
  const say = useReasonText()
  const reasons = useMemo(() => orderReasons(item.reasons).slice(0, REASONS_SHOWN), [item.reasons])
  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
      <TitleTile
        title={item.title}
        onOpen={onOpen}
        onFollow={() => onStep(item)}
        followLabel={t('next.actions.from', { title: item.title.title })}
        width={92}
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="subtitle2" sx={{ lineHeight: 1.3 }}>
          {item.title.title}
          {item.title.year ? (
            <Typography component="span" variant="body2" color="text.secondary">
              {` (${item.title.year})`}
            </Typography>
          ) : null}
        </Typography>
        <Box component="ul" sx={{ m: 0, mt: 0.75, pl: 2.25, display: 'grid', gap: 0.5 }}>
          {reasons.map((reason, index) => (
            <Typography key={index} component="li" variant="body2" color={index === 0 ? 'text.primary' : 'text.secondary'}>
              {say(reasonText(reason, start.title, item.title.type))}
            </Typography>
          ))}
        </Box>
      </Box>
    </Paper>
  )
}
