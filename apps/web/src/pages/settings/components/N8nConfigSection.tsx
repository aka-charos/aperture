import { useState, useEffect, useCallback } from 'react'
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
  Divider,
} from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import SaveIcon from '@mui/icons-material/Save'
import WebhookIcon from '@mui/icons-material/Webhook'
import SearchIcon from '@mui/icons-material/Search'
import FilterAltIcon from '@mui/icons-material/FilterAlt'

interface WebhookFormState {
  enabled: boolean
  webhookUrl: string
  authHeaderName: string
  authHeaderValue: string
  timeoutMs: string
}

interface WebhookApiConfig {
  enabled: boolean
  webhookUrl: string
  authHeaderName?: string
  authHeaderValue?: string
  timeoutMs?: number
}

const EMPTY_FORM: WebhookFormState = {
  enabled: false,
  webhookUrl: '',
  authHeaderName: '',
  authHeaderValue: '',
  timeoutMs: '',
}

function toForm(config: WebhookApiConfig | null): WebhookFormState {
  if (!config) return EMPTY_FORM
  return {
    enabled: config.enabled,
    webhookUrl: config.webhookUrl || '',
    authHeaderName: config.authHeaderName || '',
    authHeaderValue: config.authHeaderValue || '',
    timeoutMs: config.timeoutMs ? String(config.timeoutMs) : '',
  }
}

function toApi(form: WebhookFormState): WebhookApiConfig | null {
  if (!form.webhookUrl && !form.enabled) return null
  const timeout = parseInt(form.timeoutMs, 10)
  return {
    enabled: form.enabled,
    webhookUrl: form.webhookUrl.trim(),
    ...(form.authHeaderName.trim() && { authHeaderName: form.authHeaderName.trim() }),
    ...(form.authHeaderValue && { authHeaderValue: form.authHeaderValue }),
    ...(Number.isFinite(timeout) && timeout > 0 && { timeoutMs: timeout }),
  }
}

interface WebhookBlockProps {
  icon: React.ReactNode
  title: string
  caption: string
  form: WebhookFormState
  onChange: (form: WebhookFormState) => void
  onTest: () => void
  testing: boolean
}

function WebhookBlock({ icon, title, caption, form, onChange, onTest, testing }: WebhookBlockProps) {
  const [showAuthValue, setShowAuthValue] = useState(false)

  return (
    <Box>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
        <Box display="flex" alignItems="center" gap={1}>
          {icon}
          <Box>
            <Typography variant="subtitle2" fontWeight={600}>
              {title}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {caption}
            </Typography>
          </Box>
        </Box>
        <Switch
          size="small"
          checked={form.enabled}
          onChange={(e) => onChange({ ...form, enabled: e.target.checked })}
        />
      </Box>

      <Box display="flex" flexDirection="column" gap={1.5}>
        <TextField
          label="Webhook URL"
          value={form.webhookUrl}
          onChange={(e) => onChange({ ...form, webhookUrl: e.target.value })}
          size="small"
          fullWidth
          placeholder="https://n8n.example.com/webhook/..."
        />
        <Box display="flex" gap={1.5}>
          <TextField
            label="Auth header name"
            value={form.authHeaderName}
            onChange={(e) => onChange({ ...form, authHeaderName: e.target.value })}
            size="small"
            fullWidth
            placeholder="X-N8N-Auth"
          />
          <TextField
            label="Auth header value"
            type={showAuthValue ? 'text' : 'password'}
            value={form.authHeaderValue}
            onChange={(e) => onChange({ ...form, authHeaderValue: e.target.value })}
            size="small"
            fullWidth
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShowAuthValue(!showAuthValue)} edge="end" size="small">
                    {showAuthValue ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
        </Box>
        <Box display="flex" gap={1.5} alignItems="center">
          <TextField
            label="Timeout (ms)"
            value={form.timeoutMs}
            onChange={(e) => onChange({ ...form, timeoutMs: e.target.value.replace(/\D/g, '') })}
            size="small"
            sx={{ width: 140 }}
            placeholder="15000"
          />
          <Button variant="outlined" size="small" onClick={onTest} disabled={testing || !form.webhookUrl}>
            {testing ? <CircularProgress size={16} /> : 'Test'}
          </Button>
        </Box>
      </Box>
    </Box>
  )
}

export function N8nConfigSection() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<'searchTool' | 'preProcess' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  const [searchForm, setSearchForm] = useState<WebhookFormState>(EMPTY_FORM)
  const [preProcessForm, setPreProcessForm] = useState<WebhookFormState>(EMPTY_FORM)

  const isConfigured = searchForm.enabled || preProcessForm.enabled

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/n8n', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setSearchForm(toForm(data.config?.searchTool ?? null))
        setPreProcessForm(toForm(data.config?.preProcess ?? null))
        setHasChanges(false)
      }
    } catch {
      setError('Failed to load n8n configuration')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/settings/n8n', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          searchTool: toApi(searchForm),
          preProcess: toApi(preProcessForm),
        }),
      })
      if (res.ok) {
        setSuccess('n8n configuration saved')
        setHasChanges(false)
        setTimeout(() => setSuccess(null), 3000)
      } else {
        const err = await res.json()
        setError(err.error || 'Failed to save n8n configuration')
      }
    } catch {
      setError('Failed to save n8n configuration')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (target: 'searchTool' | 'preProcess', form: WebhookFormState) => {
    setTesting(target)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/settings/n8n/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ target, config: toApi(form) }),
      })
      const result = await res.json()
      if (result.success) {
        setSuccess('Webhook responded successfully')
        setTimeout(() => setSuccess(null), 3000)
      } else {
        setError(result.error || 'Webhook test failed')
      }
    } catch {
      setError('Webhook test failed')
    } finally {
      setTesting(null)
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

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <WebhookIcon sx={{ fontSize: 28, color: '#ea4b71' }} />
          <Typography variant="h6" fontWeight={600}>
            n8n Automation
          </Typography>
          {isConfigured && (
            <Chip icon={<CheckCircleIcon />} label="Active" color="success" size="small" />
          )}
        </Box>

        <Typography variant="body2" color="text.secondary" mb={3}>
          Connect{' '}
          <Link href="https://n8n.io" target="_blank" rel="noopener">
            n8n
          </Link>{' '}
          workflows to the AI assistant: a web search tool the model can call on demand, and an
          optional hook that lets a workflow enrich every chat request before the model sees it.
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

        <Box display="flex" flexDirection="column" gap={2.5}>
          <WebhookBlock
            icon={<SearchIcon fontSize="small" color="primary" />}
            title="Web search tool"
            caption="Model calls this when it needs live web data. Receives { type: 'search', query }."
            form={searchForm}
            onChange={(f) => {
              setSearchForm(f)
              setHasChanges(true)
            }}
            onTest={() => handleTest('searchTool', searchForm)}
            testing={testing === 'searchTool'}
          />

          <Divider />

          <WebhookBlock
            icon={<FilterAltIcon fontSize="small" color="primary" />}
            title="Pre-processing hook"
            caption="Runs on every chat message. May return { messages, system } to modify the request."
            form={preProcessForm}
            onChange={(f) => {
              setPreProcessForm(f)
              setHasChanges(true)
            }}
            onTest={() => handleTest('preProcess', preProcessForm)}
            testing={testing === 'preProcess'}
          />

          <Box display="flex" gap={1} mt={0.5}>
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={handleSave}
              disabled={saving || !hasChanges}
              size="small"
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}
