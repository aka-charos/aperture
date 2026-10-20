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
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import RouteIcon from '@mui/icons-material/Route'
import CasinoOutlinedIcon from '@mui/icons-material/CasinoOutlined'
import DirectionsWalkIcon from '@mui/icons-material/DirectionsWalk'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import { PageHeading } from '@/components/PageHeading'
import { MediaDetailModalProvider } from '@/hooks/MediaDetailModalProvider'
import { useOpenMedia } from '@/hooks/useOpenMedia'
import { useWatchStatus } from '@/hooks/useWatchStatus'
import { TitlePicker } from './TitlePicker'
import { TitleTile } from './TitleTile'
import { TrailStrip } from './TrailStrip'
import { ThreadCard, type OpenedThread } from './ThreadCard'
import { SaveTrailButton } from './SaveTrailButton'
import { fetchTrails, isAbort, TrailsRequestError, useAnswers, useTrailData, useTrailLimits } from './api'
import {
  KIND_COLOR,
  TRAIL_KINDS,
  extendTrail,
  filterQuery,
  readTrailsUrl,
  stepTrail,
  writeTrailsUrl,
  type TrailsUrlState,
} from './labels'
import type {
  Thread,
  ThreadMember,
  ThreadResponse,
  ThreadsResponse,
  TrailEntityKind,
  TrailTitle,
  WalkResponse,
} from './types'

/**
 * Trails: start from a title and follow the people, franchises, companies and
 * uncommon keywords it shares with the rest of the library, one title at a
 * time, rarest link first. A separate page from the Explore graph, which draws
 * embedding neighbours; nothing here is a similarity score.
 */
export function TrailsPage() {
  return (
    <MediaDetailModalProvider>
      <FollowATrail />
    </MediaDetailModalProvider>
  )
}

const KIND_LABEL: Record<TrailEntityKind, string> = {
  person: 'trails.filters.kind.person',
  franchise: 'trails.filters.kind.franchise',
  company: 'trails.filters.kind.company',
  keyword: 'trails.filters.kind.keyword',
}

type Notice = { severity: 'info' | 'warning'; message: string } | null

