import { useSettingsData } from '@/pages/settings/hooks'
import { RecommendationConfigSection } from '@/pages/settings/components'

/**
 * Holds `useSettingsData` for `RecommendationConfigSection`. See the note in
 * `LibrariesRoute` on why the hook is still whole.
 *
 * The field updaters are passed straight through: they are functional
 * `setRecConfig(prev => …)` updates inside the hook, which the sliders depend
 * on — the budget UI issues three of them in sequence and a closure over
 * `recConfig` would leave only the last standing.
 */
export default function AlgorithmRoute() {
  const settings = useSettingsData(true)

  return (
    <RecommendationConfigSection
      recConfig={settings.recConfig}
      libraryCounts={settings.libraryCounts}
      loadingRecConfig={settings.loadingRecConfig}
      savingRecConfig={settings.savingRecConfig}
      recConfigError={settings.recConfigError}
      setRecConfigError={settings.setRecConfigError}
      recConfigSuccess={settings.recConfigSuccess}
      setRecConfigSuccess={settings.setRecConfigSuccess}
      movieConfigDirty={settings.movieConfigDirty}
      seriesConfigDirty={settings.seriesConfigDirty}
      saveMovieConfig={settings.saveMovieConfig}
      saveSeriesConfig={settings.saveSeriesConfig}
      resetMovieConfig={settings.resetMovieConfig}
      resetSeriesConfig={settings.resetSeriesConfig}
      updateMovieConfigField={settings.updateMovieConfigField}
      updateSeriesConfigField={settings.updateSeriesConfigField}
    />
  )
}
