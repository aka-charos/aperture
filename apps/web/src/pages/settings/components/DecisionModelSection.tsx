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
 * The lower half reads back what the stored verdicts did: how often they agreed
 * with the similarity bar, and examples of where they did not. Disagreements
 * are the only place the feature can earn its keep, so they are what an
 * operator needs to read to decide whether to leave it on.
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
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
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
import RefreshIcon from '@mui/icons-material/Refresh'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { jobConsoleLink } from '@/pages/jobs/registry'

type Source = 'openrouter' | 'custom'

interface PublicConfig {
  enabled: boolean
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

interface Disagreement {
  mediaType: string
  pickTitle: string
  evidenceTitle: string
  similarity: number | null
  judgedConnection: number | null
  judgeSupports: boolean
  cosineSupports: boolean
}

interface Stats {
  runs: number
  picks: number
  judgedPicks: number
  agree: number
  judgeOnly: number
  cosineOnly: number
  examples: Disagreement[]
}

const REFRESH_JOB = 'refresh-recommendation-explanations'

const clampInt = (raw: string, min: number, max: number, fallback: number) =>
  Math.min(max, Math.max(min, parseInt(raw || String(fallback), 10) || fallback))

const percent = (p: number) => Math.round(p * 100)

export function DecisionModelSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  const [enabled, setEnabled] = useState(false)
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

  const applyConfig = useCallback((c: PublicConfig) => {
    setConfig(c)
    setEnabled(!!c.enabled)
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

  // The OpenRouter list is public and cheap, so it loads with the card. A
  // self-hosted server is asked only when someone presses Refresh, since its
  // URL may be half-typed.
  useEffect(() => {
    if (config && source === 'openrouter') fetchCatalog('openrouter', '')
  }, [config, source, fetchCatalog])

  const markChanged = useCallback(() => setHasChanges(true), [])

  const buildPayload = () => ({
    enabled,
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
          </Box>

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
                <Typography variant="body2" mb={1.5}>
                  {t('settingsDecisionModel.statsSummary', {
                    judged: stats.judgedPicks,
                    picks: stats.picks,
                    agree: stats.agree,
                    judgeOnly: stats.judgeOnly,
                    cosineOnly: stats.cosineOnly,
                  })}
                </Typography>
                {stats.examples.length > 0 && (
                  <Box sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('settingsDecisionModel.columnPick')}</TableCell>
                          <TableCell>{t('settingsDecisionModel.columnEvidence')}</TableCell>
                          <TableCell align="right">{t('settingsDecisionModel.columnSimilarity')}</TableCell>
                          <TableCell align="right">{t('settingsDecisionModel.columnVerdict')}</TableCell>
                          <TableCell>{t('settingsDecisionModel.columnDirection')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {stats.examples.map((example, index) => (
                          <TableRow key={`${example.pickTitle}-${index}`}>
                            <TableCell>{example.pickTitle}</TableCell>
                            <TableCell>{example.evidenceTitle}</TableCell>
                            <TableCell align="right">
                              {example.similarity != null ? example.similarity.toFixed(3) : '—'}
                            </TableCell>
                            <TableCell align="right">
                              {example.judgedConnection != null ? `${percent(example.judgedConnection)}%` : '—'}
                            </TableCell>
                            <TableCell>
                              {example.judgeSupports
                                ? t('settingsDecisionModel.directionJudge')
                                : t('settingsDecisionModel.directionCosine')}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                )}
              </>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  )
}
