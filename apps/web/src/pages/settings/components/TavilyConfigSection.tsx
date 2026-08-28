import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  MenuItem,
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

type SearchDepth = 'basic' | 'advanced'
type Topic = 'general' | 'news'
type TimeRange = '' | 'day' | 'week' | 'month' | 'year'

interface TavilyPublicConfig {
  enabled: boolean
  hasApiKey: boolean
  maxResults: number
  searchDepth: SearchDepth
  includeAnswer: boolean
  topic: Topic
  timeRange: TimeRange | null
  maxContentChars: number
}

interface TestResult {
  success: boolean
  message: string
}

export function TavilyConfigSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<TavilyPublicConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  // Form state
  const [enabled, setEnabled] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [maxResults, setMaxResults] = useState('5')
  const [maxContentChars, setMaxContentChars] = useState('1000')
  const [searchDepth, setSearchDepth] = useState<SearchDepth>('basic')
  const [topic, setTopic] = useState<Topic>('general')
  const [timeRange, setTimeRange] = useState<TimeRange>('')
  const [includeAnswer, setIncludeAnswer] = useState(true)
  const [hasChanges, setHasChanges] = useState(false)

  // Sync all form fields from a server config — used on load and after save, so a
  // clamped value shows the persisted number rather than what was typed.
  const applyConfig = useCallback((c: TavilyPublicConfig) => {
    setConfig(c)
    setEnabled(!!c.enabled)
    setApiKey('')
    setMaxResults(String(c.maxResults ?? 5))
    setMaxContentChars(String(c.maxContentChars ?? 1000))
    setSearchDepth(c.searchDepth ?? 'basic')
    setTopic(c.topic ?? 'general')
    setTimeRange((c.timeRange ?? '') as TimeRange)
    setIncludeAnswer(c.includeAnswer ?? true)
    setHasChanges(false)
  }, [])

  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/tavily', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        applyConfig(data.config)
      }
    } catch {
      setError(t('settingsTavily.loadError'))
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
    apiKey: apiKey || undefined,
    maxResults: Math.min(20, Math.max(1, parseInt(maxResults || '5', 10) || 5)),
    maxContentChars: Math.min(8000, Math.max(100, parseInt(maxContentChars || '1000', 10) || 1000)),
    searchDepth,
    topic,
    timeRange,
    includeAnswer,
  })

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    setTestResult(null)
    try {
      const response = await fetch('/api/settings/tavily', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(buildPayload()),
      })
      if (response.ok) {
        const data = await response.json()
        applyConfig(data.config)
        setSuccess(t('settingsTavily.saved'))
        setTimeout(() => setSuccess(null), 3000)
      } else {
        const err = await response.json().catch(() => ({}))
        setError(err.error || t('settingsTavily.errSave'))
      }
    } catch {
      setError(t('settingsTavily.errConnect'))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      const response = await fetch('/api/settings/tavily/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ apiKey: apiKey || undefined }),
      })
      const result = await response.json().catch(() => ({}))
      if (result.success) {
        setTestResult({
          success: true,
          message: t('settingsTavily.testSuccess', { count: result.resultCount ?? 0 }),
        })
      } else {
        setTestResult({ success: false, message: result.error || t('settingsTavily.testFailed') })
      }
    } catch {
      setTestResult({ success: false, message: t('settingsTavily.errConnect') })
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

  const configured = !!config?.hasApiKey

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <Box
            sx={{
              width: 28,
              height: 28,
              borderRadius: 1,
              bgcolor: '#14b8a6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 700,
              fontSize: '0.85rem',
            }}
          >
            T
          </Box>
          <Typography variant="h6" fontWeight={600}>
            {t('settingsTavily.title')}
          </Typography>
          {configured && enabled && (
            <Chip
              icon={<CheckCircleIcon />}
              label={t('settingsTavily.chipEnabled')}
              color="success"
              size="small"
            />
          )}
          {configured && !enabled && (
            <Chip label={t('settingsTavily.chipDisabled')} color="warning" size="small" />
          )}
        </Box>

        <Typography variant="body2" color="text.secondary" mb={3}>
          {t('settingsTavily.description')}{' '}
          <Link href="https://app.tavily.com/" target="_blank" rel="noopener">
            {t('settingsTavily.learnMoreLink')}
          </Link>
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}
        {testResult && (
          <Alert
            severity={testResult.success ? 'success' : 'error'}
            sx={{ mb: 2 }}
            onClose={() => setTestResult(null)}
          >
            {testResult.message}
          </Alert>
        )}

        <Box display="flex" flexDirection="column" gap={2}>
          <TextField
            id="tavily-api-key"
            autoComplete="off"
            label={t('settingsTavily.apiKey')}
            type={showApiKey ? 'text' : 'password'}
            value={apiKey || (config?.hasApiKey ? '••••••••••••••••••••••••••••' : '')}
            onChange={(e) => {
              setApiKey(e.target.value.replace(/•/g, ''))
              markChanged()
            }}
            size="small"
            fullWidth
            placeholder={t('settingsTavily.apiKeyPlaceholder')}
            helperText={
              config?.hasApiKey && !apiKey
                ? t('settingsTavily.helperSaved')
                : t('settingsTavily.helperNewKey')
            }
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShowApiKey(!showApiKey)} edge="end" size="small">
                    {showApiKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              id="tavily-max-results"
              label={t('settingsTavily.maxResults')}
              type="number"
              value={maxResults}
              onChange={(e) => {
                setMaxResults(e.target.value)
                markChanged()
              }}
              size="small"
              fullWidth
              inputProps={{ min: 1, max: 20 }}
              helperText={t('settingsTavily.maxResultsHelper')}
            />
            <TextField
              id="tavily-max-content"
              label={t('settingsTavily.maxContentChars')}
              type="number"
              value={maxContentChars}
              onChange={(e) => {
                setMaxContentChars(e.target.value)
                markChanged()
              }}
              size="small"
              fullWidth
              inputProps={{ min: 100, max: 8000, step: 100 }}
              helperText={t('settingsTavily.maxContentCharsHelper')}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              id="tavily-search-depth"
              select
              label={t('settingsTavily.searchDepth')}
              value={searchDepth}
              onChange={(e) => {
                setSearchDepth(e.target.value as SearchDepth)
                markChanged()
              }}
              size="small"
              fullWidth
            >
              <MenuItem value="basic">{t('settingsTavily.searchDepthBasic')}</MenuItem>
              <MenuItem value="advanced">{t('settingsTavily.searchDepthAdvanced')}</MenuItem>
            </TextField>
            <TextField
              select
              label={t('settingsTavily.topic')}
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value as Topic)
                markChanged()
              }}
              size="small"
              fullWidth
            >
              <MenuItem value="general">{t('settingsTavily.topicGeneral')}</MenuItem>
              <MenuItem value="news">{t('settingsTavily.topicNews')}</MenuItem>
            </TextField>
          </Stack>

          <TextField
            select
            label={t('settingsTavily.timeRange')}
            value={timeRange}
            onChange={(e) => {
              setTimeRange(e.target.value as TimeRange)
              markChanged()
            }}
            size="small"
            fullWidth
          >
            <MenuItem value="">{t('settingsTavily.timeRangeNone')}</MenuItem>
            <MenuItem value="day">{t('settingsTavily.timeRangeDay')}</MenuItem>
            <MenuItem value="week">{t('settingsTavily.timeRangeWeek')}</MenuItem>
            <MenuItem value="month">{t('settingsTavily.timeRangeMonth')}</MenuItem>
            <MenuItem value="year">{t('settingsTavily.timeRangeYear')}</MenuItem>
          </TextField>

          <FormControlLabel
            control={
              <Switch
                checked={includeAnswer}
                onChange={(e) => {
                  setIncludeAnswer(e.target.checked)
                  markChanged()
                }}
              />
            }
            label={<Typography variant="body2">{t('settingsTavily.includeAnswer')}</Typography>}
          />

          <FormControlLabel
            control={
              <Switch
                checked={enabled}
                onChange={(e) => {
                  setEnabled(e.target.checked)
                  markChanged()
                }}
                disabled={!configured && !apiKey}
              />
            }
            label={<Typography variant="body2">{t('settingsTavily.enable')}</Typography>}
          />

          <Stack direction="row" spacing={1} mt={1}>
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={handleSave}
              disabled={saving || !hasChanges}
              size="small"
            >
              {saving ? t('common.saving') : t('settingsTavily.saveConfiguration')}
            </Button>
            <Button
              variant="outlined"
              startIcon={testing ? <CircularProgress size={16} /> : <SyncIcon />}
              onClick={handleTest}
              disabled={testing || (!apiKey && !config?.hasApiKey)}
              size="small"
            >
              {testing ? t('settingsTavily.testing') : t('settingsTavily.testConnection')}
            </Button>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  )
}
