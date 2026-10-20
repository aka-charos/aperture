import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import ShuffleIcon from '@mui/icons-material/Shuffle'
import { TitlePicker } from './TitlePicker'
import { RouteView } from './RouteView'
import { SaveTrailButton } from './SaveTrailButton'
import { fetchTrails, isAbort, TrailsRequestError, useAnswers } from './api'
import type { TrailResult, TrailTitle } from './types'

interface RouteModeProps {
  from: string | null
  to: string | null
  cards: ReadonlyMap<string, TrailTitle>
  remember: (titles: readonly TrailTitle[]) => void
  onChange: (from: string | null, to: string | null) => void
  maxSteps: number | null
  onOpen: (title: TrailTitle) => void
  onFollow: (title: TrailTitle) => void
}


function pairKey(from: string | null, to: string | null): string | null {
  return from && to ? `${from}|${to}` : null
}

/**
 * Connect two titles: up to three trails between them, each through titles the
 * others did not use, read as the named links each step shares.
 */
export function RouteMode({
  from,
  to,
  cards,
  remember,
  onChange,
  maxSteps,
  onOpen,
  onFollow,
}: RouteModeProps) {
  const { t } = useTranslation()
  const { answers, store, failure, fail, clearFailure } = useAnswers<TrailResult>()
  const [surprising, setSurprising] = useState(false)
  const [surpriseError, setSurpriseError] = useState<string | null>(null)
  const key = pairKey(from, to)
  const failedHere = key != null && failure?.key === key

  useEffect(() => {
    if (!key || answers.has(key) || failedHere) return
    const [fromRef, toRef] = key.split('|')
    const controller = new AbortController()
    clearFailure()
    fetchTrails<TrailResult>(
      `path?from=${encodeURIComponent(fromRef)}&to=${encodeURIComponent(toRef)}`,
      controller.signal
    )
      .then((result) => {
        if (result.status === 'found' || result.status === 'none') remember([result.from, result.to])
        store(key, result)
      })
      .catch((caught) => {
        if (isAbort(caught)) return
        if (caught instanceof TrailsRequestError && caught.status === 404) store(key, { status: 'notFound' })
        else fail(key, t('trails.errors.load'))
      })
    return () => controller.abort()
  }, [key, answers, failedHere, remember, store, fail, clearFailure, t])

  const surprise = async () => {
    setSurprising(true)
    setSurpriseError(null)
    try {
      const result = await fetchTrails<TrailResult>('surprise')
      if (result.status === 'found') {
        remember([result.from, result.to])
        // Stored before the URL moves, so the effect finds it and asks nothing.
        store(`${result.from.ref}|${result.to.ref}`, result)
        onChange(result.from.ref, result.to.ref)
      } else {
        setSurpriseError(t('trails.route.surpriseFailed'))
      }
    } catch {
      setSurpriseError(t('trails.errors.load'))
    } finally {
      setSurprising(false)
    }
  }

  const fromCard = from ? (cards.get(from) ?? null) : null
  const toCard = to ? (cards.get(to) ?? null) : null
  const result = key ? (answers.get(key) ?? null) : null
  const error = (failure != null && failure.key === key ? failure.message : null) ?? surpriseError
  const loading = key != null && !result && !failedHere

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TitlePicker
          label={t('trails.route.from')}
          value={fromCard}
          exclude={to ? [to] : []}
          onChange={(picked) => {
            if (picked) remember([picked])
            onChange(picked?.ref ?? null, to)
          }}
        />
        <Tooltip title={t('trails.route.swap')}>
          <span>
            <IconButton
              aria-label={t('trails.route.swap')}
              disabled={!from && !to}
              onClick={() => onChange(to, from)}
            >
              <SwapHorizIcon />
            </IconButton>
          </span>
        </Tooltip>
        <TitlePicker
          label={t('trails.route.to')}
          value={toCard}
          exclude={from ? [from] : []}
          onChange={(picked) => {
            if (picked) remember([picked])
            onChange(from, picked?.ref ?? null)
          }}
        />
        <Button
          variant="outlined"
          startIcon={surprising ? <CircularProgress size={16} /> : <ShuffleIcon />}
          onClick={surprise}
          disabled={surprising}
        >
          {t('trails.route.surprise')}
        </Button>
      </Box>

      {error && <Alert severity="warning">{error}</Alert>}

      {!key && (
        <Typography color="text.secondary" sx={{ maxWidth: 640 }}>
          {t('trails.route.empty')}
        </Typography>
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {result?.status === 'same' && <Alert severity="info">{t('trails.route.same')}</Alert>}

      {result?.status === 'notFound' && (
        <Alert severity="info">{t('trails.route.notFound')}</Alert>
      )}

      {result?.status === 'none' && (
        <Alert severity="info">
          {result.isolated.length > 0
            ? result.isolated
                .map((ref) => (ref === result.from.ref ? result.from : result.to))
                .map((title) => t('trails.route.isolated', { title: title.title }))
                .join(' ')
            : maxSteps != null
              ? t('trails.route.none', { count: maxSteps })
              : t('trails.route.noneUnbounded')}
        </Alert>
      )}

      {result?.status === 'found' && (
        <Stack spacing={4}>
          {result.paths.map((route, index) => (
            <Box key={route.steps.map((step) => step.to.ref).join('>')}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                <Typography variant="overline" color="text.secondary" component="h2">
                  {index === 0 ? t('trails.route.best') : t('trails.route.other')}
                  {' · '}
                  {t('trails.route.steps', { count: route.steps.length })}
                </Typography>
                <SaveTrailButton
                  titles={[route.steps[0].from, ...route.steps.map((step) => step.to)]}
                />
              </Box>
              <RouteView route={route} onOpen={onOpen} onFollow={onFollow} />
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  )
}
