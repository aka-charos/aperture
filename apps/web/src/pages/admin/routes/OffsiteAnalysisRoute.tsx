/**
 * Offsite title analysis: prepare a batch of prompts here, run them on another
 * machine, import the answers.
 *
 * Three cards in the order the work happens — prepare, run elsewhere, import —
 * then the batches themselves. Everything that decides anything (which titles,
 * what the prompts say, whether an answer is kept) happens on the server; this
 * page starts it, links the two files and shows what came back.
 *
 * AN IMPORT IS REPORTED LINE BY LINE. A rejected answer (the model broke the
 * output format) is the finding a person needs, because the fix is usually the
 * model or its context length, so every answer not stored is listed with its
 * reason rather than folded into a count.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  FormControlLabel,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  Delete as DeleteIcon,
  Download as DownloadIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  LockOpen as ReleaseIcon,
  PlayArrow as PrepareIcon,
  Stop as StopIcon,
  UploadFile as UploadIcon,
} from '@mui/icons-material'

interface BatchCounts {
  pending: number
  ready: number
  rejected: number
  stored: number
  declined: number
  skipped: number
  retrievalFailed: number
}

interface BatchSummary {
  id: string
  status: 'preparing' | 'ready' | 'closed'
  open: boolean
  error: string | null
  requested: number
  mediaTypes: Array<'movie' | 'series'>
  promptVersion: number
  promptVariant: string | null
  maxOutputTokens: number | null
  createdAt: string
  expiresAt: string
  lastImportAt: string | null
  counts: BatchCounts
  downloadable: number
}

interface BatchItem {
  id: string
  title: string
  year: number | null
  mediaType: 'movie' | 'series'
  status: string
  error: string | null
  model: string | null
}

interface Limits {
  defaultSize: number
  maxSize: number
  reservationDays: number
}

type ImportOutcome =
  | 'stored'
  | 'declined'
  | 'rejected'
  | 'runnerError'
  | 'superseded'
  | 'duplicate'
  | 'notExported'
  | 'stale'
  | 'unknown'
  | 'gone'

interface ImportSummary {
  counts: Record<ImportOutcome, number>
  lines: { customId: string; title: string | null; outcome: ImportOutcome; detail: string | null }[]
  badLines: number[]
}

/** In the order a reader wants them: what landed, then what needs a look. */
const OUTCOME_ORDER: ImportOutcome[] = [
  'stored',
  'declined',
  'rejected',
  'runnerError',
  'superseded',
  'duplicate',
  'notExported',
  'stale',
  'gone',
  'unknown',
]

const OUTCOME_COLOR: Partial<Record<ImportOutcome, 'success' | 'warning' | 'error'>> = {
  stored: 'success',
  rejected: 'error',
  runnerError: 'warning',
}

const COMMAND_EXAMPLE = 'node run-offsite-analysis.mjs aperture-analysis-xxxxxxxx.jsonl --model <model id>'

