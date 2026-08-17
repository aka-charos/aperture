/**
 * Settings card for the self-hosted fastCRW retrieval service.
 *
 * This is the search-and-scrape half of title analysis: CRW runs a metasearch
 * through its bundled SearXNG and returns each result already scraped to clean
 * markdown, which the Title Analysis model then writes from. The writing model
 * is configured separately, on the AI page.
 *
 * The field most likely to be wrong is the base URL, because CRW ships its own
 * compose project and therefore usually sits on a different Docker network than
 * Aperture — so its service name will not resolve and the published host port is
 * what works. The helper text says so, and Test is a real one-result search
 * rather than a health ping, because the documented failure mode (bare
 * container, no search backend) passes a health check.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  InputAdornment,
  IconButton,
  Alert,
  Chip,
  CircularProgress,
  Link,
  Switch,
  FormControlLabel,
  Stack,
} from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import SaveIcon from '@mui/icons-material/Save'
import SyncIcon from '@mui/icons-material/Sync'

interface CrwPublicConfig {
  enabled: boolean
  baseUrl: string
  hasApiKey: boolean
  maxResults: number
  maxContentChars: number
  timeoutMs: number
  sourceBudgetChars: number
}

interface TestResult {
  success: boolean
  message: string
}

const clampInt = (raw: string, min: number, max: number, fallback: number) =>
  Math.min(max, Math.max(min, parseInt(raw || String(fallback), 10) || fallback))

export function CrwConfigSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<CrwPublicConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  const [enabled, setEnabled] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [maxResults, setMaxResults] = useState('6')
  const [sourceBudgetChars, setSourceBudgetChars] = useState('16000')
  const [maxContentChars, setMaxContentChars] = useState('12000')
  const [timeoutSeconds, setTimeoutSeconds] = useState('90')
  const [hasChanges, setHasChanges] = useState(false)

  // Sync every field from a server config — on load and after save, so a clamped
  // value shows the persisted number rather than what was typed.
  const applyConfig = useCallback((c: CrwPublicConfig) => {
    setConfig(c)
    setEnabled(!!c.enabled)
    setBaseUrl(c.baseUrl ?? '')
    setApiKey('')
    setMaxResults(String(c.maxResults ?? 6))
    setSourceBudgetChars(String(c.sourceBudgetChars ?? 16000))
    setMaxContentChars(String(c.maxContentChars ?? 12000))
    setTimeoutSeconds(String(Math.round((c.timeoutMs ?? 90000) / 1000)))
    setHasChanges(false)
  }, [])

  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/crw', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        applyConfig(data.config)
      }
    } catch {
      setError(t('settingsCrw.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t, applyConfig])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const markChanged = () => setHasChanges(true)

  const buildPayload = () => ({
    enabled,
    baseUrl: baseUrl.trim(),
    // Omitted rather than blank when untouched: the server reads an explicit
    // empty string as "clear the key", which is the only way to remove one.
    ...(apiKey ? { apiKey } : {}),
    maxResults: clampInt(maxResults, 1, 20, 6),
    sourceBudgetChars: clampInt(sourceBudgetChars, 2000, 200000, 16000),
    maxContentChars: clampInt(maxContentChars, 1000, 100000, 12000),
    timeoutMs: clampInt(timeoutSeconds, 5, 300, 90) * 1000,
  })

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    setTestResult(null)
    try {
      const response = await fetch('/api/settings/crw', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(buildPayload()),
      })
      if (response.ok) {
        const data = await response.json()
        applyConfig(data.config)
        setSuccess(t('settingsCrw.saved'))
        setTimeout(() => setSuccess(null), 3000)
      } else {
        const err = await response.json().catch(() => ({}))
        setError(err.error || t('settingsCrw.errSave'))
      }
    } catch {
      setError(t('settingsCrw.errConnect'))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      const response = await fetch('/api/settings/crw/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ baseUrl: baseUrl.trim() || undefined, apiKey: apiKey || undefined }),
      })
      const result = await response.json().catch(() => ({}))
      if (result.success) {
        setTestResult({
          success: true,
          message: t('settingsCrw.testSuccess', { count: result.resultCount ?? 0 }),
        })
      } else {
        setTestResult({ success: false, message: result.error || t('settingsCrw.testFailed') })
      }
    } catch {
      setTestResult({ success: false, message: t('settingsCrw.errConnect') })
    } finally {
      setTesting(false)
    }
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

  const configured = !!config?.baseUrl

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <Box
            sx={{
              width: 28,
              height: 28,
              borderRadius: 1,
              bgcolor: '#7c4dff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 700,
              fontSize: '0.85rem',
            }}
          >
            C
          </Box>
          <Typography variant="h6" fontWeight={600}>
            {t('settingsCrw.title')}
          </Typography>
          {configured && enabled && (
            <Chip
              icon={<CheckCircleIcon />}
              label={t('settingsCrw.chipEnabled')}
              color="success"
              size="small"
            />
          )}
          {configured && !enabled && (
            <Chip label={t('settingsCrw.chipDisabled')} color="warning" size="small" />
          )}
        </Box>

        <Typography variant="body2" color="text.secondary" mb={3}>
          {t('settingsCrw.description')}{' '}
          <Link href="https://github.com/us/crw" target="_blank" rel="noopener">
            {t('settingsCrw.learnMoreLink')}
          </Link>
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
        {testResult && (
          <Alert severity={testResult.success ? 'success' : 'error'} sx={{ mb: 2 }}>
            {testResult.message}
          </Alert>
        )}

        <Stack spacing={2}>
          <FormControlLabel
            control={
              <Switch
                checked={enabled}
                onChange={(e) => {
                  setEnabled(e.target.checked)
                  markChanged()
                }}
              />
            }
            label={t('settingsCrw.enabledLabel')}
          />

          <TextField
            fullWidth
            label={t('settingsCrw.baseUrlLabel')}
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value)
              markChanged()
            }}
            placeholder="http://host.docker.internal:3000"
            helperText={t('settingsCrw.baseUrlHelp')}
          />

          <TextField
            fullWidth
            label={t('settingsCrw.apiKeyLabel')}
            type={showApiKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              markChanged()
            }}
            placeholder={config?.hasApiKey ? '••••••••' : ''}
            helperText={t('settingsCrw.apiKeyHelp')}
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

          <Box display="flex" gap={2} flexWrap="wrap">
            <TextField
              label={t('settingsCrw.maxResultsLabel')}
              type="number"
              value={maxResults}
              onChange={(e) => {
                setMaxResults(e.target.value)
                markChanged()
              }}
              helperText={t('settingsCrw.maxResultsHelp')}
              sx={{ flex: '1 1 160px' }}
            />
            <TextField
              label={t('settingsCrw.timeoutLabel')}
              type="number"
              value={timeoutSeconds}
              onChange={(e) => {
                setTimeoutSeconds(e.target.value)
                markChanged()
              }}
              helperText={t('settingsCrw.timeoutHelp')}
              sx={{ flex: '1 1 160px' }}
            />
          </Box>

          <TextField
            fullWidth
            label={t('settingsCrw.sourceBudgetLabel')}
            type="number"
            value={sourceBudgetChars}
            onChange={(e) => {
              setSourceBudgetChars(e.target.value)
              markChanged()
            }}
            helperText={t('settingsCrw.sourceBudgetHelp')}
          />

          <TextField
            fullWidth
            label={t('settingsCrw.maxContentLabel')}
            type="number"
            value={maxContentChars}
            onChange={(e) => {
              setMaxContentChars(e.target.value)
              markChanged()
            }}
            helperText={t('settingsCrw.maxContentHelp')}
          />

          <Box display="flex" gap={2}>
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {t('settingsCrw.save')}
            </Button>
            <Button
              variant="outlined"
              startIcon={testing ? <CircularProgress size={16} /> : <SyncIcon />}
              onClick={handleTest}
              disabled={testing || !baseUrl.trim()}
            >
              {t('settingsCrw.test')}
            </Button>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  )
}
