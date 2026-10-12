import { useEffect, useState } from 'react'
import { Alert, Switch } from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import { useTranslation } from 'react-i18next'
import { SettingsCard } from '../SettingsCard'

/**
 * Whether already-watched titles may be recommended. The switch is labelled by
 * what it DOES, not by the state it is in: the old card wrote the current
 * state next to it ("New Content Only" beside an off switch), which reads as
 * either answer.
 */
export function WatchedTitlesCard() {
  const { t } = useTranslation()
  const [includeWatched, setIncludeWatched] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/settings/user/include-watched', { credentials: 'include' })
        if (response.ok && !cancelled) {
          const data = (await response.json()) as { includeWatched?: boolean }
          setIncludeWatched(data.includeWatched === true)
        }
      } catch {
        // Off is the default and what the switch already shows.
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const save = async (value: boolean) => {
    setSaving(true)
    setError(null)
    setIncludeWatched(value)
    try {
      const response = await fetch('/api/settings/user/include-watched', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ includeWatched: value }),
      })
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || t('userSettings.errSavePreference'))
      }
    } catch (e) {
      setIncludeWatched(!value)
      setError(e instanceof Error ? e.message : t('userSettings.errSavePreference'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard
      icon={<VisibilityIcon />}
      title={t('userSettings.recs.watchedTitle')}
      description={t('userSettings.recs.watchedBody')}
      action={
        <Switch
          checked={includeWatched}
          disabled={!loaded || saving}
          onChange={(e) => void save(e.target.checked)}
          slotProps={{ input: { 'aria-label': t('userSettings.recs.watchedTitle') } }}
        />
      }
    >
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
    </SettingsCard>
  )
}