export default function OffsiteAnalysisRoute() {
  const { t, i18n } = useTranslation()

  const [batches, setBatches] = useState<BatchSummary[]>([])
  const [limits, setLimits] = useState<Limits>({ defaultSize: 100, maxSize: 500, reservationDays: 14 })
  const [runnerFileName, setRunnerFileName] = useState('run-offsite-analysis.mjs')
  const [count, setCount] = useState('100')
  const [movies, setMovies] = useState(true)
  const [series, setSeries] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [openBatch, setOpenBatch] = useState<string | null>(null)
  const [items, setItems] = useState<BatchItem[]>([])

  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportSummary | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const formatDate = (iso: string) => new Date(iso).toLocaleString(i18n.language)

  const loadBatches = useCallback(async () => {
    const res = await fetch('/api/analysis-offsite/batches', { credentials: 'include' })
    if (!res.ok) return
    const json = (await res.json()) as { batches: BatchSummary[]; limits: Limits; runnerFileName: string }
    setBatches(json.batches)
    setLimits(json.limits)
    setRunnerFileName(json.runnerFileName)
  }, [])

  const loadItems = useCallback(async (batchId: string) => {
    const res = await fetch(`/api/analysis-offsite/batches/${batchId}`, { credentials: 'include' })
    if (res.ok) setItems(((await res.json()) as { items: BatchItem[] }).items)
  }, [])

  useEffect(() => {
    void loadBatches()
  }, [loadBatches])

  // The default size comes from the server once it has answered, unless the
  // field has already been edited.
  const countTouched = useRef(false)
  useEffect(() => {
    if (!countTouched.current) setCount(String(limits.defaultSize))
  }, [limits.defaultSize])

  // Poll while something is preparing; stop once nothing is.
  const anyPreparing = batches.some((b) => b.status === 'preparing')
  useEffect(() => {
    if (!anyPreparing) return
    const timer = window.setInterval(() => {
      void loadBatches()
      if (openBatch) void loadItems(openBatch)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [anyPreparing, loadBatches, loadItems, openBatch])

  const prepare = async () => {
    setStarting(true)
    setError(null)
    try {
      const mediaTypes = [...(movies ? ['movie'] : []), ...(series ? ['series'] : [])]
      const res = await fetch('/api/analysis-offsite/batches', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: Number(count), mediaTypes }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error ?? t('offsiteAnalysis.prepareFailed'))
        return
      }
      await loadBatches()
    } catch {
      setError(t('offsiteAnalysis.prepareFailed'))
    } finally {
      setStarting(false)
    }
  }

  const act = async (batchId: string, action: 'stop' | 'close' | 'delete') => {
    if (action === 'delete' && !window.confirm(t('offsiteAnalysis.confirmDelete'))) return
    if (action === 'close' && !window.confirm(t('offsiteAnalysis.confirmRelease'))) return
    const res = await fetch(
      action === 'delete'
        ? `/api/analysis-offsite/batches/${batchId}`
        : `/api/analysis-offsite/batches/${batchId}/${action}`,
      { method: action === 'delete' ? 'DELETE' : 'POST', credentials: 'include' }
    )
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      setError(json?.error ?? t('offsiteAnalysis.actionFailed'))
    }
    if (action === 'delete' && openBatch === batchId) setOpenBatch(null)
    await loadBatches()
  }

  const toggleItems = async (batchId: string) => {
    if (openBatch === batchId) {
      setOpenBatch(null)
      return
    }
    setItems([])
    setOpenBatch(batchId)
    await loadItems(batchId)
  }

  const importFile = async (file: File) => {
    setImporting(true)
    setImportError(null)
    setImportResult(null)
    try {
      const jsonl = await file.text()
      const res = await fetch('/api/analysis-offsite/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonl }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setImportError(json?.error ?? t('offsiteAnalysis.importFailed'))
        return
      }
      setImportResult(json as ImportSummary)
      await loadBatches()
      if (openBatch) await loadItems(openBatch)
    } catch {
      setImportError(t('offsiteAnalysis.importFailed'))
    } finally {
      setImporting(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const countNumber = Number(count)
  const countValid = Number.isInteger(countNumber) && countNumber >= 1 && countNumber <= limits.maxSize

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="body2" color="text.secondary">
        {t('offsiteAnalysis.intro', { days: limits.reservationDays })}
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* 1 — prepare */}
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t('offsiteAnalysis.stepPrepare')}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          {t('offsiteAnalysis.prepareHint')}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <TextField
            size="small"
            type="number"
            label={t('offsiteAnalysis.countLabel')}
            value={count}
            onChange={(event) => {
              countTouched.current = true
              setCount(event.target.value)
            }}
            error={!countValid}
            helperText={t('offsiteAnalysis.countHelp', { max: limits.maxSize })}
            inputProps={{ min: 1, max: limits.maxSize }}
            sx={{ width: { sm: 180 } }}
          />
          <FormControlLabel
            control={<Checkbox checked={movies} onChange={(e) => setMovies(e.target.checked)} />}
            label={t('offsiteAnalysis.movies')}
          />
          <FormControlLabel
            control={<Checkbox checked={series} onChange={(e) => setSeries(e.target.checked)} />}
            label={t('offsiteAnalysis.series')}
          />
          <Button
            variant="contained"
            startIcon={<PrepareIcon />}
            disabled={starting || anyPreparing || !countValid || (!movies && !series)}
            onClick={prepare}
          >
            {t('offsiteAnalysis.prepare')}
          </Button>
        </Stack>
        {anyPreparing && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            {t('offsiteAnalysis.onePreparing')}
          </Typography>
        )}
      </Paper>

      {/* 2 — run it elsewhere */}
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t('offsiteAnalysis.stepRun')}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          {t('offsiteAnalysis.runHint')}
        </Typography>
        <Box component="ol" sx={{ pl: 3, my: 1.5, '& li': { mb: 0.75 } }}>
          <li>
            <Typography variant="body2">{t('offsiteAnalysis.runStepNode')}</Typography>
          </li>
          <li>
            <Typography variant="body2">{t('offsiteAnalysis.runStepContext')}</Typography>
          </li>
          <li>
            <Typography variant="body2">{t('offsiteAnalysis.runStepServer')}</Typography>
          </li>
          <li>
            <Typography variant="body2">{t('offsiteAnalysis.runStepCommand')}</Typography>
            <Box
              component="pre"
              sx={{
                mt: 0.75,
                p: 1.25,
                borderRadius: 1,
                bgcolor: 'action.hover',
                fontSize: 13,
                overflowX: 'auto',
                whiteSpace: 'pre',
              }}
            >
              {COMMAND_EXAMPLE}
            </Box>
          </li>
          <li>
            <Typography variant="body2">{t('offsiteAnalysis.runStepResume')}</Typography>
          </li>
        </Box>
        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          component="a"
          href="/api/analysis-offsite/runner"
          download={runnerFileName}
        >
          {t('offsiteAnalysis.downloadRunner')}
        </Button>
      </Paper>

      {/* 3 — import */}
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t('offsiteAnalysis.stepImport')}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          {t('offsiteAnalysis.importHint')}
        </Typography>
        <input
          ref={fileInput}
          type="file"
          accept=".jsonl,.json,.txt,application/x-ndjson,application/json,text/plain"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void importFile(file)
          }}
        />
        <Button
          variant="contained"
          startIcon={<UploadIcon />}
          disabled={importing}
          onClick={() => fileInput.current?.click()}
        >
          {t('offsiteAnalysis.importButton')}
        </Button>
        {importing && <LinearProgress sx={{ mt: 2 }} />}
        {importError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {importError}
          </Alert>
        )}
        {importResult && (
          <Box sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {OUTCOME_ORDER.filter((o) => importResult.counts[o] > 0).map((o) => (
                <Chip
                  key={o}
                  size="small"
                  color={OUTCOME_COLOR[o] ?? 'default'}
                  label={`${t(`offsiteAnalysis.outcome.${o}`)}: ${importResult.counts[o]}`}
                />
              ))}
              {importResult.lines.length === 0 && (
                <Typography variant="body2">{t('offsiteAnalysis.importNothing')}</Typography>
              )}
            </Box>
            {importResult.badLines.length > 0 && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                {t('offsiteAnalysis.badLines', {
                  count: importResult.badLines.length,
                  lines: importResult.badLines.slice(0, 10).join(', '),
                })}
              </Alert>
            )}
            {importResult.lines.some((l) => l.outcome !== 'stored') && (
              <Box sx={{ mt: 1.5 }}>
                {importResult.lines
                  .filter((l) => l.outcome !== 'stored')
                  .map((l) => (
                    <Typography key={l.customId} variant="body2" sx={{ mb: 0.5 }}>
                      <strong>{l.title ?? l.customId}</strong> — {t(`offsiteAnalysis.outcome.${l.outcome}`)}
                      {l.detail ? `: ${l.detail}` : ''}
                    </Typography>
                  ))}
              </Box>
            )}
          </Box>
        )}
      </Paper>

      {/* the batches */}
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
          {t('offsiteAnalysis.batches')}
        </Typography>
        {batches.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('offsiteAnalysis.noBatches')}
          </Typography>
        )}
        <Stack spacing={2}>
          {batches.map((batch) => {
            const c = batch.counts
            const done = c.ready + c.rejected + c.stored + c.declined + c.skipped + c.retrievalFailed
            return (
              <Box
                key={batch.id}
                sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}
              >
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {formatDate(batch.createdAt)}
                  </Typography>
                  <Chip
                    size="small"
                    color={batch.status === 'preparing' ? 'info' : batch.open ? 'primary' : 'default'}
                    label={t(
                      batch.status === 'preparing'
                        ? 'offsiteAnalysis.status.preparing'
                        : batch.open
                          ? 'offsiteAnalysis.status.open'
                          : batch.status === 'closed'
                            ? 'offsiteAnalysis.status.closed'
                            : 'offsiteAnalysis.status.expired'
                    )}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {t('offsiteAnalysis.batchMeta', {
                      version: batch.promptVariant
                        ? `v${batch.promptVersion} ${batch.promptVariant}`
                        : `v${batch.promptVersion}`,
                      requested: batch.requested,
                    })}
                  </Typography>
                </Box>

                {batch.status === 'preparing' && (
                  <Box sx={{ mt: 1 }}>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(100, (done / Math.max(1, batch.requested)) * 100)}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {t('offsiteAnalysis.preparingProgress', {
                        done: c.ready + c.rejected,
                        requested: batch.requested,
                      })}
                    </Typography>
                  </Box>
                )}

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
                  <Chip size="small" variant="outlined" label={t('offsiteAnalysis.count.inFile', { count: batch.downloadable })} />
                  {c.stored > 0 && (
                    <Chip size="small" color="success" variant="outlined" label={t('offsiteAnalysis.count.stored', { count: c.stored })} />
                  )}
                  {c.declined > 0 && (
                    <Chip size="small" variant="outlined" label={t('offsiteAnalysis.count.declined', { count: c.declined })} />
                  )}
                  {c.rejected > 0 && (
                    <Chip size="small" color="error" variant="outlined" label={t('offsiteAnalysis.count.rejected', { count: c.rejected })} />
                  )}
                  {c.skipped > 0 && (
                    <Chip size="small" variant="outlined" label={t('offsiteAnalysis.count.skipped', { count: c.skipped })} />
                  )}
                  {c.retrievalFailed > 0 && (
                    <Chip size="small" color="warning" variant="outlined" label={t('offsiteAnalysis.count.retrievalFailed', { count: c.retrievalFailed })} />
                  )}
                </Box>

                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
                  {batch.open
                    ? t('offsiteAnalysis.reservedUntil', { date: formatDate(batch.expiresAt) })
                    : t('offsiteAnalysis.released')}
                  {batch.lastImportAt
                    ? ' · ' + t('offsiteAnalysis.lastImport', { date: formatDate(batch.lastImportAt) })
                    : ''}
                </Typography>
                {batch.error && (
                  <Typography variant="caption" color="warning.main" display="block">
                    {batch.error}
                  </Typography>
                )}

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.25 }}>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<DownloadIcon />}
                    disabled={batch.downloadable === 0}
                    component="a"
                    href={`/api/analysis-offsite/batches/${batch.id}/download`}
                  >
                    {t('offsiteAnalysis.download', { count: batch.downloadable })}
                  </Button>
                  {batch.status === 'preparing' && (
                    <Button size="small" startIcon={<StopIcon />} onClick={() => act(batch.id, 'stop')}>
                      {t('offsiteAnalysis.stop')}
                    </Button>
                  )}
                  <Button
                    size="small"
                    startIcon={openBatch === batch.id ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    onClick={() => toggleItems(batch.id)}
                  >
                    {t('offsiteAnalysis.titles')}
                  </Button>
                  {batch.open && batch.status !== 'preparing' && (
                    <Button size="small" startIcon={<ReleaseIcon />} onClick={() => act(batch.id, 'close')}>
                      {t('offsiteAnalysis.release')}
                    </Button>
                  )}
                  {batch.status !== 'preparing' && (
                    <Button
                      size="small"
                      color="error"
                      startIcon={<DeleteIcon />}
                      onClick={() => act(batch.id, 'delete')}
                    >
                      {t('offsiteAnalysis.delete')}
                    </Button>
                  )}
                </Box>

                <Collapse in={openBatch === batch.id} unmountOnExit>
                  <Box sx={{ mt: 1.5, maxHeight: 360, overflowY: 'auto' }}>
                    {items.map((item) => (
                      <Typography key={item.id} variant="body2" sx={{ mb: 0.5 }}>
                        <strong>
                          {item.title}
                          {item.year ? ` (${item.year})` : ''}
                        </strong>{' '}
                        — {t(`offsiteAnalysis.itemStatus.${item.status}`, { defaultValue: item.status })}
                        {item.model ? ` · ${item.model}` : ''}
                        {item.error ? (
                          <Typography component="span" variant="caption" color="text.secondary" display="block">
                            {item.error}
                          </Typography>
                        ) : null}
                      </Typography>
                    ))}
                  </Box>
                </Collapse>
              </Box>
            )
          })}
        </Stack>
      </Paper>
    </Box>
  )
}
