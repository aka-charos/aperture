/**
 * Settings card for synopsis translation — the model that translates each
 * title's plot and full synopsis into the instance's enabled interface
 * languages, run by the `translate-title-synopses` job.
 *
 * Not the Appearance → Translations page, which edits the interface's own
 * strings. This translates library metadata.
 *
 * Any OpenAI-compatible endpoint works; the default is bilibili's free public
 * Index-Translate API. Which languages are targets is decided by the server
 * (`targets`) from the enabled interface languages, so the bundle never
 * re-derives the rule — it only shows the answer and lets the operator narrow
 * it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import SaveIcon from '@mui/icons-material/Save'
import SyncIcon from '@mui/icons-material/Sync'
import ScienceIcon from '@mui/icons-material/Science'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { jobConsoleLink } from '@/pages/jobs/registry'

type PromptStyle = 'index-translate' | 'instruction'

interface PublicConfig {
  enabled: boolean
  promptStyle: PromptStyle
  baseUrl: string
  model: string
  hasApiKey: boolean
  sourceLanguage: string
  targetLanguages: string[] | null
  fields: { overview: boolean; plot_full: boolean }
  instruction: string
  timeoutMs: number
  callSpacingSeconds: number
  analysisEnabled: boolean
  analysisInstruction: string
}

interface Readiness {
  ready: boolean
  reason: string | null
}

interface Described {
  config: PublicConfig
  readiness: Readiness
  /** Absent from an older server, which has no analysis translation. */
  analysisReadiness?: Readiness
  targets: string[]
  enabledUiLanguages: string[]
  defaults: { baseUrl: string; model: string }
}

interface LanguageStatus {
  language: string
  pendingMovies: number
  pendingSeries: number
  storedMovies: number
  storedSeries: number
  /** Film analyses. Absent from an older server; read as 0. */
  analysisPendingMovies?: number
  analysisPendingSeries?: number
  analysisStoredMovies?: number
  analysisStoredSeries?: number
}

type TranslationKind = 'synopsis' | 'analysis'

/** One row of a status table, whichever kind it counts. */
interface KindCounts {
  language: string
  pendingMovies: number
  pendingSeries: number
  stored: number
}

function countsFor(row: LanguageStatus, kind: TranslationKind): KindCounts {
  return kind === 'analysis'
    ? {
        language: row.language,
        pendingMovies: row.analysisPendingMovies ?? 0,
        pendingSeries: row.analysisPendingSeries ?? 0,
        stored: (row.analysisStoredMovies ?? 0) + (row.analysisStoredSeries ?? 0),
      }
    : {
        language: row.language,
        pendingMovies: row.pendingMovies,
        pendingSeries: row.pendingSeries,
        stored: row.storedMovies + row.storedSeries,
      }
}

type TestResult =
  | { success: true; language: string; source: string; text: string; model: string; latencyMs: number }
  | { success: false; error: string }

const JOB = 'translate-title-synopses'
const ANALYSIS_JOB = 'translate-title-analyses'

