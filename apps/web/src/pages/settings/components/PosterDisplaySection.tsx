import React, { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Switch,
  FormControlLabel,
  Button,
  Alert,
  Divider,
  CircularProgress,
  Stack,
} from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import StarBorderIcon from '@mui/icons-material/StarBorder'

interface PosterDisplayConfig {
  hideRatingBadgeByDefault: boolean
}

/**
 * Admin: instance-wide default for the community-rating badge on library
 * posters. Individual users may override this in their own settings.
 */
export function PosterDisplaySection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<PosterDisplayConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/settings/poster-display', { credentials: 'include' })
      if (!response.ok) throw new Error(t('settingsPosterDisplay.fetchFailed'))
      const data = (await response.json()) as PosterDisplayConfig
      setConfig(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settingsPosterDisplay.unknownError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void fetchConfig()
  }, [fetchConfig])

  const handleSave = async () => {
    if (!config) return
    try {
      setSaving(true)
      setError(null)
      const response = await fetch('/api/settings/poster-display', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ hideRatingBadgeByDefault: config.hideRatingBadgeByDefault }),
      })
      if (!response.ok) throw new Error(t('settingsPosterDisplay.saveFailed'))
      setSuccess(t('settingsPosterDisplay.saved'))
      setHasChanges(false)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settingsPosterDisplay.unknownError'))
    } finally {
      setSaving(false)
    }
  }

  const updateConfig = (updates: Partial<PosterDisplayConfig>) => {
    if (!config) return
    setConfig({ ...config, ...updates })
    setHasChanges(true)
  }

  if (loading) {
    return (
      <Card sx={{ backgroundColor: 'background.paper', borderRadius: 2 }}>
        <CardContent>
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress />
          </Box>
        </CardContent>
      </Card>
    )
  }

  if (!config) {
    return (
      <Card sx={{ backgroundColor: 'background.paper', borderRadius: 2 }}>
        <CardContent>
          <Alert severity="error">{t('settingsPosterDisplay.loadFailed')}</Alert>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card sx={{ backgroundColor: 'background.paper', borderRadius: 2 }}>
      <CardContent>
        <Box mb={2}>
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <StarBorderIcon color="primary" /> {t('settingsPosterDisplay.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('settingsPosterDisplay.subtitle')}
          </Typography>
        </Box>

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

        <Divider sx={{ my: 2 }} />

        <Box sx={{ mb: 3 }}>
          <FormControlLabel
            control={
              <Switch
                checked={!config.hideRatingBadgeByDefault}
                onChange={(e) => updateConfig({ hideRatingBadgeByDefault: !e.target.checked })}
                color="primary"
              />
            }
            label={
              <Box>
                <Typography variant="body1" fontWeight="medium">
                  {t('settingsPosterDisplay.showLabel')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('settingsPosterDisplay.showCaption')}
                </Typography>
              </Box>
            }
          />
        </Box>

        <Divider sx={{ my: 2 }} />

        <Stack direction="row" spacing={2} justifyContent="flex-end">
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
            onClick={handleSave}
            disabled={saving || !hasChanges}
          >
            {saving ? t('settingsPosterDisplay.saving') : t('settingsPosterDisplay.saveChanges')}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  )
}
