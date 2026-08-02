import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Alert,
  Divider,
  CircularProgress,
  Stack,
} from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined'
import { DEFAULT_APP_NAME, setAppName as applyAppName, useAppName } from '@/lib/branding'

/** Matches APP_NAME_MAX_LENGTH in core; the server trims to the same figure. */
const MAX_LENGTH = 40

/**
 * Admin: what this instance calls itself.
 *
 * The saved name is applied to the running page immediately rather than after a
 * reload — the whole point of the field is to see the result, and every string
 * that mentions the product interpolates it.
 */
export function BrandingSection() {
  const { t } = useTranslation()
  const currentName = useAppName()
  const [value, setValue] = useState(currentName)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/branding', { credentials: 'include' })
      if (!response.ok) throw new Error(t('settingsBranding.fetchFailed'))
      const data = (await response.json()) as { appName?: string }
      setValue(data.appName ?? DEFAULT_APP_NAME)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settingsBranding.unknownError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void fetchConfig()
  }, [fetchConfig])

  const save = async (name: string) => {
    try {
      setSaving(true)
      setError(null)
      const response = await fetch('/api/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ appName: name }),
      })
      if (!response.ok) throw new Error(t('settingsBranding.saveFailed'))
      const data = (await response.json()) as { appName?: string }
      const saved = data.appName ?? DEFAULT_APP_NAME
      // The server is the authority on what was stored — it trims and collapses
      // whitespace, so echo its answer back into the field rather than what was
      // typed.
      setValue(saved)
      applyAppName(saved)
      setSuccess(t('settingsBranding.saved'))
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settingsBranding.unknownError'))
    } finally {
      setSaving(false)
    }
  }

  const trimmed = value.trim()
  const hasChanges = trimmed !== currentName
  const isDefault = currentName === DEFAULT_APP_NAME

  return (
    <Card sx={{ backgroundColor: 'background.paper', borderRadius: 2 }} elevation={0}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <BadgeOutlinedIcon sx={{ color: 'primary.main' }} />
          <Typography variant="h6" fontWeight={600}>
            {t('settingsBranding.title')}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {t('settingsBranding.subtitle')}
        </Typography>

        <Divider sx={{ my: 2 }} />

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

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <Stack spacing={2}>
            <TextField
              label={t('settingsBranding.label')}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && hasChanges && trimmed) void save(trimmed)
              }}
              size="small"
              fullWidth
              inputProps={{ maxLength: MAX_LENGTH }}
              helperText={t('settingsBranding.helper', { max: MAX_LENGTH })}
              sx={{ maxWidth: 420 }}
            />

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                size="small"
                startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
                onClick={() => void save(trimmed)}
                disabled={saving || !hasChanges || !trimmed}
              >
                {t('common.save')}
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<RestartAltIcon />}
                onClick={() => void save(DEFAULT_APP_NAME)}
                disabled={saving || isDefault}
              >
                {t('settingsBranding.reset', { name: DEFAULT_APP_NAME })}
              </Button>
            </Box>
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}
