import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  CircularProgress,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import AltRouteIcon from '@mui/icons-material/AltRoute'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import { TitlePicker } from './TitlePicker'
import { TitleTile } from './TitleTile'
import { SaveTrailButton } from './SaveTrailButton'
import { EntityAvatar } from './LinkCard'
import { fetchTrails, isAbort, TrailsRequestError, useAnswers } from './api'
import { KIND_COLOR, rarityText, stepTrail } from './labels'
import { useTrailText } from './useTrailText'
import type { Thread, ThreadsResponse, TrailTitle } from './types'

interface ThreadsModeProps {
  trail: string[]
  cards: ReadonlyMap<string, TrailTitle>
  remember: (titles: readonly TrailTitle[]) => void
  onTrailChange: (trail: string[]) => void
  onOpen: (title: TrailTitle) => void
  /** Start a Connect-two-titles search from this title. */
  onRouteFrom: (title: TrailTitle) => void
}


/**
 * Follow a thread: every named thing one title shares with the rest of the
 * library, rarest first, each with the titles it leads to. Following one of
 * those makes it the new start, and the titles followed so far stay above as a
 * trail that can be walked back.
 */
export function ThreadsMode({
  trail,
  cards,
  remember,
  onTrailChange,
  onOpen,
  onRouteFrom,
}: ThreadsModeProps) {
  const { t } = useTranslation()
  const { hereText } = useTrailText()
  const { answers, hasAnswer, store, failure, fail, clearFailure } = useAnswers<ThreadsResponse>()
  // What each followed title was reached through, for the trail above. Only
  // known for steps taken on this page; a trail opened from a link shows titles.
  const [reachedVia, setReachedVia] = useState<ReadonlyMap<string, string>>(() => new Map())
  const current = trail.length > 0 ? trail[trail.length - 1] : null
  const failedHere = current != null && failure?.key === current

  useEffect(() => {
    if (!current || hasAnswer(current) || failedHere) return
    const controller = new AbortController()
    clearFailure()
    fetchTrails<ThreadsResponse>(`threads?title=${encodeURIComponent(current)}`, controller.signal)
      .then((response) => {
        // The threads' own titles are read from the response, never cached.
        remember([response.title])
        store(current, response)
      })
      .catch((caught) => {
        if (isAbort(caught)) return
        fail(
          current,
          caught instanceof TrailsRequestError && caught.status === 404
            ? t('trails.threads.notFound')
            : t('trails.errors.load')
        )
      })
    return () => controller.abort()
  }, [current, hasAnswer, failedHere, remember, store, fail, clearFailure, t])

  const follow = (title: TrailTitle, thread: Thread) => {
    remember([title])
    setReachedVia((previous) => new Map(previous).set(title.ref, thread.name))
    onTrailChange(stepTrail(trail, title.ref))
  }

  const response = current ? (answers.get(current) ?? null) : null
  const error = failure != null && failure.key === current ? failure.message : null
  const currentCard = current ? (cards.get(current) ?? response?.title ?? null) : null

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TitlePicker
          label={trail.length > 0 ? t('trails.threads.startAgain') : t('trails.threads.pick')}
          value={null}
          clearOnPick
          onChange={(picked) => {
            if (!picked) return
            remember([picked])
            onTrailChange([picked.ref])
          }}
        />
        {trail.length > 1 && (
          <Button startIcon={<RestartAltIcon />} onClick={() => onTrailChange([trail[0]])}>
            {t('trails.threads.backToStart')}
          </Button>
        )}
      </Box>

      {trail.length > 1 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Breadcrumbs
            aria-label={t('trails.threads.trail')}
            maxItems={8}
            itemsBeforeCollapse={1}
            itemsAfterCollapse={5}
          >
            {trail.map((ref, index) => {
              const card = cards.get(ref)
              const label = card?.title ?? '…'
              const via = reachedVia.get(ref)
              const isLast = index === trail.length - 1
              return (
                <Box key={ref} sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.75 }}>
                  {via && index > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      {t('trails.threads.via', { name: via })}
                    </Typography>
                  )}
                  {isLast ? (
                    <Typography variant="body2" fontWeight={600} color="text.primary">
                      {label}
                    </Typography>
                  ) : (
                    <Link
                      component="button"
                      variant="body2"
                      onClick={() => onTrailChange(trail.slice(0, index + 1))}
                    >
                      {label}
                    </Link>
                  )}
                </Box>
              )
            })}
          </Breadcrumbs>
          <SaveTrailButton
            titles={trail
              .map((ref) => cards.get(ref))
              .filter((card): card is TrailTitle => card != null)}
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
            <Typography color="text.secondary" variant="body2" sx={{ mb: 1.5 }}>
              {response.threads.length > 0
                ? t('trails.threads.count', { count: response.threads.length })
                : t('trails.threads.none', { title: currentCard.title })}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AltRouteIcon />}
              onClick={() => onRouteFrom(currentCard)}
            >
              {t('trails.threads.connectFrom')}
            </Button>
          </Box>
        </Box>
      )}

      {response && response.threads.length > 0 && (
        <Stack spacing={2}>
          {response.threads.map((thread) => {
            const rarity = rarityText(thread.titleCount)
            return (
              <Paper
                key={`${thread.kind}:${thread.name}`}
                variant="outlined"
                sx={{
                  p: 1.5,
                  borderInlineStart: 3,
                  borderInlineStartColor: KIND_COLOR[thread.kind],
                }}
              >
                <Box
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.25, minWidth: 0 }}
                >
                  <EntityAvatar entity={thread} size={36} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography fontWeight={600} noWrap>
                      {thread.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {hereText(thread.kind, thread.roles)}
                      {' · '}
                      {rarity.key === 'trails.rarity.onlyTwo'
                        ? t(rarity.key)
                        : t(rarity.key, { count: rarity.count })}
                    </Typography>
                  </Box>
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    gap: 1.5,
                    overflowX: 'auto',
                    pb: 1,
                    alignItems: 'flex-start',
                  }}
                >
                  {thread.others.map((member) => (
                    <TitleTile
                      key={member.title.ref}
                      title={member.title}
                      onOpen={onOpen}
                      onFollow={(title) => follow(title, thread)}
                      width={104}
                    />
                  ))}
                  {thread.more > 0 && (
                    <Box sx={{ alignSelf: 'center', px: 1, flexShrink: 0 }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('trails.threads.more', { count: thread.more })}
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Paper>
            )
          })}
        </Stack>
      )}
    </Stack>
  )
}
