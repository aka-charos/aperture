/**
 * The title-analysis model bench: pick a film, tick some models, read them.
 *
 * WHY IT IS A PAGE AND NOT A SETTING. Choosing a model for the Title Analysis
 * role means reading several models' prose about one film and judging it, and
 * doing that by repointing the role and forcing a re-analysis per model is both
 * slow and unsound — every one of those runs performs its own retrieval, so the
 * source documents differ and a difference in the output cannot be attributed
 * to the model. The server retrieves ONCE and hands every model the identical
 * prompt; this page is the reading surface for that.
 *
 * THE DELIVERABLE IS THE TEXT BLOCK. The per-model chips and the timing line
 * are navigation; the decision is made by reading continuous prose, so the
 * report the server renders is shown verbatim and can be copied or downloaded
 * whole. It is deliberately NOT re-laid-out into cards per model — the thing
 * being compared is writing, and writing is compared by reading it.
 *
 * THREE THINGS THIS PAGE MUST KEEP SAYING:
 *  - which sources every model was given (the control),
 *  - which models are still queued (an empty list reads as a broken run),
 *  - which models FAILED and why (a model that cannot hold the output contract
 *    is usually the finding, not an obstacle to it).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  PlayArrow as RunIcon,
  Stop as StopIcon,
} from '@mui/icons-material'

interface SearchHit {
  id: string
  title: string
  year?: number | null
  type: 'movie' | 'series'
}

interface ProviderGroup {
  provider: string
  name: string
  /** False only for a LOCAL provider whose server did not answer. */
  reachable: boolean
  models: { id: string; name: string }[]
}

interface RunEntry {
  provider: string
  model: string
  status: string
  analysis: string | null
  grade: string | null
  problem: string | null
  error: string | null
  durationMs: number | null
}

interface RunView {
  id: string
  status: string
  error: string | null
  title: string
  year: number | null
  promptVersion: number
  sources: { title: string; domain: string; chars: number }[]
  retrievedChars: number
  entries: RunEntry[]
  /** The whole comparison as one document — rendered by core, shown verbatim. */
  text: string
}

interface RunSummary {
  id: string
  title: string
  year: number | null
  status: string
  modelCount: number
  startedAt: string
}

/** A model is addressed by provider AND id — two providers can serve one id. */
const keyOf = (provider: string, model: string) => `${provider}::${model}`

