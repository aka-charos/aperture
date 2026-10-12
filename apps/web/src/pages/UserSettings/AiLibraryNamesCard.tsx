import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, CircularProgress, TextField } from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import TextFieldsIcon from '@mui/icons-material/TextFields'
import { useTranslation } from 'react-i18next'
import type { User } from '@/hooks/auth-context'
import { SettingsCard } from './SettingsCard'

/**
 * Names for the viewer's generated libraries (legacy library output).
 *
 * Mounted only while that output is on — the settings page reads the decided
 * `libraryOutputEnabled` and leaves this card out otherwise, since the names
 * would rename libraries that are no longer created. It used to stay on the
 * page greyed, under a banner saying it had no effect, in the most prominent
 * slot of the tab. The names are kept, so switching the output back on brings
 * the card back with them.
 */
export function AiLibraryNamesCard({ user }: { user: User | null }) {
  const { t } = useTranslation()
  const [defaultLibraryPrefix, setDefaultLibraryPrefix] = useState('AI Picks - ')
  const [moviesLibraryName, setMoviesLibraryName] = useState('')
  const [seriesLibraryName, setSeriesLibraryName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/user', { credentials: 'include' })
      if (response.ok) {
        const data = (await response.json()) as {
          defaults?: { libraryNamePrefix?: string }
          settings?: { libraryName?: string; seriesLibraryName?: string }
        }
        setDefaultLibraryPrefix(data.defaults?.libraryNamePrefix || 'AI Picks - ')
        setMoviesLibraryName(data.settings?.libraryName || '')
        setSeriesLibraryName(data.settings?.seriesLibraryName || '')
      } else {
        const err = (await response.json().catch(() => ({}))) as { error?: string }
        setError(err.error || t('userSettings.errLoadUserSettings'))
      }
    } catch {
      setError(t('userSettings.errConnectServer'))
    }
  }, [t])

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  const saveSettings = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/settings/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          libraryName: moviesLibraryName.trim() || null,
          seriesLibraryName: seriesLibraryName.trim() || null,
        }),
      })
      if (response.ok) {
        setSuccess(t('userSettings.libraryNamesSaved'))
        window.setTimeout(() => setSuccess(null), 5000)
      } else {
        const err = (await response.json().catch(() => ({}))) as { error?: string }
        setError(err.error || t('userSettings.errSaveSettings'))
      }
    } catch {
      setError(t('userSettings.errConnectServer'))
    } finally {
      setSaving(false)
    }
  }

  const owner = user?.displayName || user?.username || 'User'

  return (
    <SettingsCard
      icon={<TextFieldsIcon />}
      title={t('userSettings.aiLibraryNamesTitle')}
      description={t('userSettings.aiLibraryNamesSubtitle')}
      footer={t('userSettings.aiLibraryFooter')}
    >
      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label={t('userSettings.moviesLibraryNameLabel')}
          placeholder={`${defaultLibraryPrefix}${owner} - Movies`}
          value={moviesLibraryName}
          onChange={(e) => setMoviesLibraryName(e.target.value)}
          size="small"
          fullWidth
          inputProps={{ maxLength: 100 }}
          helperText={
            moviesLibraryName
              ? t('userSettings.libraryHelperNamedMovies', { name: moviesLibraryName })
              : t('userSettings.libraryHelperEmpty')
          }
        />
        <TextField
          label={t('userSettings.seriesLibraryNameLabel')}
          placeholder={`${defaultLibraryPrefix}${owner} - TV Series`}
          value={seriesLibraryName}
          onChange={(e) => setSeriesLibraryName(e.target.value)}
          size="small"
          fullWidth
          inputProps={{ maxLength: 100 }}
          helperText={
            seriesLibraryName
              ? t('userSettings.libraryHelperNamedSeries', { name: seriesLibraryName })
              : t('userSettings.libraryHelperEmpty')
          }
        />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="contained"
            size="small"
            startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
            onClick={() => void saveSettings()}
            disabled={saving}
          >
            {saving ? t('userSettings.saving') : t('common.save')}
          </Button>
          {(moviesLibraryName || seriesLibraryName) && (
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setMoviesLibraryName('')
                setSeriesLibraryName('')
              }}
              disabled={saving}
            >
              {t('userSettings.resetToDefaults')}
            </Button>
          )}
        </Box>
      </Box>
    </SettingsCard>
  )
}
