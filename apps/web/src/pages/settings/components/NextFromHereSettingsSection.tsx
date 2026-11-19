import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  TextField,
  Typography,
} from '@mui/material'
import SkipNextOutlinedIcon from '@mui/icons-material/SkipNextOutlined'
import SaveIcon from '@mui/icons-material/Save'

/** The setting with its limits, all decided by the API (core `nextFromHere/summarySize.ts`). */
interface SummarySize {
  value: number
  default: number
  min: number
  max: number
}

/**
 * How many suggestions Next from here shows on a title's page. The limits come
 * with the value, so the console states and checks exactly what the API
 * accepts; the API still refuses anything else.
 */
export function NextFromHereSettingsSection() {
  const { t } = useTranslation()
  const [setting, setSetting] = useState<SummarySize | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const apply = (data: SummarySize) => {
    setSetting(data)
    setDraft(String(data.value))
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/next-from-here', { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      apply((await res.json()) as SummarySize)
    } catch {
      setError(t('settingsNextFromHere.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const parsed = Number(draft)
  const valid =
    setting != null && draft.trim() !== '' && Number.isInteger(parsed) && parsed >= setting.min && parsed <= setting.max
  const dirty = setting != null && valid && parsed !== setting.value

  const save = async () => {
    if (!valid) return
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch('/api/settings/next-from-here', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ summarySize: parsed }),
      })
      if (!res.ok) throw new Error(String(res.status))
      apply((await res.json()) as SummarySize)
      setSuccess(true)
    } catch {
      setError(t('settingsNextFromHere.saveError'))
    } finally {
      setSaving(false)
    }
  }

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
          <SkipNextOutlinedIcon color="primary" />
          <Typography variant="h6">{t('settingsNextFromHere.title')}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('settingsNextFromHere.description')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(false)}>
            {t('settingsNextFromHere.saved')}
          </Alert>
        )}

        {setting && (
          <>
            <TextField
              id="next-summary-size"
              type="number"
              label={t('settingsNextFromHere.sizeLabel')}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                setSuccess(false)
              }}
              error={draft.trim() !== '' && !valid}
              helperText={t('settingsNextFromHere.sizeHelp', {
                min: setting.min,
                max: setting.max,
                default: setting.default,
              })}
              inputProps={{ min: setting.min, max: setting.max, step: 1, inputMode: 'numeric' }}
              sx={{ maxWidth: 360 }}
              fullWidth
            />
            <Box>
              <Button
                variant="contained"
                startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
                disabled={saving || !dirty}
                onClick={() => void save()}
                sx={{ mt: 2 }}
              >
                {t('settingsNextFromHere.save')}
              </Button>
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  )
}
