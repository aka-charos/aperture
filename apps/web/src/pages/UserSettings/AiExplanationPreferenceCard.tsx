import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Switch } from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import { useTranslation } from 'react-i18next'
import { SettingsCard } from './SettingsCard'

interface AiExplanationPreference {
  overrideAllowed: boolean
  userPreference: boolean | null
  effectiveValue: boolean
  globalEnabled: boolean
  canOverride: boolean
}

/**
 * Whether each pick comes with a written "why". Offered only when the admin
 * lets viewers choose; otherwise it renders nothing, and the settings grid
 * gives the space to its neighbours.
 */
export function AiExplanationPreferenceCard() {
  const { t } = useTranslation()
  const [pref, setPref] = useState<AiExplanationPreference | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPref = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/user/ai-explanation', { credentials: 'include' })
      if (response.ok) setPref((await response.json()) as AiExplanationPreference)
    } catch {
      // Not offered is what an unreadable preference looks like; the card stays hidden.
    }
  }, [])

  useEffect(() => {
    void fetchPref()
  }, [fetchPref])

  const savePref = async (enabled: boolean | null) => {
    if (!pref) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/settings/user/ai-explanation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled }),
      })
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || t('userSettings.errSavePreference'))
      }
      const data = (await response.json()) as { userPreference: boolean | null; effectiveValue: boolean }
      setPref({ ...pref, userPreference: data.userPreference, effectiveValue: data.effectiveValue })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('userSettings.errConnectServer'))
    } finally {
      setSaving(false)
    }
  }

  if (!pref?.canOverride) return null

  return (
    <SettingsCard
      icon={<AutoAwesomeIcon />}
      title={t('userSettings.recs.explanationsTitle')}
      description={t('userSettings.aiExplanationIncludeBody')}
      action={
        <Switch
          checked={pref.userPreference ?? pref.globalEnabled}
          onChange={(e) => void savePref(e.target.checked)}
          disabled={saving}
          slotProps={{ input: { 'aria-label': t('userSettings.recs.explanationsTitle') } }}
        />
      }
      footer={t('userSettings.aiExplanationFooter')}
    >
      {(error || pref.userPreference !== null) && (
        <>
          {error && (
            <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {pref.userPreference !== null && (
            <Button variant="text" size="small" onClick={() => void savePref(null)} disabled={saving} sx={{ textTransform: 'none' }}>
              {t('userSettings.aiExplanationReset', {
                state: pref.globalEnabled ? t('userSettings.stateEnabled') : t('userSettings.stateDisabled'),
              })}
            </Button>
          )}
        </>
      )}
    </SettingsCard>
  )
}