function FollowATrail() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const limits = useTrailLimits()
  const openMedia = useOpenMedia()
  const maxTrail = limits?.maxTrailLength ?? null

  const state = useMemo(() => readTrailsUrl(params, maxTrail ?? undefined), [params, maxTrail])
  const update = useCallback(
    (patch: Partial<TrailsUrlState>) => setParams(writeTrailsUrl({ ...state, ...patch })),
    [state, setParams]
  )
  // What the page holds NOW, for an answer that arrives after the click that
  // asked for it: building on the state captured at the click would put back
  // a filter switched or a step taken while the request was out.
  const latest = useRef(state)
  latest.current = state
  const { trail } = state
  const current = trail.length > 0 ? trail[trail.length - 1] : null
  const filters = filterQuery(state)

  // A title marked watched while Hide what I've watched is on (in the dialog,
  // say) must leave the threads already loaded, so the answers are keyed by a
  // revision that moves when the viewer's watched set does — after it first
  // loads, which is not a change.
  const { watchedMovies, loading: watchLoading } = useWatchStatus()
  const [watchRevision, setWatchRevision] = useState(0)
  const seenWatched = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (watchLoading) return
    if (seenWatched.current && seenWatched.current !== watchedMovies) setWatchRevision((revision) => revision + 1)
    seenWatched.current = watchedMovies
  }, [watchedMovies, watchLoading])

  const { cards, links, remember, rememberLink } = useTrailData(trail, maxTrail)
  const { answers, hasAnswer, store, failure, fail, clearFailure } = useAnswers<ThreadsResponse>()
  const [opened, setOpened] = useState<ReadonlyMap<string, OpenedThread>>(() => new Map())
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState<'walk' | 'start' | null>(null)

  // Threads are asked per title AND filters: the same title hiding what was
  // watched is a different answer.
  const answerKey = current ? `${current}${filters}${state.hideWatched ? `#${watchRevision}` : ''}` : null
  const failedHere = answerKey != null && failure?.key === answerKey

  useEffect(() => {
    if (!current || !answerKey || hasAnswer(answerKey) || failedHere) return
    const controller = new AbortController()
    clearFailure()
    fetchTrails<ThreadsResponse>(`threads?title=${encodeURIComponent(current)}${filters}`, controller.signal)
      .then((response) => {
        remember([response.title])
        store(answerKey, response)
      })
      .catch((caught) => {
        if (isAbort(caught)) return
        fail(
          answerKey,
          caught instanceof TrailsRequestError && caught.status === 404
            ? t('trails.threads.notFound')
            : t('trails.errors.load')
        )
      })
    return () => controller.abort()
  }, [current, answerKey, filters, hasAnswer, failedHere, remember, store, fail, clearFailure, t])

  const onOpen = useCallback((title: TrailTitle) => openMedia(title.type, title.id), [openMedia])

  const startFrom = (title: TrailTitle) => {
    remember([title])
    setNotice(null)
    setParams(writeTrailsUrl({ ...latest.current, trail: [title.ref] }))
  }

  const follow = (title: TrailTitle, thread: Thread, member: ThreadMember) => {
    if (!current) return
    remember([title])
    // The thread followed IS the link between the two, whatever else they share.
    rememberLink(current, title.ref, {
      key: thread.key,
      kind: thread.kind,
      name: thread.name,
      photo: thread.photo,
      titleCount: thread.titleCount,
      rolesFrom: thread.roles,
      rolesTo: member.roles,
    })
    setNotice(null)
    update({ trail: stepTrail(trail, title.ref, maxTrail ?? undefined) })
  }

  const surprise = () => {
    setBusy('start')
    setNotice(null)
    // Chosen under the page's filters, so the start has threads to show.
    fetchTrails<{ title: TrailTitle }>(`start${filters ? `?${filters.slice(1)}` : ''}`)
      .then((response) => startFrom(response.title))
      .catch(() => setNotice({ severity: 'warning', message: t('trails.start.surpriseFailed') }))
      .finally(() => setBusy(null))
  }

  const walk = () => {
    if (!current || !limits) return
    setBusy('walk')
    setNotice(null)
    const visited = trail.slice(0, -1).join(',')
    const kinds = state.kinds.length > 0 ? `&kinds=${state.kinds.join(',')}` : ''
    fetchTrails<WalkResponse>(
      `walk?title=${encodeURIComponent(current)}${visited ? `&visited=${encodeURIComponent(visited)}` : ''}${kinds}`
    )
      .then((response) => {
        remember([response.start, ...response.steps.map((step) => step.title)])
        let from = response.start.ref
        for (const step of response.steps) {
          rememberLink(from, step.title.ref, step.via)
          from = step.title.ref
        }
        // The viewer stepped elsewhere while the walk was out: it no longer
        // starts where they are, so it is not added.
        const now = latest.current
        if (now.trail[now.trail.length - 1] !== response.start.ref) return
        if (response.steps.length > 0) {
          const walked = response.steps.map((step) => step.title.ref)
          setParams(writeTrailsUrl({ ...now, trail: extendTrail(now.trail, walked, limits.maxTrailLength) }))
        }
        if (response.steps.length === 0) setNotice({ severity: 'info', message: t('trails.walk.none') })
        else if (response.steps.length < limits.walkSteps) {
          setNotice({ severity: 'info', message: t('trails.walk.short', { count: response.steps.length }) })
        }
      })
      .catch(() => setNotice({ severity: 'warning', message: t('trails.walk.failed') }))
      .finally(() => setBusy(null))
  }

  const openAll = (thread: Thread) => {
    if (!current || !answerKey) return
    const key = `${answerKey}|${thread.key}`
    setOpened((previous) => new Map(previous).set(key, { status: 'loading' }))
    fetchTrails<ThreadResponse>(
      `thread?title=${encodeURIComponent(current)}&entity=${encodeURIComponent(thread.key)}${filters}`
    )
      .then((response) =>
        setOpened((previous) =>
          new Map(previous).set(
            key,
            response.thread
              ? { status: 'open', members: response.thread.others, more: response.thread.more }
              : { status: 'empty' }
          )
        )
      )
      .catch(() => setOpened((previous) => new Map(previous).set(key, { status: 'failed' })))
  }

  const closeAll = (thread: Thread) => {
    if (!answerKey) return
    setOpened((previous) => {
      const next = new Map(previous)
      next.delete(`${answerKey}|${thread.key}`)
      return next
    })
  }

  const toggleKind = (kind: TrailEntityKind) => {
    const kinds = state.kinds.includes(kind) ? state.kinds.filter((k) => k !== kind) : [...state.kinds, kind]
    // Every kind chosen is the same as none chosen: write it as none.
    update({ kinds: kinds.length === TRAIL_KINDS.length ? [] : kinds })
  }

  const response = answerKey ? (answers.get(answerKey) ?? null) : null
  const error = failedHere ? (failure?.message ?? null) : null
  const currentCard = current ? (cards.get(current) ?? response?.title ?? null) : null
  const trailTitles = trail.map((ref) => cards.get(ref)).filter((card): card is TrailTitle => card != null)

  return (
    <Box>
      <PageHeading title={t('trails.title')} description={t('trails.description')} icon={<RouteIcon />} />

      <Stack spacing={3}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
          <TitlePicker
            label={trail.length > 0 ? t('trails.threads.startAgain') : t('trails.threads.pick')}
            value={null}
            clearOnPick
            onChange={(picked) => {
              if (picked) startFrom(picked)
            }}
          />
          <Button
            variant="outlined"
            startIcon={busy === 'start' ? <CircularProgress size={16} /> : <CasinoOutlinedIcon />}
            disabled={busy != null}
            onClick={surprise}
          >
            {t('trails.start.surprise')}
          </Button>
          <Tooltip title={limits ? t('trails.walk.tooltip', { count: limits.walkSteps }) : ''}>
            <span>
              <Button
                variant="contained"
                startIcon={busy === 'walk' ? <CircularProgress size={16} color="inherit" /> : <DirectionsWalkIcon />}
                disabled={!current || !limits || busy != null}
                onClick={walk}
              >
                {t('trails.walk.button')}
              </Button>
            </span>
          </Tooltip>
          {trail.length > 1 && (
            <Button startIcon={<RestartAltIcon />} onClick={() => update({ trail: [trail[0]] })}>
              {t('trails.threads.backToStart')}
            </Button>
          )}
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <FormControlLabel
            control={<Switch checked={state.hideWatched} onChange={(_, checked) => update({ hideWatched: checked })} />}
            label={t('trails.filters.hideWatched')}
            sx={{ mr: 2 }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
            {t('trails.filters.kinds')}
          </Typography>
          {TRAIL_KINDS.map((kind) => {
            const selected = state.kinds.includes(kind)
            return (
              <Chip
                key={kind}
                label={t(KIND_LABEL[kind])}
                size="small"
                clickable
                aria-pressed={selected}
                variant={selected ? 'filled' : 'outlined'}
                onClick={() => toggleKind(kind)}
                sx={
                  selected
                    ? { bgcolor: KIND_COLOR[kind], color: 'common.white', '&:hover': { bgcolor: KIND_COLOR[kind] } }
                    : { borderColor: KIND_COLOR[kind] }
                }
              />
            )
          })}
          {state.kinds.length > 0 && (
            <Button size="small" onClick={() => update({ kinds: [] })}>
              {t('trails.filters.all')}
            </Button>
          )}
        </Box>

        {notice && (
          <Alert severity={notice.severity} onClose={() => setNotice(null)}>
            {notice.message}
          </Alert>
        )}

        {trail.length > 1 && (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
              <Typography variant="subtitle2" color="text.secondary">
                {t('trails.threads.trail')}
              </Typography>
              <SaveTrailButton titles={trailTitles} />
            </Box>
            <TrailStrip
              trail={trail}
              cards={cards}
              links={links}
              onStepBack={(position) => update({ trail: trail.slice(0, position + 1) })}
              onOpen={onOpen}
            />
          </Box>
        )}

        {!current && (
          <Typography color="text.secondary" sx={{ maxWidth: 640 }}>
            {t('trails.threads.empty')}
          </Typography>
        )}

        {error && <Alert severity="warning">{error}</Alert>}

        {current && !response && !error && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {response && currentCard && (
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <TitleTile title={currentCard} onOpen={onOpen} width={132} emphasised />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="h6" component="h2">
                {currentCard.title}
                {currentCard.year != null && (
                  <Typography component="span" color="text.secondary" sx={{ fontWeight: 400 }}>
                    {` (${currentCard.year})`}
                  </Typography>
                )}
              </Typography>
              <Typography color="text.secondary" variant="body2">
                {response.threads.length > 0
                  ? t('trails.threads.count', { count: response.total })
                  : state.hideWatched || state.kinds.length > 0
                    ? t('trails.filters.noneLeft', { title: currentCard.title })
                    : t('trails.threads.none', { title: currentCard.title })}
              </Typography>
            </Box>
          </Box>
        )}

        {response && response.threads.length > 0 && (
          <Stack spacing={2}>
            {response.threads.map((thread) => (
              <ThreadCard
                key={thread.key}
                thread={thread}
                opened={answerKey ? opened.get(`${answerKey}|${thread.key}`) : undefined}
                onOpenAll={() => openAll(thread)}
                onClose={() => closeAll(thread)}
                onOpen={onOpen}
                onFollow={(title, member) => follow(title, thread, member)}
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  )
}
