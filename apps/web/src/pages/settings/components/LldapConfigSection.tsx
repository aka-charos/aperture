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
  Switch,
  FormControlLabel,
} from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import SaveIcon from '@mui/icons-material/Save'
import PersonSearchIcon from '@mui/icons-material/PersonSearch'

interface LldapConfig {
  url: string | null
  adminUsername: string | null
  hasAdminPassword: boolean
  enabled: boolean
}

export function LldapConfigSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<LldapConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Form state
  const [url, setUrl] = useState('')
  const [adminUsername, setAdminUsername] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/lldap', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        setConfig(data)
        setUrl(data.url || '')
        setAdminUsername(data.adminUsername || '')
        setEnabled(data.enabled)
        setAdminPassword('')
        setHasChanges(false)
      }
    } catch {
      setError(t('settingsLldap.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/settings/lldap', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          url,
          adminUsername,
          adminPassword: adminPassword || undefined,
          enabled,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setSuccess(t('settingsLldap.saved'))
        setConfig({
          url: data.url,
          adminUsername: data.adminUsername,
          hasAdminPassword: data.hasAdminPassword,
          enabled: data.enabled,
        })
        setAdminPassword('')
        setHasChanges(false)
        setTimeout(() => setSuccess(null), 3000)
      } else {
        const err = await response.json()
        setError(err.error || t('settingsLldap.errSave'))
      }
    } catch {
      setError(t('settingsLldap.errConnect'))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/settings/lldap/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          url: url || undefined,
          adminUsername: adminUsername || undefined,
          adminPassword: adminPassword || undefined,
        }),
      })

      const result = await response.json()
      if (result.success) {
        setSuccess(t('settingsLldap.testSuccess', { count: result.userCount ?? 0 }))
        setTimeout(() => setSuccess(null), 5000)
      } else {
        setError(result.error || t('settingsLldap.testFailed'))
      }
    } catch {
      setError(t('settingsLldap.errConnect'))
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

  const isConfigured = !!config?.url && !!config?.adminUsername && !!config?.hasAdminPassword

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <PersonSearchIcon sx={{ fontSize: 28, color: 'primary.main' }} />
          <Typography variant="h6" fontWeight={600}>
            {t('settingsLldap.title')}
          </Typography>
          {isConfigured && (
            <Chip icon={<CheckCircleIcon />} label={t('settingsLldap.configured')} color="success" size="small" />
          )}
        </Box>

        <Typography variant="body2" color="text.secondary" mb={3}>
          {t('settingsLldap.description')}
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

        <Box display="flex" flexDirection="column" gap={2}>
          <TextField
            label={t('settingsLldap.serverUrl')}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setHasChanges(true)
            }}
            size="small"
            fullWidth
            placeholder={t('settingsLldap.serverUrlPlaceholder')}
          />

          <TextField
            label={t('settingsLldap.adminUsername')}
            value={adminUsername}
            onChange={(e) => {
              setAdminUsername(e.target.value)
              setHasChanges(true)
            }}
            size="small"
            fullWidth
            placeholder={t('settingsLldap.adminUsernamePlaceholder')}
            helperText={t('settingsLldap.adminUsernameHelper')}
          />

          <TextField
            label={t('settingsLldap.adminPassword')}
            type={showPassword ? 'text' : 'password'}
            value={adminPassword || (config?.hasAdminPassword ? '••••••••••••••••••••••••••••' : '')}
            onChange={(e) => {
              const newValue = e.target.value.replace(/•/g, '')
              setAdminPassword(newValue)
              setHasChanges(true)
            }}
            size="small"
            fullWidth
            helperText={config?.hasAdminPassword && !adminPassword ? t('settingsLldap.helperSaved') : undefined}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShowPassword(!showPassword)} edge="end" size="small">
                    {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />

          <FormControlLabel
            control={
              <Switch
                checked={enabled}
                onChange={(e) => {
                  setEnabled(e.target.checked)
                  setHasChanges(true)
                }}
                disabled={!isConfigured && !(url && adminUsername && adminPassword)}
              />
            }
            label={
              <Box>
                <Typography variant="body2">{t('settingsLldap.enableImport')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('settingsLldap.enableImportCaption')}
                </Typography>
              </Box>
            }
          />

          <Box display="flex" gap={1} mt={1}>
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={handleSave}
              disabled={saving || !hasChanges}
              size="small"
            >
              {saving ? t('common.saving') : t('common.save')}
            </Button>
            <Button
              variant="outlined"
              onClick={handleTest}
              disabled={testing || (!url && !isConfigured)}
              size="small"
            >
              {testing ? t('settingsLldap.testing') : t('settingsLldap.testConnection')}
            </Button>
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}
