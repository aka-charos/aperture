/**
 * Settings card for the optional decision model — the second opinion on whether
 * a pick's "closest in your history" titles are a real reason for it.
 *
 * Off by default, and nothing depends on it: when it is off, unreachable or
 * slow, the server's similarity bar decides the heading exactly as before. That
 * is why this card leads with the switch and why the test is a real call on two
 * fixed pairs rather than a ping — a model that answers 0.5 to everything
 * "works" and buys nothing.
 *
 * The lower half reads back what the stored verdicts did — how often they
 * agreed with the similarity bar — and then hands every disagreement between
 * the three judges (bar, director-or-franchise rule, model) to the operator to
 * label blind (DecisionModelLabelling). Disagreements are the only place a
 * judge can earn its keep, and only a person can say which judge was right.
 *
 * Model ids and prices come from the server; the bundle holds no list of them.
 */
import { useState, useEffect, useCallback } from 'react'
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
  FormControlLabel,
  IconButton,
  InputAdornment,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import SaveIcon from '@mui/icons-material/Save'
import SyncIcon from '@mui/icons-material/Sync'
import RefreshIcon from '@mui/icons-material/Refresh'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import ScienceIcon from '@mui/icons-material/Science'
import { jobConsoleLink } from '@/pages/jobs/registry'
import { DecisionModelBenchmarkResults, type BenchmarkResult } from './DecisionModelBenchmark'
import { DecisionModelLabelling } from './DecisionModelLabelling'
import { DecisionModelExplanations } from './DecisionModelExplanations'

type Source = 'openrouter' | 'custom'

interface PublicConfig {
  enabled: boolean
  filterAnalysisSources: boolean
  source: Source
  model: string
  baseUrl: string
  hasApiKey: boolean
  timeoutMs: number
  concurrency: number
}

interface Readiness {
  ready: boolean
  reason: string | null
}

interface ModelOption {
  id: string
  name: string | null
  contextLength: number | null
  inputPricePerMillion: number | null
}

interface Catalog {
  reachable: boolean
  models: ModelOption[]
}

type TestResult =
  | {
      success: true
      model: string
      latencyMs: number
      related: number
      unrelated: number
      discriminates: boolean
    }
  | { success: false; error: string }

interface Stats {
  runs: number
  picks: number
  judgedPicks: number
  agree: number
  judgeOnly: number
  cosineOnly: number
  /** Judged picks per answering model. More than one means the counts pool them. */
  models: Array<{ model: string; picks: number }>
}

const REFRESH_JOB = 'refresh-recommendation-explanations'

const clampInt = (raw: string, min: number, max: number, fallback: number) =>
  Math.min(max, Math.max(min, parseInt(raw || String(fallback), 10) || fallback))

const percent = (p: number) => Math.round(p * 100)

