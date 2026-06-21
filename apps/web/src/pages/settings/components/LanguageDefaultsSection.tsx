import React, { useEffect, useState, useCallback } from 'react'
import {
  Box,
  Typography,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  ListItemText,
  OutlinedInput,
  Button,
  Alert,
  CircularProgress,
  type SelectChangeEvent,
} from '@mui/material'
import LanguageIcon from '@mui/icons-material/Language'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n/config'
import { syncUiLanguageFromServer } from '@/i18n/syncUiLanguage'

type LocaleRow = { code: string; label: string }

export function LanguageDefaultsSection() {
  const { t } = useTranslation()
  const [locales, setLocales] = useState<LocaleRow[]>([])
  const [defaultUi, setDefaultUi] = useState('en')
  const [defaultAi, setDefaultAi] = useState('en')
  const [enabledUi, setEnabledUi] = useState<string[]>(['en'])
  const [enabledAi, setEnabledAi] = useState<string[]>(['en'])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const labelFor = useCallback(
    (code: string) => locales.find((l) => l.code === code)?.label ?? code,
    [locales]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [locRes, defRes] = await Promise.all([
        fetch('/api/settings/locales', { credentials: 'include' }),
        fetch('/api/settings/language-defaults', { credentials: 'include' }),
      ])
      if (locRes.ok) {
        const data = await locRes.json()
        setLocales(data.locales || [])
      }
      if (defRes.ok) {
        const data = await defRes.json()
        setDefaultUi(data.defaultUiLanguage || 'en')
        setDefaultAi(data.defaultAiLanguage || 'en')
        setEnabledUi(data.enabledUiLanguages?.length ? data.enabledUiLanguages : ['en'])
        setEnabledAi(data.enabledAiLanguages?.length ? data.enabledAiLanguages : ['en'])
      } else {
        const err = await defRes.json().catch(() => ({}))
        setError((err as { error?: string }).error || t('language.loadDefaultsFailed'))
      }
    } catch {
      setError(t('language.loadLanguageSettingsFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  // Preserve original locale order so chips/menus read consistently.
  const orderEnabled = useCallback(
    (codes: string[]) => locales.map((l) => l.code).filter((c) => codes.includes(c)),
    [locales]
  )

  const handleEnabledUiChange = (e: SelectChangeEvent<string[]>) => {
    const value = e.target.value
    const next = orderEnabled(typeof value === 'string' ? value.split(',') : value)
    if (next.length === 0) return // never allow an empty allowlist
    setEnabledUi(next)
    if (!next.includes(defaultUi)) setDefaultUi(next[0])
  }

  const handleEnabledAiChange = (e: SelectChangeEvent<string[]>) => {
    const value = e.target.value
    const next = orderEnabled(typeof value === 'string' ? value.split(',') : value)
    if (next.length === 0) return
    setEnabledAi(next)
    if (!next.includes(defaultAi)) setDefaultAi(next[0])
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/settings/language-defaults', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          defaultUiLanguage: defaultUi,
          defaultAiLanguage: defaultAi,
          enabledUiLanguages: enabledUi,
          enabledAiLanguages: enabledAi,
        }),
      })
      if (response.ok) {
        const data = await response.json()
        setDefaultUi(data.defaultUiLanguage || 'en')
        setDefaultAi(data.defaultAiLanguage || 'en')
        setEnabledUi(data.enabledUiLanguages?.length ? data.enabledUiLanguages : ['en'])
        setEnabledAi(data.enabledAiLanguages?.length ? data.enabledAiLanguages : ['en'])
        await syncUiLanguageFromServer()
        setSuccess(i18n.t('language.defaultsSaved'))
        setTimeout(() => setSuccess(null), 4000)
      } else {
        const err = await response.json().catch(() => ({}))
        setError((err as { error?: string }).error || t('language.saveDefaultsFailed'))
      }
    } catch {
      setError(t('language.connectionError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card sx={{ backgroundColor: 'background.default', borderRadius: 2 }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={1}>
          <LanguageIcon color="primary" />
          <Typography variant="h6">{t('language.defaultsTitle')}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" mb={3}>
          {t('language.defaultsSubtitle')}
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

        {loading ? (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 440 }}>
            {/* UI languages */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="subtitle2">{t('language.uiSectionTitle')}</Typography>
              <FormControl fullWidth size="small">
                <InputLabel id="admin-enabled-ui-lang">{t('language.availableUi')}</InputLabel>
                <Select
                  labelId="admin-enabled-ui-lang"
                  multiple
                  value={enabledUi}
                  onChange={handleEnabledUiChange}
                  input={<OutlinedInput label={t('language.availableUi')} />}
                  renderValue={(selected) => selected.map(labelFor).join(', ')}
                >
                  {locales.map((l) => (
                    <MenuItem key={l.code} value={l.code}>
                      <Checkbox checked={enabledUi.includes(l.code)} />
                      <ListItemText primary={`${l.label} (${l.code})`} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel id="admin-default-ui-lang">{t('language.defaultUi')}</InputLabel>
                <Select
                  labelId="admin-default-ui-lang"
                  label={t('language.defaultUi')}
                  value={defaultUi}
                  onChange={(e) => setDefaultUi(e.target.value)}
                >
                  {orderEnabled(enabledUi).map((code) => (
                    <MenuItem key={code} value={code}>
                      {labelFor(code)} ({code})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {/* AI languages */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="subtitle2">{t('language.aiSectionTitle')}</Typography>
              <FormControl fullWidth size="small">
                <InputLabel id="admin-enabled-ai-lang">{t('language.availableAi')}</InputLabel>
                <Select
                  labelId="admin-enabled-ai-lang"
                  multiple
                  value={enabledAi}
                  onChange={handleEnabledAiChange}
                  input={<OutlinedInput label={t('language.availableAi')} />}
                  renderValue={(selected) => selected.map(labelFor).join(', ')}
                >
                  {locales.map((l) => (
                    <MenuItem key={l.code} value={l.code}>
                      <Checkbox checked={enabledAi.includes(l.code)} />
                      <ListItemText primary={`${l.label} (${l.code})`} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel id="admin-default-ai-lang">{t('language.defaultAi')}</InputLabel>
                <Select
                  labelId="admin-default-ai-lang"
                  label={t('language.defaultAi')}
                  value={defaultAi}
                  onChange={(e) => setDefaultAi(e.target.value)}
                >
                  {orderEnabled(enabledAi).map((code) => (
                    <MenuItem key={code} value={code}>
                      {labelFor(code)} ({code})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <Button
              variant="contained"
              onClick={() => void save()}
              disabled={saving}
              startIcon={saving ? <CircularProgress size={16} /> : undefined}
              sx={{ alignSelf: 'flex-start' }}
            >
              {saving ? t('common.saving') : t('language.saveDefaults')}
            </Button>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