export default function AnalysisBenchRoute() {
  const { t } = useTranslation()

  const [queryText, setQueryText] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [picked, setPicked] = useState<SearchHit | null>(null)

  const [providers, setProviders] = useState<ProviderGroup[]>([])
  const [maxModels, setMaxModels] = useState(8)
  // An ORDERED list, not a Set: the report prints entries in the order they
  // were chosen, and a Set would silently reorder the document between runs.
  const [selected, setSelected] = useState<{ provider: string; model: string }[]>([])

  const [run, setRun] = useState<RunView | null>(null)
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const loadRuns = useCallback(async () => {
    const res = await fetch('/api/analysis-compare/runs', { credentials: 'include' })
    if (res.ok) setRuns(((await res.json()) as { runs: RunSummary[] }).runs)
  }, [])

  useEffect(() => {
    fetch('/api/analysis-compare/models', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { providers: ProviderGroup[]; maxModels: number } | null) => {
        if (!json) return
        setProviders(json.providers)
        setMaxModels(json.maxModels)
      })
      .catch(() => setError(t('adminAnalysisBench.modelsFailed')))
    void loadRuns()
  }, [loadRuns, t])

  // Debounced, and the in-flight response is dropped when the query moves on —
  // otherwise a slow early request lands after a fast later one and the list
  // shows results for something the operator has stopped typing.
  useEffect(() => {
    const term = queryText.trim()
    if (term.length < 2) {
      setHits([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}&type=all&limit=8`, {
        credentials: 'include',
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((json: { results?: SearchHit[] } | null) => {
          if (!cancelled) setHits(json?.results ?? [])
        })
        .catch(() => {
          /* a failed lookup shows no results rather than a banner */
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [queryText])

  // Poll while the run is live. The interval is cleared on every status change,
  // so a finished run stops polling without needing its own effect.
  const runId = run?.id
  const live = run?.status === 'running'
  const pollRef = useRef<number | null>(null)
  useEffect(() => {
    if (!runId || !live) return
    const tick = async () => {
      const res = await fetch(`/api/analysis-compare/${runId}`, { credentials: 'include' })
      if (res.ok) setRun((await res.json()) as RunView)
    }
    pollRef.current = window.setInterval(tick, 4000)
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [runId, live])

  useEffect(() => {
    if (run && run.status !== 'running') void loadRuns()
  }, [run, loadRuns])

  const toggleModel = (provider: string, model: string) => {
    setSelected((prev) => {
      const exists = prev.some((e) => e.provider === provider && e.model === model)
      if (exists) return prev.filter((e) => !(e.provider === provider && e.model === model))
      if (prev.length >= maxModels) return prev
      return [...prev, { provider, model }]
    })
  }

  const start = async () => {
    if (!picked || selected.length === 0) return
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/analysis-compare', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaType: picked.type,
          mediaId: picked.id,
          models: selected,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error ?? t('adminAnalysisBench.startFailed'))
        return
      }
      await openRun(json.runId as string)
    } catch {
      setError(t('adminAnalysisBench.startFailed'))
    } finally {
      setStarting(false)
    }
  }

  const openRun = async (id: string) => {
    const res = await fetch(`/api/analysis-compare/${id}`, { credentials: 'include' })
    if (res.ok) setRun((await res.json()) as RunView)
  }

  const stop = async () => {
    if (!run) return
    await fetch(`/api/analysis-compare/${run.id}/cancel`, {
      method: 'POST',
      credentials: 'include',
    })
  }

  const remove = async (id: string) => {
    await fetch(`/api/analysis-compare/${id}`, { method: 'DELETE', credentials: 'include' })
    if (run?.id === id) setRun(null)
    await loadRuns()
  }

  const copy = async () => {
    if (!run) return
    await navigator.clipboard.writeText(run.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const download = () => {
    if (!run) return
    const blob = new Blob([run.text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `analysis-comparison-${run.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  const done = useMemo(
    () => run?.entries.filter((entry) => entry.status !== 'pending').length ?? 0,
    [run]
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Alert severity="info">{t('adminAnalysisBench.premise')}</Alert>
      {error && <Alert severity="error">{error}</Alert>}

      {/* 1 — the title */}
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          {t('adminAnalysisBench.stepTitle')}
        </Typography>
        <TextField
          fullWidth
          size="small"
          value={queryText}
          onChange={(event) => setQueryText(event.target.value)}
          placeholder={t('adminAnalysisBench.searchPlaceholder')}
        />
        {picked && (
          <Chip
            sx={{ mt: 1.5 }}
            color="primary"
            label={`${picked.title}${picked.year ? ` (${picked.year})` : ''}`}
            onDelete={() => setPicked(null)}
          />
        )}
        {hits.length > 0 && (
          <List dense sx={{ mt: 1, maxHeight: 260, overflowY: 'auto' }}>
            {hits.map((hit) => (
              <ListItemButton
                key={`${hit.type}-${hit.id}`}
                selected={picked?.id === hit.id}
                onClick={() => {
                  setPicked(hit)
                  setHits([])
                  setQueryText('')
                }}
              >
                <ListItemText
                  primary={`${hit.title}${hit.year ? ` (${hit.year})` : ''}`}
                  secondary={hit.type}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Paper>

      {/* 2 — the models */}
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t('adminAnalysisBench.stepModels')}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          {t('adminAnalysisBench.modelsHint', { count: maxModels })}
        </Typography>

        {providers.map((group) => (
          <Box key={group.provider} sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight={600}>
              {group.name}
            </Typography>
            {/* "Nothing installed" and "wrong address" have opposite fixes, so
                an unreachable local server says so instead of rendering as an
                empty provider. */}
            {!group.reachable ? (
              <Typography variant="caption" color="warning.main">
                {t('adminAnalysisBench.unreachable')}
              </Typography>
            ) : group.models.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                {t('adminAnalysisBench.noModels')}
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {group.models.map((model) => {
                  const on = selected.some(
                    (entry) => entry.provider === group.provider && entry.model === model.id
                  )
                  return (
                    <FormControlLabel
                      key={keyOf(group.provider, model.id)}
                      sx={{ mr: 2 }}
                      control={
                        <Checkbox
                          size="small"
                          checked={on}
                          disabled={!on && selected.length >= maxModels}
                          onChange={() => toggleModel(group.provider, model.id)}
                        />
                      }
                      label={<Typography variant="body2">{model.name}</Typography>}
                    />
                  )
                })}
              </Box>
            )}
          </Box>
        ))}

        <Divider sx={{ my: 1.5 }} />
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
          <Button
            variant="contained"
            startIcon={starting ? <CircularProgress size={16} /> : <RunIcon />}
            disabled={!picked || selected.length === 0 || starting || live}
            onClick={start}
          >
            {t('adminAnalysisBench.run', { count: selected.length })}
          </Button>
          {live && (
            <Button variant="outlined" color="warning" startIcon={<StopIcon />} onClick={stop}>
              {t('adminAnalysisBench.stop')}
            </Button>
          )}
        </Stack>
      </Paper>

      {/* 3 — the run */}
      {run && (
        <Paper sx={{ p: 2.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
              {run.title}
              {run.year ? ` (${run.year})` : ''}
            </Typography>
            <Tooltip title={copied ? t('adminAnalysisBench.copied') : t('adminAnalysisBench.copy')}>
              <IconButton size="small" onClick={copy}>
                <CopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('adminAnalysisBench.download')}>
              <IconButton size="small" onClick={download}>
                <DownloadIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>

          {run.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {run.error}
            </Alert>
          )}

          {/* The control, said out loud: this is what makes the answers below
              comparable at all. */}
          <Typography variant="caption" color="text.secondary" display="block">
            {t('adminAnalysisBench.control', {
              count: run.sources.length,
              chars: run.retrievedChars.toLocaleString(),
              version: run.promptVersion,
            })}
          </Typography>

          <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ my: 1.5 }}>
            {run.entries.map((entry) => (
              <Chip
                key={keyOf(entry.provider, entry.model)}
                size="small"
                variant={entry.status === 'pending' ? 'outlined' : 'filled'}
                color={
                  entry.status === 'ok'
                    ? 'success'
                    : entry.status === 'error'
                      ? 'error'
                      : entry.status === 'unusable'
                        ? 'warning'
                        : 'default'
                }
                label={entry.model}
              />
            ))}
          </Stack>

          {live && (
            <Box sx={{ mb: 2 }}>
              <LinearProgress
                variant={done === 0 ? 'indeterminate' : 'determinate'}
                value={(done / Math.max(run.entries.length, 1)) * 100}
              />
              <Typography variant="caption" color="text.secondary">
                {t('adminAnalysisBench.progress', { done, total: run.entries.length })}
              </Typography>
            </Box>
          )}

          <Box
            component="pre"
            sx={{
              m: 0,
              p: 2,
              maxHeight: '70vh',
              overflow: 'auto',
              bgcolor: 'action.hover',
              borderRadius: 1,
              fontSize: '0.8rem',
              lineHeight: 1.6,
              // The report is written as plain text with its own rules and
              // hanging indents; wrapping preserves them while still fitting a
              // narrow pane.
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {run.text}
          </Box>
        </Paper>
      )}

      {/* Past runs. Kept because a bench is a record of a decision — see 0169. */}
      {runs.length > 0 && (
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            {t('adminAnalysisBench.previous')}
          </Typography>
          <List dense>
            {runs.map((summary) => (
              <ListItemButton key={summary.id} onClick={() => openRun(summary.id)}>
                <ListItemText
                  primary={`${summary.title}${summary.year ? ` (${summary.year})` : ''}`}
                  secondary={t('adminAnalysisBench.runSummary', {
                    count: summary.modelCount,
                    status: summary.status,
                    when: new Date(summary.startedAt).toLocaleString(),
                  })}
                />
                <IconButton
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation()
                    void remove(summary.id)
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </ListItemButton>
            ))}
          </List>
        </Paper>
      )}
    </Box>
  )
}
