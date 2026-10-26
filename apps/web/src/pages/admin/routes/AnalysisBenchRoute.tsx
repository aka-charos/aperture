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
  Replay as ReplayIcon,
  Stop as StopIcon,
} from '@mui/icons-material'
import { useLibraryTitleSearch, type LibrarySearchHit } from '@/hooks/useLibraryTitleSearch'

type SearchHit = LibrarySearchHit

interface ProviderGroup {
  provider: string
  name: string
  /** False only for a LOCAL provider with no address configured anywhere. */
  configured: boolean
  /** False only for a LOCAL provider whose configured server did not answer. */
  reachable: boolean
  models: { id: string; name: string }[]
}

interface RunEntry {
  provider: string
  model: string
  /** Absent from an older server, which ran one prompt version per run. */
  promptVersion?: number
  /** The variant that answered, if one did; null or absent means the version. */
  promptVariant?: string | null
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
  /** The run whose documents this one replayed; its answers are in `text`. */
  replayOf?: { runId: string; promptVersion: number } | null
  /** The whole comparison as one document — rendered by core, shown verbatim. */
  text: string
}

interface RunSummary {
  id: string
  title: string
  year: number | null
  status: string
  modelCount: number
  promptVersion: number
  promptVersions?: number[]
  replayOf: string | null
  startedAt: string
}

/**
 * An alternative prompt for one version, offered beside it. Decided by the
 * server - the label and the note come down with it, so nothing about a variant
 * is written twice.
 */
interface PromptVariantOption {
  id: string
  label: string
  base: number
  note: string
}

/** "v15", or "v15 compact" — the spelling core prints in the report. */
const promptLabel = (version: number, variant?: string | null) =>
  variant ? `v${version} ${variant}` : `v${version}`

/** "v8, v9" — how a list of versions is written in labels. */
const versionList = (versions: number[]) => versions.map((version) => `v${version}`).join(', ')

/** A model is addressed by provider AND id — two providers can serve one id. */
const keyOf = (provider: string, model: string) => `${provider}::${model}`