export function DecisionModelSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  // Core's floor on what the source filter may leave behind, shipped decided
  // because the bundle never imports core. The fallback matches core's own
  // default and only shows before the first GET lands.
  const [sourceFilterFloor, setSourceFilterFloor] = useState(4)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [benchmarking, setBenchmarking] = useState(false)
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(null)

  const [enabled, setEnabled] = useState(false)
  const [filterSources, setFilterSources] = useState(false)
  const [source, setSource] = useState<Source>('openrouter')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [timeoutSeconds, setTimeoutSeconds] = useState('20')
  const [concurrency, setConcurrency] = useState('4')
  const [hasChanges, setHasChanges] = useState(false)

  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)

  const applyConfig = useCallback((c: PublicConfig) => {
    setConfig(c)
    setEnabled(!!c.enabled)
    setFilterSources(!!c.filterAnalysisSources)
    setSource(c.source ?? 'openrouter')
    setModel(c.model ?? '')
    setBaseUrl(c.baseUrl ?? '')
    setApiKey('')
    setTimeoutSeconds(String(Math.round((c.timeoutMs ?? 20000) / 1000)))
    setConcurrency(String(c.concurrency ?? 4))
    setHasChanges(false)
  }, [])

  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/decision-model', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        applyConfig(data.config)
        setReadiness(data.readiness ?? null)
        if (typeof data.sourceFilterFloor === 'number') setSourceFilterFloor(data.sourceFilterFloor)
      } else {
        setError(t('settingsDecisionModel.loadError'))
      }
    } catch {
      setError(t('settingsDecisionModel.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t, applyConfig])

  const fetchCatalog = useCallback(async (forSource: Source, forBaseUrl: string) => {
    setCatalogLoading(true)
    try {
      const params = new URLSearchParams({ source: forSource })
      if (forSource === 'custom' && forBaseUrl.trim()) params.set('baseUrl', forBaseUrl.trim())
      const response = await fetch(`/api/settings/decision-model/models?${params}`, {
        credentials: 'include',
      })
      setCatalog(response.ok ? await response.json() : { reachable: false, models: [] })
    } catch {
      setCatalog({ reachable: false, models: [] })
    } finally {
      setCatalogLoading(false)
    }
  }, [])

  const fetchStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const response = await fetch('/api/settings/decision-model/stats', { credentials: 'include' })
      if (response.ok) setStats(await response.json())
    } catch {
      // The stats are a read-back, not the setting; the card works without them.
    } finally {
      setStatsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
    fetchStats()
  }, [fetchConfig, fetchStats])

  const handleClear = async () => {
    setClearing(true)
    setError(null)
    try {
      const response = await fetch('/api/settings/decision-model/verdicts', {
        method: 'DELETE',
        credentials: 'include',
      })
      if (response.ok) {
        const data = await response.json().catch(() => ({}))
        setSuccess(t('settingsDecisionModel.cleared', { count: data.cleared ?? 0 }))
        setTimeout(() => setSuccess(null), 5000)
        await fetchStats()
      } else {
        const err = await response.json().catch(() => ({}))
        setError(err.error || t('settingsDecisionModel.clearError'))
      }
    } catch {
      setError(t('settingsDecisionModel.errConnect'))
    } finally {
      setClearing(false)
      setConfirmClear(false)
    }
  }

  // The OpenRouter list is public and cheap, so it loads with the card. A
  // self-hosted server is asked only when someone presses Refresh, since its
  // URL may be half-typed.
  useEffect(() => {
    if (config && source === 'openrouter') fetchCatalog('openrouter', '')
  }, [config, source, fetchCatalog])

  const markChanged = useCallback(() => setHasChanges(true), [])

  const buildPayload = () => ({
    enabled,
    filterAnalysisSources: filterSources,
    source,
    model: model.trim(),
    baseUrl: baseUrl.trim(),
    // Omitted when untouched: the server reads an empty string as "clear it".
    ...(apiKey ? { apiKey } : {}),
    timeoutMs: clampInt(timeoutSeconds, 2, 120, 20) * 1000,
    concurrency: clampInt(concurrency, 1, 16, 4),
  })

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/settings/decision-model', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(buildPayload()),
      })
      if (response.ok) {
        const data = await response.json()
        applyConfig(data.config)
        setReadiness(data.readiness ?? null)
        if (typeof data.sourceFilterFloor === 'number') setSourceFilterFloor(data.sourceFilterFloor)
        setSuccess(t('settingsDecisionModel.saved'))
        setTimeout(() => setSuccess(null), 3000)
      } else {
        const err = await response.json().catch(() => ({}))
        setError(err.error || t('settingsDecisionModel.errSave'))
      }
    } catch {
      setError(t('settingsDecisionModel.errConnect'))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      const response = await fetch('/api/settings/decision-model/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(buildPayload()),
      })
      const result = await response.json().catch(() => null)
      setTestResult(
        result && typeof result.success === 'boolean'
          ? result
          : { success: false, error: t('settingsDecisionModel.testFailed') }
      )
    } catch {
      setTestResult({ success: false, error: t('settingsDecisionModel.errConnect') })
    } finally {
      setTesting(false)
    }
  }

  const handleBenchmark = async () => {
    setBenchmarking(true)
    setBenchmark(null)
    setError(null)
    try {
      const response = await fetch('/api/settings/decision-model/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(buildPayload()),
      })
      const result = await response.json().catch(() => null)
      setBenchmark(
        result && typeof result.success === 'boolean'
          ? result
          : { success: false, error: t('settingsDecisionModel.benchmarkError') }
      )
    } catch {
      setBenchmark({ success: false, error: t('settingsDecisionModel.errConnect') })
    } finally {
      setBenchmarking(false)
    }
  }

  const optionMeta = (option: ModelOption): string => {
    const parts: string[] = []
    if (option.contextLength != null) {
      parts.push(
        t('settingsDecisionModel.modelContext', { count: Math.round(option.contextLength / 1000) })
      )
    }
    if (option.inputPricePerMillion != null) {
      parts.push(
        option.inputPricePerMillion === 0
          ? t('settingsDecisionModel.priceFree')
          : t('settingsDecisionModel.pricePerMillion', {
              price: option.inputPricePerMillion.toFixed(3),
            })
      )
    }
    return parts.join(' · ')
  }

  if (loading) {
    return (
      <Card sx={{ height: '100%' }}>
        <CardContent>
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress />
          </Box>
        </CardContent>
      </Card>
    )
  }

  const savedOn = !!config?.enabled
  const canTest = source === 'openrouter' || !!baseUrl.trim()

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={2} mb={2} flexWrap="wrap">
          <Typography variant="h6" fontWeight={600}>
            {t('settingsDecisionModel.title')}
          </Typography>
          {savedOn && readiness?.ready && (
            <Chip
              icon={<CheckCircleIcon />}
              label={t('settingsDecisionModel.chipOn')}
              color="success"
              size="small"
            />
          )}
          {savedOn && readiness && !readiness.ready && (
            <Chip label={t('settingsDecisionModel.chipNotReady')} color="warning" size="small" />
          )}
          {!savedOn && <Chip label={t('settingsDecisionModel.chipOff')} size="small" />}
        </Box>

        <Typography variant="body2" color="text.secondary" mb={3}>
          {t('settingsDecisionModel.description')}
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

        <Stack spacing={2}>
          <FormControlLabel
            id="decision-enabled"
            control={
              <Switch
                checked={enabled}
                onChange={(e) => {
                  setEnabled(e.target.checked)
                  markChanged()
                }}
              />
            }
            label={t('settingsDecisionModel.enabledLabel')}
          />

          {/*
            The second consumer, with its own switch and indented under the
            first, because it is a different bill: the evidence heading asks a
            few dozen questions per recommendation run, this asks one per
            retrieved document per title across the whole library. Disabled
            rather than hidden when the integration is off, so the capability
            is discoverable before anything is turned on.
          */}
          <Box sx={{ pl: 4, mt: -1 }}>
            <FormControlLabel
              id="decision-filter-sources"
              disabled={!enabled}
              control={
                <Switch
                  checked={filterSources}
                  onChange={(e) => {
                    setFilterSources(e.target.checked)
                    markChanged()
                  }}
                />
              }
              label={t('settingsDecisionModel.filterSourcesLabel')}
            />
            <Typography variant="caption" color="text.secondary" display="block">
              {/* The floor is core's, and the bundle never imports core — it
                  rides in the GET as a decided number. */}
              {t('settingsDecisionModel.filterSourcesHelp', { floor: sourceFilterFloor })}
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              {t('settingsDecisionModel.sourceLabel')}
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={source}
              onChange={(_e, value: Source | null) => {
                if (!value) return
                setSource(value)
                setCatalog(null)
                markChanged()
              }}
            >
              <ToggleButton value="openrouter">{t('settingsDecisionModel.sourceOpenRouter')}</ToggleButton>
              <ToggleButton value="custom">{t('settingsDecisionModel.sourceCustom')}</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              {source === 'openrouter'
                ? t('settingsDecisionModel.sourceOpenRouterHelp')
                : t('settingsDecisionModel.sourceCustomHelp')}
            </Typography>
          </Box>

          {source === 'custom' && (
            <>
              <TextField
                id="decision-base-url"
                fullWidth
                label={t('settingsDecisionModel.baseUrlLabel')}
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value)
                  markChanged()
                }}
                placeholder="http://host.docker.internal:11435"
                helperText={t('settingsDecisionModel.baseUrlHelp')}
              />
              <TextField
                autoComplete="off"
                fullWidth
                label={t('settingsDecisionModel.apiKeyLabel')}
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  markChanged()
                }}
                placeholder={config?.hasApiKey ? '••••••••' : ''}
                helperText={t('settingsDecisionModel.apiKeyHelp')}
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
            </>
          )}

          <Box display="flex" gap={1} alignItems="flex-start">
            <Autocomplete
              id="decision-model-id"
              freeSolo
              fullWidth
              options={catalog?.models ?? []}
              getOptionLabel={(option) => (typeof option === 'string' ? option : option.id)}
              inputValue={model}
              onInputChange={(_e, value, reason) => {
                // 'reset' fires when options load; only a person typing or
                // picking changes the setting.
                if (reason === 'reset' && value === model) return
                setModel(value)
                if (reason !== 'reset') markChanged()
              }}
              onChange={(_e, value) => {
                const id = typeof value === 'string' ? value : value?.id
                if (id) {
                  setModel(id)
                  markChanged()
                }
              }}
              renderOption={(props, option) => {
                const { key, ...rest } = props as typeof props & { key: string }
                return (
                  <li key={key} {...rest}>
                    <Box>
                      <Typography variant="body2">{option.id}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {[option.name, optionMeta(option)].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                  </li>
                )
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t('settingsDecisionModel.modelLabel')}
                  placeholder="typesafe/jev-1.13"
                  helperText={
                    catalog && !catalog.reachable
                      ? t('settingsDecisionModel.modelsUnreachable')
                      : t('settingsDecisionModel.modelHelp')
                  }
                />
              )}
            />
            <Tooltip title={t('settingsDecisionModel.modelsRefresh')}>
              <span>
                <IconButton
                  onClick={() => fetchCatalog(source, baseUrl)}
                  disabled={catalogLoading || (source === 'custom' && !baseUrl.trim())}
                  sx={{ mt: 1 }}
                >
                  {catalogLoading ? <CircularProgress size={20} /> : <RefreshIcon />}
                </IconButton>
              </span>
            </Tooltip>
          </Box>

          <Box display="flex" gap={2} flexWrap="wrap">
            <TextField
              label={t('settingsDecisionModel.timeoutLabel')}
              type="number"
              value={timeoutSeconds}
              onChange={(e) => {
                setTimeoutSeconds(e.target.value)
                markChanged()
              }}
              helperText={t('settingsDecisionModel.timeoutHelp')}
              sx={{ flex: '1 1 200px' }}
            />
            <TextField
              label={t('settingsDecisionModel.concurrencyLabel')}
              type="number"
              value={concurrency}
              onChange={(e) => {
                setConcurrency(e.target.value)
                markChanged()
              }}
              helperText={t('settingsDecisionModel.concurrencyHelp')}
              sx={{ flex: '1 1 200px' }}
            />
          </Box>

          {testResult && (
            <Alert
              severity={!testResult.success ? 'error' : testResult.discriminates ? 'success' : 'warning'}
            >
              {!testResult.success
                ? testResult.error
                : t(
                    testResult.discriminates
                      ? 'settingsDecisionModel.testPassed'
                      : 'settingsDecisionModel.testNotDiscriminating',
                    {
                      model: testResult.model,
                      related: percent(testResult.related),
                      unrelated: percent(testResult.unrelated),
                      ms: testResult.latencyMs,
                    }
                  )}
            </Alert>
          )}

          <Box display="flex" gap={2} flexWrap="wrap">
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {t('settingsDecisionModel.save')}
            </Button>
            <Button
              variant="outlined"
              startIcon={testing ? <CircularProgress size={16} /> : <SyncIcon />}
              onClick={handleTest}
              disabled={testing || !canTest || !model.trim()}
            >
              {t('settingsDecisionModel.test')}
            </Button>
            <Button
              id="decision-benchmark"
              variant="outlined"
              startIcon={benchmarking ? <CircularProgress size={16} /> : <ScienceIcon />}
              onClick={handleBenchmark}
              disabled={benchmarking || !canTest || !model.trim()}
            >
              {t('settingsDecisionModel.benchmark')}
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
            {t('settingsDecisionModel.benchmarkHelp')}
          </Typography>

          {benchmark && <DecisionModelBenchmarkResults result={benchmark} />}

          <Alert
            severity="info"
            action={
              <Button color="inherit" size="small" component={RouterLink} to={jobConsoleLink(REFRESH_JOB)}>
                {t('settingsDecisionModel.openJobs')}
              </Button>
            }
          >
            {t('settingsDecisionModel.applyHint')}
          </Alert>

          <Divider />

          <Box>
            <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
              <Typography variant="subtitle1" fontWeight={600}>
                {t('settingsDecisionModel.statsTitle')}
              </Typography>
              <Tooltip title={t('settingsDecisionModel.statsRefresh')}>
                <span>
                  <IconButton size="small" onClick={fetchStats} disabled={statsLoading}>
                    {statsLoading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
            <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
              {t('settingsDecisionModel.statsDescription')}
            </Typography>

            {stats && stats.judgedPicks === 0 && (
              <Typography variant="body2" color="text.secondary">
                {t('settingsDecisionModel.statsNone')}
              </Typography>
            )}

            {stats && stats.judgedPicks > 0 && (
              <>
                <Typography variant="body2" mb={1}>
                  {t('settingsDecisionModel.statsSummary', {
                    judged: stats.judgedPicks,
                    picks: stats.picks,
                    agree: stats.agree,
                    judgeOnly: stats.judgeOnly,
                    cosineOnly: stats.cosineOnly,
                  })}
                </Typography>
                {/* Two models' verdicts pooled measure neither, so say so
                    rather than letting the counts above read as one model's. */}
                {(stats.models ?? []).length > 1 ? (
                  <Alert severity="warning" sx={{ mb: 1.5 }}>
                    {t('settingsDecisionModel.statsMixedModels', {
                      models: stats.models.map((m) => `${m.model} (${m.picks})`).join(', '),
                    })}
                  </Alert>
                ) : (
                  (stats.models ?? []).length === 1 && (
                    <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
                      {t('settingsDecisionModel.statsModel', { model: stats.models[0].model })}
                    </Typography>
                  )
                )}
                <Box mt={2}>
                  <Button
                    color="warning"
                    variant="outlined"
                    size="small"
                    onClick={() => setConfirmClear(true)}
                    disabled={clearing}
                  >
                    {t('settingsDecisionModel.clearVerdicts')}
                  </Button>
                  <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                    {t('settingsDecisionModel.clearHint')}
                  </Typography>
                </Box>
                <Divider sx={{ my: 2 }} />
                <DecisionModelLabelling />
              </>
            )}
          </Box>

          {/* Outside the verdicts block on purpose: explanations exist, and can
              be checked, whether or not evidence judging was ever switched on. */}
          <Divider />
          <DecisionModelExplanations />
        </Stack>
      </CardContent>

      <Dialog open={confirmClear} onClose={() => !clearing && setConfirmClear(false)}>
        <DialogTitle>{t('settingsDecisionModel.clearConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('settingsDecisionModel.clearConfirmBody')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClear(false)} disabled={clearing}>
            {t('common.cancel')}
          </Button>
          <Button
            color="warning"
            variant="contained"
            onClick={handleClear}
            disabled={clearing}
            startIcon={clearing ? <CircularProgress size={16} /> : undefined}
          >
            {t('settingsDecisionModel.clearVerdicts')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
