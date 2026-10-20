import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Box, Tab, Tabs } from '@mui/material'
import RouteIcon from '@mui/icons-material/Route'
import { PageHeading } from '@/components/PageHeading'
import { MediaDetailModalProvider } from '@/hooks/MediaDetailModalProvider'
import { useOpenMedia } from '@/hooks/useOpenMedia'
import { RouteMode } from './RouteMode'
import { ThreadsMode } from './ThreadsMode'
import { CommonMode } from './CommonMode'
import { useTitleCache, useTrailLimits } from './api'
import { TRAILS_MODES, readTrailsUrl, writeTrailsUrl, type TrailsMode, type TrailsUrlState } from './labels'
import type { TrailTitle } from './types'

/**
 * Trails: how the titles in a library are linked through the named things
 * they share — the people who made them, a franchise, a company, an uncommon
 * keyword — weighted by how rare each is here. A separate page from the
 * Explore graph, which draws embedding neighbours; nothing here is a
 * similarity score.
 */
export function TrailsPage() {
  return (
    <MediaDetailModalProvider>
      <TrailsContent />
    </MediaDetailModalProvider>
  )
}

const MODE_LABEL: Record<TrailsMode, string> = {
  route: 'trails.modes.route',
  threads: 'trails.modes.threads',
  common: 'trails.modes.common',
}

function TrailsContent() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const limits = useTrailLimits()
  const openMedia = useOpenMedia()

  // Before the limit arrives nothing is cut; the API enforces its own anyway.
  const state = useMemo(
    () => readTrailsUrl(params, limits?.maxCommonTitles ?? Number.MAX_SAFE_INTEGER),
    [params, limits?.maxCommonTitles]
  )
  const update = useCallback(
    (patch: Partial<TrailsUrlState>) => setParams(writeTrailsUrl({ ...state, ...patch })),
    [state, setParams]
  )

  const refs = useMemo(
    () => [...new Set([state.from, state.to, ...state.trail, ...state.titles].filter((ref): ref is string => !!ref))],
    [state]
  )
  const { cards, remember } = useTitleCache(refs)

  const onOpen = useCallback((title: TrailTitle) => openMedia(title.type, title.id), [openMedia])
  const followFrom = useCallback(
    (title: TrailTitle) => {
      remember([title])
      update({ mode: 'threads', trail: [title.ref] })
    },
    [remember, update]
  )

  return (
    <Box>
      <PageHeading title={t('trails.title')} description={t('trails.description')} icon={<RouteIcon />} />
      <Tabs
        value={state.mode}
        onChange={(_, mode: TrailsMode) => update({ mode })}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        {TRAILS_MODES.map((mode) => (
          <Tab key={mode} value={mode} label={t(MODE_LABEL[mode])} />
        ))}
      </Tabs>

      {state.mode === 'route' && (
        <RouteMode
          from={state.from}
          to={state.to}
          cards={cards}
          remember={remember}
          onChange={(from, to) => update({ from, to })}
          maxSteps={limits?.maxSteps ?? null}
          onOpen={onOpen}
          onFollow={followFrom}
        />
      )}
      {state.mode === 'threads' && (
        <ThreadsMode
          trail={state.trail}
          cards={cards}
          remember={remember}
          onTrailChange={(trail) => update({ trail })}
          onOpen={onOpen}
          onRouteFrom={(title) => update({ mode: 'route', from: title.ref, to: state.to === title.ref ? null : state.to })}
        />
      )}
      {state.mode === 'common' && (
        <CommonMode
          titles={state.titles}
          cards={cards}
          remember={remember}
          onChange={(titles) => update({ titles })}
          maxTitles={limits?.maxCommonTitles ?? null}
          onOpen={onOpen}
          onFollow={followFrom}
          onConnect={(from, to) => update({ mode: 'route', from, to })}
        />
      )}
    </Box>
  )
}