const toInt = (raw: string, fallback: number) => {
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export function SynopsisTranslationSection() {
  const { t } = useTranslation()
  const [described, setDescribed] = useState<Described | null>(null)
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  const [enabled, setEnabled] = useState(false)
  const [promptStyle, setPromptStyle] = useState<PromptStyle>('index-translate')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [sourceLanguage, setSourceLanguage] = useState('en')
  const [targetLanguages, setTargetLanguages] = useState<string[] | null>(null)
  const [overview, setOverview] = useState(true)
  const [plotFull, setPlotFull] = useState(true)
  const [instruction, setInstruction] = useState('')
  const [timeoutSeconds, setTimeoutSeconds] = useState('120')
  const [spacingSeconds, setSpacingSeconds] = useState('1')
  const [analysisEnabled, setAnalysisEnabled] = useState(false)
  const [analysisInstruction, setAnalysisInstruction] = useState('')

  const [models, setModels] = useState<{ reachable: boolean; models: string[] } | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [status, setStatus] = useState<LanguageStatus[] | null>(null)
  // Which kind and which language ('all' for every language) a clear is for.
  const [confirmClear, setConfirmClear] = useState<{ kind: TranslationKind; language: string } | null>(null)
  const [clearing, setClearing] = useState(false)

  const apply = useCallback((d: Described) => {
    setDescribed(d)
    const c = d.config
    setEnabled(c.enabled)
    setPromptStyle(c.promptStyle)
    setBaseUrl(c.baseUrl)
    setModel(c.model)
    setApiKey('')
    setSourceLanguage(c.sourceLanguage)
    setTargetLanguages(c.targetLanguages)
    setOverview(c.fields.overview)
    setPlotFull(c.fields.plot_full)
    setInstruction(c.instruction)
    setTimeoutSeconds(String(Math.round(c.timeoutMs / 1000)))
    setSpacingSeconds(String(c.callSpacingSeconds))
    setAnalysisEnabled(c.analysisEnabled === true)
    setAnalysisInstruction(c.analysisInstruction ?? '')
    setHasChanges(false)
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/synopsis-translation/status', { credentials: 'include' })
      if (response.ok) setStatus((await response.json()).languages ?? [])
    } catch {
      // A read-back, not the setting; the card works without it.
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const [configRes, localesRes] = await Promise.all([
          fetch('/api/settings/synopsis-translation', { credentials: 'include' }),
          fetch('/api/settings/locales', { credentials: 'include' }),
        ])
        if (localesRes.ok) {
          const data = await localesRes.json()
          setLabels(
            Object.fromEntries(
              (data.locales ?? []).map((l: { code: string; label: string }) => [l.code, l.label])
            )
          )
        }
        if (configRes.ok) apply(await configRes.json())
        else setError(t('settingsSynopsisTranslation.loadError'))
      } catch {
        setError(t('settingsSynopsisTranslation.loadError'))
      } finally {
        setLoading(false)
      }
    }
    load()
    fetchStatus()
  }, [apply, fetchStatus, t])

  const changed = useCallback(() => setHasChanges(true), [])
  const label = useCallback((code: string) => labels[code] ?? code, [labels])

  // The languages that CAN be targets: enabled for the interface, not the
  // source. What is selected among them is the stored list, or all of them.
  const candidates = useMemo(
    () => (described?.enabledUiLanguages ?? []).filter((c) => c !== sourceLanguage),
    [described, sourceLanguage]
  )
  const selected = targetLanguages ?? candidates

  const toggleTarget = (code: string) => {
    const base = targetLanguages ?? candidates
    setTargetLanguages(base.includes(code) ? base.filter((c) => c !== code) : [...base, code])
    changed()
  }

  const payload = () => ({
    enabled,
    promptStyle,
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    // Omitted when untouched: the server reads an empty string as "clear it".
    ...(apiKey ? { apiKey } : {}),
    sourceLanguage,
    targetLanguages,
    fields: { overview, plot_full: plotFull },
    instruction,
    timeoutMs: Math.round(toInt(timeoutSeconds, 120) * 1000),
    callSpacingSeconds: toInt(spacingSeconds, 1),
    analysisEnabled,
    analysisInstruction,
  })

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/settings/synopsis-translation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload()),
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        apply(data)
        setSuccess(t('settingsSynopsisTranslation.saved'))
        setTimeout(() => setSuccess(null), 3000)
        fetchStatus()
      } else {
        setError(data.error || t('settingsSynopsisTranslation.saveError'))
      }
    } catch {
      setError(t('settingsSynopsisTranslation.connectError'))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const response = await fetch('/api/settings/synopsis-translation/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...payload(), language: selected[0] }),
      })
      const data = await response.json().catch(() => null)
      setTestResult(
        data && typeof data.success === 'boolean'
          ? data
          : { success: false, error: t('settingsSynopsisTranslation.testFailed') }
      )
    } catch {
      setTestResult({ success: false, error: t('settingsSynopsisTranslation.connectError') })
    } finally {
      setTesting(false)
    }
  }

  const fetchModels = async () => {
    setModelsLoading(true)
    try {
      const params = new URLSearchParams({ baseUrl: baseUrl.trim(), promptStyle })
      const response = await fetch(`/api/settings/synopsis-translation/models?${params}`, {
        credentials: 'include',
      })
      setModels(response.ok ? await response.json() : { reachable: false, models: [] })
    } catch {
      setModels({ reachable: false, models: [] })
    } finally {
      setModelsLoading(false)
    }
  }

  const applyFreeEndpoint = () => {
    if (!described) return
    setPromptStyle('index-translate')
    setBaseUrl(described.defaults.baseUrl)
    setModel(described.defaults.model)
    setModels(null)
    changed()
  }

  const handleClear = async () => {
    if (!confirmClear) return
    setClearing(true)
    try {
      const params = new URLSearchParams({ kind: confirmClear.kind })
      if (confirmClear.language !== 'all') params.set('language', confirmClear.language)
      const response = await fetch(`/api/settings/synopsis-translation/translations?${params}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        setSuccess(t('settingsSynopsisTranslation.cleared', { count: data.cleared ?? 0 }))
        setTimeout(() => setSuccess(null), 5000)
        fetchStatus()
      } else {
        setError(data.error || t('settingsSynopsisTranslation.clearError'))
      }
    } catch {
      setError(t('settingsSynopsisTranslation.connectError'))
    } finally {
      setClearing(false)
      setConfirmClear(null)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent>
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress />
          </Box>
        </CardContent>
      </Card>
    )
  }

  const savedOn = !!described?.config.enabled
  const readiness = described?.readiness
  const analysisReadiness = described?.analysisReadiness
  const analysisSavedOn = !!described?.config.analysisEnabled

  /**
   * The status block for one kind: totals, the job link, clear, and a row per
   * language. One function for both, so the two tables cannot drift apart.
   */
  const renderStatus = (kind: TranslationKind) => {
    const rows = (status ?? []).map((row) => countsFor(row, kind))
    const pending = rows.reduce((n, r) => n + r.pendingMovies + r.pendingSeries, 0)
    const stored = rows.reduce((n, r) => n + r.stored, 0)
    const isAnalysis = kind === 'analysis'
    return (
      <Box>
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" mb={1}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ flexGrow: 1 }}>
            {t(
              isAnalysis ? 'settingsSynopsisTranslation.analysisStatusTitle' : 'settingsSynopsisTranslation.statusTitle',
              { pending, stored }
            )}
          </Typography>
          <Button
            size="small"
            startIcon={<PlayArrowIcon />}
            component={RouterLink}
            to={jobConsoleLink(isAnalysis ? ANALYSIS_JOB : JOB)}
          >
            {t('settingsSynopsisTranslation.openJob')}
          </Button>
          {stored > 0 && (
            <Button size="small" color="error" onClick={() => setConfirmClear({ kind, language: 'all' })}>
              {t('settingsSynopsisTranslation.clearAll')}
            </Button>
          )}
        </Box>
        {rows.length > 0 ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('settingsSynopsisTranslation.colLanguage')}</TableCell>
                <TableCell align="right">{t('settingsSynopsisTranslation.colMoviesPending')}</TableCell>
                <TableCell align="right">{t('settingsSynopsisTranslation.colSeriesPending')}</TableCell>
                <TableCell align="right">{t('settingsSynopsisTranslation.colStored')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.language}>
                  <TableCell>
                    {label(row.language)}
                    {!described?.targets.includes(row.language) && (
                      <Chip size="small" sx={{ ml: 1 }} label={t('settingsSynopsisTranslation.notTarget')} />
                    )}
                  </TableCell>
                  <TableCell align="right">{row.pendingMovies.toLocaleString()}</TableCell>
                  <TableCell align="right">{row.pendingSeries.toLocaleString()}</TableCell>
                  <TableCell align="right">{row.stored.toLocaleString()}</TableCell>
                  <TableCell align="right">
                    {row.stored > 0 && (
                      <Tooltip title={t('settingsSynopsisTranslation.clearLanguage', { language: label(row.language) })}>
                        <IconButton size="small" onClick={() => setConfirmClear({ kind, language: row.language })}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t('settingsSynopsisTranslation.statusEmpty')}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          {t(isAnalysis ? 'settingsSynopsisTranslation.analysisStatusHelp' : 'settingsSynopsisTranslation.statusHelp')}
        </Typography>
      </Box>
    )
  }

  return (
    <Card>
      <CardContent>
        <Box display="flex" alignItems="center" gap={2} mb={2} flexWrap="wrap">
          <Typography variant="h6" fontWeight={600}>
            {t('settingsSynopsisTranslation.title')}
          </Typography>
          {savedOn && readiness?.ready && (
            <Chip icon={<CheckCircleIcon />} label={t('settingsSynopsisTranslation.chipOn')} color="success" size="small" />
          )}
          {savedOn && readiness && !readiness.ready && (
            <Chip label={t('settingsSynopsisTranslation.chipNotReady')} color="warning" size="small" />
          )}
          {!savedOn && <Chip label={t('settingsSynopsisTranslation.chipOff')} size="small" />}
        </Box>

        <Typography variant="body2" color="text.secondary" mb={3}>
          {t('settingsSynopsisTranslation.description')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {success}
          </Alert>
        )}
        {savedOn && readiness && !readiness.ready && readiness.reason && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {readiness.reason}
          </Alert>
        )}

        <Stack spacing={2.5}>
          <FormControlLabel
            id="synopsis-translation-enabled"
            control={
              <Switch
                checked={enabled}
                onChange={(e) => {
                  setEnabled(e.target.checked)
                  changed()
                }}
              />
            }
            label={t('settingsSynopsisTranslation.enabledLabel')}
          />

          {/* ------------------------------------------------ endpoint */}
          <Box>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              {t('settingsSynopsisTranslation.promptStyleLabel')}
            </Typography>
            <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
              <ToggleButtonGroup
                exclusive
                size="small"
                value={promptStyle}
                onChange={(_e, value: PromptStyle | null) => {
                  if (!value) return
                  setPromptStyle(value)
                  changed()
                }}
              >
                <ToggleButton value="index-translate">{t('settingsSynopsisTranslation.styleIndexTranslate')}</ToggleButton>
                <ToggleButton value="instruction">{t('settingsSynopsisTranslation.styleInstruction')}</ToggleButton>
              </ToggleButtonGroup>
              <Button size="small" onClick={applyFreeEndpoint}>
                {t('settingsSynopsisTranslation.useFreeEndpoint')}
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              {promptStyle === 'index-translate'
                ? t('settingsSynopsisTranslation.styleIndexTranslateHelp')
                : t('settingsSynopsisTranslation.styleInstructionHelp')}
            </Typography>
          </Box>

          <TextField
            id="synopsis-translation-base-url"
            fullWidth
            label={t('settingsSynopsisTranslation.baseUrlLabel')}
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value)
              setModels(null)
              changed()
            }}
            placeholder={described?.defaults.baseUrl}
            helperText={t('settingsSynopsisTranslation.baseUrlHelp')}
          />

          <TextField
            autoComplete="off"
            fullWidth
            label={t('settingsSynopsisTranslation.apiKeyLabel')}
            type={showApiKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              changed()
            }}
            // The server drops a stored key when the endpoint changes, so the
            // dots only promise a key that a save would actually keep.
            placeholder={described?.config.hasApiKey && baseUrl.trim() === described.config.baseUrl ? '••••••••' : ''}
            helperText={t('settingsSynopsisTranslation.apiKeyHelp')}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowApiKey((v) => !v)} edge="end" size="small">
                      {showApiKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />

          <Box display="flex" gap={1} alignItems="flex-start">
            <Autocomplete
              id="synopsis-translation-model"
              freeSolo
              fullWidth
              options={models?.models ?? []}
              inputValue={model}
              onInputChange={(_e, value, reason) => {
                if (reason === 'reset' && value === model) return
                setModel(value)
                if (reason !== 'reset') changed()
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t('settingsSynopsisTranslation.modelLabel')}
                  helperText={
                    models && !models.reachable
                      ? t('settingsSynopsisTranslation.modelsUnreachable')
                      : t('settingsSynopsisTranslation.modelHelp')
                  }
                />
              )}
            />
            <Tooltip title={t('settingsSynopsisTranslation.loadModels')}>
              <span>
                <IconButton onClick={fetchModels} disabled={modelsLoading || !baseUrl.trim()} sx={{ mt: 1 }}>
                  {modelsLoading ? <CircularProgress size={20} /> : <SyncIcon />}
                </IconButton>
              </span>
            </Tooltip>
          </Box>

          <Divider />

          {/* ------------------------------------------------ what and where to */}
          <Box id="synopsis-translation-targets">
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              {t('settingsSynopsisTranslation.targetsLabel')}
            </Typography>
            {candidates.length === 0 ? (
              <Alert severity="info">{t('settingsSynopsisTranslation.noCandidates')}</Alert>
            ) : (
              <Box display="flex" gap={1} flexWrap="wrap" alignItems="center">
                {candidates.map((code) => (
                  <Chip
                    key={code}
                    label={label(code)}
                    color={selected.includes(code) ? 'primary' : 'default'}
                    variant={selected.includes(code) ? 'filled' : 'outlined'}
                    onClick={() => toggleTarget(code)}
                  />
                ))}
                {targetLanguages !== null && (
                  <Button
                    size="small"
                    onClick={() => {
                      setTargetLanguages(null)
                      changed()
                    }}
                  >
                    {t('settingsSynopsisTranslation.followInterface')}
                  </Button>
                )}
              </Box>
            )}
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              {targetLanguages === null
                ? t('settingsSynopsisTranslation.targetsFollowHelp')
                : t('settingsSynopsisTranslation.targetsListHelp')}
            </Typography>
          </Box>

          <FormControl size="small" sx={{ maxWidth: 260 }}>
            <InputLabel id="synopsis-translation-source-label">
              {t('settingsSynopsisTranslation.sourceLabel')}
            </InputLabel>
            <Select
              labelId="synopsis-translation-source-label"
              label={t('settingsSynopsisTranslation.sourceLabel')}
              value={sourceLanguage}
              onChange={(e) => {
                setSourceLanguage(e.target.value)
                changed()
              }}
            >
              {(Object.keys(labels).length > 0 ? Object.keys(labels) : [sourceLanguage]).map((code) => (
                <MenuItem key={code} value={code}>
                  {label(code)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              {t('settingsSynopsisTranslation.fieldsLabel')}
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={overview}
                  onChange={(e) => {
                    setOverview(e.target.checked)
                    changed()
                  }}
                />
              }
              label={t('settingsSynopsisTranslation.fieldOverview')}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={plotFull}
                  onChange={(e) => {
                    setPlotFull(e.target.checked)
                    changed()
                  }}
                />
              }
              label={t('settingsSynopsisTranslation.fieldPlotFull')}
            />
          </Box>

          <TextField
            fullWidth
            multiline
            minRows={2}
            label={t('settingsSynopsisTranslation.instructionsLabel')}
            value={instruction}
            onChange={(e) => {
              setInstruction(e.target.value)
              changed()
            }}
            // The field is the system prompt in effect, but where it lands
            // depends on the model type: Index-Translate has no system message
            // (each line becomes an in-prompt constraint), a chat model gets it
            // appended to the system prompt core already sends.
            helperText={
              promptStyle === 'index-translate'
                ? t('settingsSynopsisTranslation.instructionsHelpIndexTranslate')
                : t('settingsSynopsisTranslation.instructionsHelpChat')
            }
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />

          <Box display="flex" gap={2} flexWrap="wrap">
            <TextField
              type="number"
              size="small"
              label={t('settingsSynopsisTranslation.timeoutLabel')}
              value={timeoutSeconds}
              onChange={(e) => {
                setTimeoutSeconds(e.target.value)
                changed()
              }}
              slotProps={{ htmlInput: { min: 5, max: 600 } }}
              sx={{ width: 200 }}
            />
            <TextField
              type="number"
              size="small"
              label={t('settingsSynopsisTranslation.spacingLabel')}
              value={spacingSeconds}
              onChange={(e) => {
                setSpacingSeconds(e.target.value)
                changed()
              }}
              helperText={t('settingsSynopsisTranslation.spacingHelp')}
              slotProps={{ htmlInput: { min: 0, max: 120, step: 0.5 } }}
              sx={{ width: 260 }}
            />
          </Box>

          <Divider />

          {/* ------------------------------------------------ film analyses
              Their own switch and instructions; everything above them (the
              endpoint, model, languages, timeout and pause) is shared, and
              the analysis job paces on the same key as the synopsis job. */}
          <Box>
            <Typography variant="subtitle1" fontWeight={600}>
              {t('settingsSynopsisTranslation.analysisHeading')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t('settingsSynopsisTranslation.analysisIntro')}
            </Typography>
          </Box>
          {analysisSavedOn && analysisReadiness && !analysisReadiness.ready && analysisReadiness.reason && (
            <Alert severity="warning">{analysisReadiness.reason}</Alert>
          )}
          <FormControlLabel
            id="synopsis-translation-analysis-enabled"
            control={
              <Switch
                checked={analysisEnabled}
                onChange={(e) => {
                  setAnalysisEnabled(e.target.checked)
                  changed()
                }}
              />
            }
            label={t('settingsSynopsisTranslation.analysisEnabledLabel')}
          />
          <TextField
            fullWidth
            multiline
            minRows={2}
            label={t('settingsSynopsisTranslation.analysisInstructionsLabel')}
            value={analysisInstruction}
            onChange={(e) => {
              setAnalysisInstruction(e.target.value)
              changed()
            }}
            helperText={
              promptStyle === 'index-translate'
                ? t('settingsSynopsisTranslation.analysisInstructionsHelpIndexTranslate')
                : t('settingsSynopsisTranslation.analysisInstructionsHelpChat')
            }
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />

          <Box display="flex" gap={1} flexWrap="wrap">
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={18} /> : <SaveIcon />}
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {t('settingsSynopsisTranslation.save')}
            </Button>
            <Button
              variant="outlined"
              startIcon={testing ? <CircularProgress size={18} /> : <ScienceIcon />}
              onClick={handleTest}
              disabled={testing || !baseUrl.trim() || selected.length === 0}
            >
              {t('settingsSynopsisTranslation.test')}
            </Button>
          </Box>

          {testResult && (
            <Alert severity={testResult.success ? 'success' : 'error'} onClose={() => setTestResult(null)}>
              {testResult.success ? (
                <>
                  <Typography variant="body2" fontWeight={600}>
                    {t('settingsSynopsisTranslation.testOk', {
                      language: label(testResult.language),
                      model: testResult.model,
                      seconds: (testResult.latencyMs / 1000).toFixed(1),
                    })}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
                    {testResult.source}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    {testResult.text}
                  </Typography>
                </>
              ) : (
                testResult.error
              )}
            </Alert>
          )}

          <Divider />

          {/* ------------------------------------------------ status */}
          {renderStatus('synopsis')}
          {renderStatus('analysis')}
        </Stack>
      </CardContent>

      <Dialog open={confirmClear !== null} onClose={() => setConfirmClear(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('settingsSynopsisTranslation.clearConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirmClear?.kind === 'analysis'
              ? confirmClear.language === 'all'
                ? t('settingsSynopsisTranslation.analysisClearConfirmAll')
                : t('settingsSynopsisTranslation.analysisClearConfirmLanguage', { language: label(confirmClear.language) })
              : confirmClear?.language === 'all'
                ? t('settingsSynopsisTranslation.clearConfirmAll')
                : t('settingsSynopsisTranslation.clearConfirmLanguage', { language: label(confirmClear?.language ?? '') })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClear(null)} disabled={clearing}>
            {t('common.cancel')}
          </Button>
          <Button color="error" variant="contained" onClick={handleClear} disabled={clearing}>
            {t('settingsSynopsisTranslation.clearConfirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
