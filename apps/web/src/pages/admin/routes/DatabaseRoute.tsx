import { useSettingsData } from '@/pages/settings/hooks'
import { DatabaseSection } from '@/pages/settings/components'

/**
 * Holds `useSettingsData` for `DatabaseSection`. See the note in
 * `LibrariesRoute` on why the hook is still whole.
 */
export default function DatabaseRoute() {
  const settings = useSettingsData(true)

  return (
    <DatabaseSection
      purgeStats={settings.purgeStats}
      loadingPurgeStats={settings.loadingPurgeStats}
      purging={settings.purging}
      purgeError={settings.purgeError}
      setPurgeError={settings.setPurgeError}
      purgeSuccess={settings.purgeSuccess}
      setPurgeSuccess={settings.setPurgeSuccess}
      showPurgeConfirm={settings.showPurgeConfirm}
      setShowPurgeConfirm={settings.setShowPurgeConfirm}
      onPurge={settings.executePurge}
    />
  )
}
