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
 * with the value and are stated and offered as the field's range, but whether a
 * value is accepted is the API's decision alone (core `summarySize.ts`): the
 * card sends what was typed and reports a refusal.
 */
export function NextFromHereSettingsSection() {
  const { t } = useTranslation()
  const [setting, setSetting] = useState<SummarySize | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
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

  const dirty = setting != null && draft.trim() !== '' && draft.trim() !== String(setting.value)

  const save = async () => {
    if (!dirty) return
    setSaving(true)
    setError(null)
    setRefused(false)
    setSuccess(false)
    try {
      const res = await fetch('/api/settings/next-from-here', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // Sent as typed: a value that is not a whole number in range is the
        // API's to refuse, so the two can never disagree about what is allowed.
        body: JSON.stringify({ summarySize: Number(draft) }),
      })
      if (res.status === 400) {
        setRefused(true)
        return
      }
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
                setRefused(false)
              }}
              error={refused}
              helperText={t(refused ? 'settingsNextFromHere.refused' : 'settingsNextFromHere.sizeHelp', {
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
