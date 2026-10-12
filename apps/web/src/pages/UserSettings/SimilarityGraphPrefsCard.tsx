import { useCallback, useEffect, useState } from 'react'
import { Alert, Switch } from '@mui/material'
import HubOutlinedIcon from '@mui/icons-material/HubOutlined'
import { useTranslation } from 'react-i18next'
import { SettingRow, SettingsCard } from './SettingsCard'

interface SimilarityPrefs {
  fullFranchiseMode: boolean
  hideWatched: boolean
}

export function SimilarityGraphPrefsCard() {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<SimilarityPrefs>({ fullFranchiseMode: false, hideWatched: true })
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPrefs = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/user/similarity-prefs', { credentials: 'include' })
      if (response.ok) {
        const data = (await response.json()) as Partial<SimilarityPrefs>
        setPrefs({
          fullFranchiseMode: data.fullFranchiseMode ?? false,
          hideWatched: data.hideWatched ?? true,
        })
      }
    } catch {
      // The defaults shown are the defaults the server applies.
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void fetchPrefs()
  }, [fetchPrefs])

  const savePref = async (key: keyof SimilarityPrefs, value: boolean) => {
    setSaving(true)
    setError(null)
    setPrefs((prev) => ({ ...prev, [key]: value }))
    try {
      const response = await fetch('/api/settings/user/similarity-prefs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ [key]: value }),
      })
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || t('userSettings.errSavePreference'))
      }
    } catch (e) {
      setPrefs((prev) => ({ ...prev, [key]: !value }))
      setError(e instanceof Error ? e.message : t('userSettings.errConnectServer'))
    } finally {
      setSaving(false)
    }
  }

  const disabled = !loaded || saving

  return (
    <SettingsCard
      icon={<HubOutlinedIcon />}
      title={t('userSettings.similarityGraphPrefsTitle')}
      description={t('userSettings.similarityGraphPrefsSubtitle')}
      footer={t('userSettings.similarityGraphFooter')}
    >
      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <SettingRow
        label={t('userSettings.hideWatchedTitle')}
        description={t('userSettings.hideWatchedOn')}
        control={
          <Switch
            checked={prefs.hideWatched}
            disabled={disabled}
            onChange={(e) => void savePref('hideWatched', e.target.checked)}
            slotProps={{ input: { 'aria-label': t('userSettings.hideWatchedTitle') } }}
          />
        }
      />
      <SettingRow
        label={t('userSettings.fullFranchiseTitle')}
        description={t('userSettings.fullFranchiseOn')}
        control={
          <Switch
            checked={prefs.fullFranchiseMode}
            disabled={disabled}
            onChange={(e) => void savePref('fullFranchiseMode', e.target.checked)}
            slotProps={{ input: { 'aria-label': t('userSettings.fullFranchiseTitle') } }}
          />
        }
      />
    </SettingsCard>
  )
}
