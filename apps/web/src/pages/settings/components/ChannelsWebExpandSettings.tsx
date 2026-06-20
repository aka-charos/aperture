import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
} from '@mui/material'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'
import SaveIcon from '@mui/icons-material/Save'

/**
 * Admin toggle: whether the scheduled channel/collection auto-refresh job also runs Web Search
 * expansion. Manual "Generate" always expands when the Web Search role is configured.
 */
export function ChannelsWebExpandSettings() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [initialEnabled, setInitialEnabled] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/channels-web-expand', { credentials: 'include' })
      if (!res.ok) {
        setError(t('settingsChannelsWebExpand.loadError'))
        return
      }
      const data = (await res.json()) as { webExpandOnSchedule?: boolean }
      const on = data.webExpandOnSchedule === true
      setEnabled(on)
      setInitialEnabled(on)
    } catch {
      setError(t('settingsChannelsWebExpand.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/settings/channels-web-expand', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ webExpandOnSchedule: enabled }),
      })
      if (!res.ok) {
        setError(t('settingsChannelsWebExpand.saveError'))
        return
      }
      const data = (await res.json()) as { webExpandOnSchedule?: boolean }
      setSuccess(t('settingsChannelsWebExpand.saved'))
      if (data.webExpandOnSchedule !== undefined) {
        setEnabled(data.webExpandOnSchedule === true)
        setInitialEnabled(data.webExpandOnSchedule === true)
      }
    } catch {
      setError(t('settingsChannelsWebExpand.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const dirty = enabled !== initialEnabled

  if (loading) {
    return (
      <Card>
        <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={28} />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <TravelExploreIcon color="primary" />
          <Typography variant="h6">{t('settingsChannelsWebExpand.title')}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('settingsChannelsWebExpand.description')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}

        <FormControlLabel
          control={<Switch checked={enabled} onChange={(_, v) => setEnabled(v)} />}
          label={t('settingsChannelsWebExpand.enable')}
        />

        <Box>
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
            disabled={saving || !dirty}
            onClick={() => void handleSave()}
            sx={{ mt: 1 }}
          >
            {t('settingsChannelsWebExpand.save')}
          </Button>
        </Box>
      </CardContent>
    </Card>
  )
}