export default function AnalysisBenchRoute() {
  const { t } = useTranslation()

  const [queryText, setQueryText] = useState('')
  const { hits } = useLibraryTitleSearch(queryText, { limit: 8 })
  const [picked, setPicked] = useState<SearchHit | null>(null)

  const [providers, setProviders] = useState<ProviderGroup[]>([])
  const [maxModels, setMaxModels] = useState(8)
  // Decided by the server, never hardcoded: which versions exist and which one
  // is current are facts about core, and a copy here would drift on the next
  // prompt change.
  const [promptVersion, setPromptVersion] = useState<number | null>(null)
  const [availableVersions, setAvailableVersions] = useState<number[]>([])
  // Kept sorted, so the request and the labels read oldest first.
  const [selectedVersions, setSelectedVersions] = useState<number[]>([])
  // The next version, benchable only — labelled so it is never read as live.
  const [draftVersion, setDraftVersion] = useState<number | null>(null)
  // Alternative prompts for a version, benchable only and never promoted.
  const [availableVariants, setAvailableVariants] = useState<PromptVariantOption[]>([])
  const [selectedVariants, setSelectedVariants] = useState<string[]>([])
  // An ORDERED list, not a Set: the report prints entries in the order they
  // were chosen, and a Set would silently reorder the document between runs.
  const [selected, setSelected] = useState<{ provider: string; model: string }[]>([])

  const [run, setRun] = useState<RunView | null>(null)
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // The by-hand lane: names the operator types for models this instance
  // cannot call, then the answers pasted back. See startManualComparison.
  const [manualLabels, setManualLabels] = useState<string[]>([])
  const [manualDraft, setManualDraft] = useState('')
  const [pasted, setPasted] = useState('')
  const [importing, setImporting] = useState(false)
  const [importNote, setImportNote] = useState<string | null>(null)

  const loadRuns = useCallback(async () => {
    const res = await fetch('/api/analysis-compare/runs', { credentials: 'include' })
    if (res.ok) setRuns(((await res.json()) as { runs: RunSummary[] }).runs)
  }, [])

  useEffect(() => {
    fetch('/api/analysis-compare/models', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          json: {
            providers: ProviderGroup[]
            maxModels: number
            promptVersion?: number
            promptVersions?: number[]
            draftPromptVersion?: number | null
            promptVariants?: PromptVariantOption[]
          } | null
        ) => {
          if (!json) return
          setProviders(json.providers)
          setMaxModels(json.maxModels)
          setPromptVersion(json.promptVersion ?? null)
          const current = json.promptVersion
          setAvailableVersions(json.promptVersions ?? (current != null ? [current] : []))
          setDraftVersion(json.draftPromptVersion ?? null)
          setAvailableVariants(json.promptVariants ?? [])
          // The current prompt alone by default: a run nobody asked to widen
          // costs what it always cost.
          setSelectedVersions(current != null ? [current] : [])
          setSelectedVariants([])
        }
      )
      .catch(() => setError(t('adminAnalysisBench.modelsFailed')))
    void loadRuns()
  }, [loadRuns, t])

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

  // The last ticked prompt cannot be unticked: a run with no prompt is not a
  // run, and a checkbox that silently does nothing is worse than a disabled one.
  // Versions and variants are one pool for that rule - either alone is a run.
  const promptCount = selectedVersions.length + selectedVariants.length
  const toggleVersion = (version: number) => {
    setSelectedVersions((prev) => {
      if (prev.includes(version)) {
        return promptCount > 1 ? prev.filter((v) => v !== version) : prev
      }
      return [...prev, version].sort((a, b) => a - b)
    })
  }
  const toggleVariant = (id: string) => {
    setSelectedVariants((prev) => {
      if (prev.includes(id)) return promptCount > 1 ? prev.filter((v) => v !== id) : prev
      return [...prev, id]
    })
  }

  // How the next run's prompts read, versions first: "v15, v15 compact".
  const selectedPrompts = [
    ...selectedVersions.map((version) => promptLabel(version)),
    ...selectedVariants.map((id) => {
      const variant = availableVariants.find((entry) => entry.id === id)
      return promptLabel(variant?.base ?? 0, id)
    }),
  ]

  // Every ticked model answers every ticked prompt.
  const answerCount = selected.length * Math.max(promptCount, 1)

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
          promptVersions: selectedVersions,
          promptVariants: selectedVariants,
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
    // The note belongs to the run it was imported into, and this is every way
    // of arriving at a different one - a replay, a previous run from the list,
    // a fresh bench.
    setImportNote(null)
    if (res.ok) setRun((await res.json()) as RunView)
  }

  /**
   * A bench for models this instance cannot call - one behind a web interface
   * with no API. It retrieves and builds the prompts exactly as a model run
   * does, then waits: the prompts come out as a file and the answers go back
   * in by paste, scored by the same reader.
   */
  const startManual = async () => {
    if (!picked || manualLabels.length === 0) return
    setStarting(true)
    setError(null)
    setImportNote(null)
    try {
      const res = await fetch('/api/analysis-compare/manual', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaType: picked.type,
          mediaId: picked.id,
          labels: manualLabels,
          promptVersions: selectedVersions,
          promptVariants: selectedVariants,
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

  const addManualLabel = () => {
    const label = manualDraft.trim()
    if (!label) return
    setManualLabels((prev) => (prev.includes(label) ? prev : [...prev, label].slice(0, maxModels)))
    setManualDraft('')
  }

  /**
   * Fetched rather than linked, so a refusal can be shown. A 409 means every
   * answer is already in, which is a sentence worth reading and not a dead
   * download.
   */
  const downloadPrompts = async () => {
    if (!run) return
    setImportNote(null)
    const res = await fetch(`/api/analysis-compare/${run.id}/download`, { credentials: 'include' })
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      setError(json?.error ?? t('adminAnalysisBench.manualDownloadFailed'))
      return
    }
    const blob = new Blob([await res.text()], { type: 'application/x-ndjson' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `bench-${run.id}.jsonl`
    link.click()
    URL.revokeObjectURL(url)
  }

  const importAnswers = async () => {
    if (!run || !pasted.trim()) return
    setImporting(true)
    setError(null)
    setImportNote(null)
    try {
      const res = await fetch(`/api/analysis-compare/${run.id}/import`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonl: pasted }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error ?? t('adminAnalysisBench.manualImportFailed'))
        return
      }
      setPasted('')
      // Unusable answers are a finding, not an import failure: a model that
      // cannot hold the output contract is usually what a bench discovers.
      setImportNote(
        t('adminAnalysisBench.manualImported', {
          stored: json.stored as number,
          unusable: json.unusable as number,
          remaining: json.remaining as number,
        }) +
          ((json.unmatched as string[])?.length
            ? ' ' +
              t('adminAnalysisBench.manualUnmatched', {
                count: (json.unmatched as string[]).length,
              })
            : '')
      )
      await openRun(run.id)
    } catch {
      setError(t('adminAnalysisBench.manualImportFailed'))
    } finally {
      setImporting(false)
    }
  }

  // Same models, same documents, current prompt. Nothing is retrieved, which
  // is the whole point: see replayComparison in core.
  const replay = async () => {
    if (!run) return
    setStarting(true)
    setError(null)
    try {
      const res = await fetch(`/api/analysis-compare/${run.id}/replay`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptVersions: selectedVersions,
          promptVariants: selectedVariants,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error ?? t('adminAnalysisBench.replayFailed'))
        return
      }
      await openRun(json.runId as string)
    } catch {
      setError(t('adminAnalysisBench.replayFailed'))
    } finally {
      setStarting(false)
    }
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

  // The prompts the open run actually answered, read off its entries rather
  // than off the checkboxes, which describe the NEXT run. Labels rather than
  // numbers, because a variant answers under its base version's number and two
  // different prompts would otherwise read as one.
  const runPrompts = useMemo(() => {
    const labels = new Map<string, string>()
    for (const entry of run?.entries ?? []) {
      if (entry.promptVersion == null) continue
      const key = `${entry.promptVersion}:${entry.promptVariant ?? ''}`
      if (!labels.has(key)) labels.set(key, promptLabel(entry.promptVersion, entry.promptVariant))
    }
    return [...labels.values()]
  }, [run])

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
            {/* Three states, three fixes: no address set, an address that
                does not answer, and a server that answered with nothing.
                Collapsing the first two sends the operator to check an address
                they never set. */}
            {!group.configured ? (
              <Typography variant="caption" color="text.secondary">
                {t('adminAnalysisBench.notConfigured')}
              </Typography>
            ) : !group.reachable ? (
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

        {/* The prompt axis. Only shown when the build carries more than one
            version, since a single checkbox that cannot be unticked is noise. */}
        {(availableVersions.length > 1 || availableVariants.length > 0) && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" fontWeight={600}>
              {t('adminAnalysisBench.stepPrompts')}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              {t('adminAnalysisBench.promptsHint')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {availableVersions.map((version) => {
                const on = selectedVersions.includes(version)
                return (
                  <FormControlLabel
                    key={version}
                    sx={{ mr: 2 }}
                    control={
                      <Checkbox
                        size="small"
                        checked={on}
                        disabled={on && promptCount === 1}
                        onChange={() => toggleVersion(version)}
                      />
                    }
                    label={
                      <Typography variant="body2">
                        {version === promptVersion
                          ? t('adminAnalysisBench.versionCurrent', { version })
                          : version === draftVersion
                            ? t('adminAnalysisBench.versionDraft', { version })
                            : t('adminAnalysisBench.versionLabel', { version })}
                      </Typography>
                    }
                  />
                )
              })}
            </Box>
            {availableVariants.length > 0 && (
              <>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  sx={{ mt: 0.5 }}
                >
                  {t('adminAnalysisBench.variantsHint')}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {availableVariants.map((variant) => {
                    const on = selectedVariants.includes(variant.id)
                    return (
                      <Tooltip key={variant.id} title={variant.note}>
                        <FormControlLabel
                          sx={{ mr: 2 }}
                          control={
                            <Checkbox
                              size="small"
                              checked={on}
                              disabled={on && promptCount === 1}
                              onChange={() => toggleVariant(variant.id)}
                            />
                          }
                          label={
                            <Typography variant="body2">
                              {t('adminAnalysisBench.versionVariant', {
                                version: variant.base,
                                label: variant.label,
                              })}
                            </Typography>
                          }
                        />
                      </Tooltip>
                    )
                  })}
                </Box>
              </>
            )}
          </Box>
        )}

        <Divider sx={{ my: 1.5 }} />
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
          <Button
            variant="contained"
            startIcon={starting ? <CircularProgress size={16} /> : <RunIcon />}
            disabled={
              !picked || selected.length === 0 || selectedVersions.length === 0 || starting || live
            }
            onClick={start}
          >
            {selectedVersions.length > 1
              ? t('adminAnalysisBench.runAnswers', { count: answerCount })
              : t('adminAnalysisBench.run', { count: selected.length })}
          </Button>
          {live && (
            <Button variant="outlined" color="warning" startIcon={<StopIcon />} onClick={stop}>
              {t('adminAnalysisBench.stop')}
            </Button>
          )}
        </Stack>

        {/* The by-hand lane, for a model this instance cannot call. */}
        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" fontWeight={600}>
          {t('adminAnalysisBench.manualTitle')}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          {t('adminAnalysisBench.manualHelp')}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            value={manualDraft}
            onChange={(e) => setManualDraft(e.target.value)}
            onKeyDown={(e) => {
              // The same cap the Add button carries, or Enter at the limit
              // clears the box and silently drops what was typed.
              if (e.key === 'Enter' && manualLabels.length < maxModels) {
                e.preventDefault()
                addManualLabel()
              }
            }}
            placeholder={t('adminAnalysisBench.manualPlaceholder')}
            sx={{ minWidth: 240 }}
          />
          <Button
            variant="outlined"
            onClick={addManualLabel}
            disabled={!manualDraft.trim() || manualLabels.length >= maxModels}
          >
            {t('adminAnalysisBench.manualAdd')}
          </Button>
          <Button
            variant="contained"
            startIcon={starting ? <CircularProgress size={16} /> : <RunIcon />}
            disabled={
              !picked ||
              manualLabels.length === 0 ||
              selectedVersions.length === 0 ||
              starting ||
              live
            }
            onClick={startManual}
          >
            {t('adminAnalysisBench.manualStart', {
              count: manualLabels.length * Math.max(promptCount, 1),
            })}
          </Button>
        </Stack>
        {manualLabels.length > 0 && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
            {manualLabels.map((label) => (
              <Chip
                key={label}
                label={label}
                size="small"
                onDelete={() => setManualLabels((prev) => prev.filter((l) => l !== label))}
              />
            ))}
          </Stack>
        )}
      </Paper>

      {/* 3 — the run */}
      {run && (
        <Paper sx={{ p: 2.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
              {run.title}
              {run.year ? ` (${run.year})` : ''}
            </Typography>
            {selectedVersions.length > 0 && (
              <Tooltip title={t('adminAnalysisBench.replayHint')}>
                {/* A span so the tooltip still explains a disabled button. */}
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ReplayIcon />}
                    disabled={live || starting || run.sources.length === 0}
                    onClick={replay}
                  >
                    {selectedPrompts.length > 1 || selectedVariants.length > 0
                      ? t('adminAnalysisBench.replayVersions', {
                          versions: selectedPrompts.join(', '),
                        })
                      : t('adminAnalysisBench.replay', { version: selectedVersions[0] })}
                  </Button>
                </span>
              </Tooltip>
            )}
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

          {/* Outside the panel below, which unmounts the moment the last
              answer lands and would take its own confirmation with it. */}
          {importNote && (
            <Alert severity="info" sx={{ mb: 2 }} onClose={() => setImportNote(null)}>
              {importNote}
            </Alert>
          )}

          {/* A run waiting on answers typed in by hand. The prompts are built
              and stored; nothing else happens until they come back. */}
          {run.status === 'awaiting' && (
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
                {t('adminAnalysisBench.manualAwaitingTitle')}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                {t('adminAnalysisBench.manualAwaitingHelp')}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={downloadPrompts}
                sx={{ mb: 1.5 }}
              >
                {t('adminAnalysisBench.manualDownload')}
              </Button>
              <TextField
                fullWidth
                multiline
                minRows={4}
                size="small"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={t('adminAnalysisBench.manualPastePlaceholder')}
                sx={{ mb: 1.5, '& textarea': { fontFamily: 'monospace', fontSize: 12 } }}
              />
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Button
                  variant="contained"
                  size="small"
                  disabled={!pasted.trim() || importing}
                  startIcon={importing ? <CircularProgress size={16} /> : undefined}
                  onClick={importAnswers}
                >
                  {t('adminAnalysisBench.manualImport')}
                </Button>
              </Stack>
            </Paper>
          )}

          {/* The control, said out loud: this is what makes the answers below
              comparable at all. */}
          <Typography variant="caption" color="text.secondary" display="block">
            {runPrompts.length > 1
              ? t('adminAnalysisBench.controlVersions', {
                  count: run.sources.length,
                  chars: run.retrievedChars.toLocaleString(),
                  versions: runPrompts.join(', '),
                })
              : t('adminAnalysisBench.control', {
                  count: run.sources.length,
                  chars: run.retrievedChars.toLocaleString(),
                  version: run.promptVersion,
                })}
          </Typography>
          {run.replayOf && (
            <Typography variant="caption" color="text.secondary" display="block">
              {t('adminAnalysisBench.replayControl', { version: run.replayOf.promptVersion })}
            </Typography>
          )}

          <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ my: 1.5 }}>
            {run.entries.map((entry) => (
              <Chip
                key={`${keyOf(entry.provider, entry.model)}::${entry.promptVersion ?? ''}::${entry.promptVariant ?? ''}`}
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
                label={
                  runPrompts.length > 1 && entry.promptVersion != null
                    ? `${entry.model} · ${promptLabel(entry.promptVersion, entry.promptVariant)}`
                    : entry.model
                }
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
                  secondary={[
                    t('adminAnalysisBench.runSummary', {
                      count: summary.modelCount,
                      status: summary.status,
                      when: new Date(summary.startedAt).toLocaleString(),
                    }),
                    summary.promptVersions && summary.promptVersions.length > 1
                      ? t('adminAnalysisBench.promptVersionsShort', {
                          versions: versionList(summary.promptVersions),
                        })
                      : t('adminAnalysisBench.promptVersionShort', { version: summary.promptVersion }),
                    summary.replayOf ? t('adminAnalysisBench.replayTag') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
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
