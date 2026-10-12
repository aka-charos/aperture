import { useState } from 'react'
import { Alert, Box, Button, CircularProgress, Collapse, Typography } from '@mui/material'
import HistoryIcon from '@mui/icons-material/History'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useTranslation } from 'react-i18next'
import { SettingsColumns, SettingsGrid, SettingsSection } from '../SettingsCard'
import { AiExplanationPreferenceCard } from '../AiExplanationPreferenceCard'
import { AutoRefreshCard } from './AutoRefreshCard'
import { CustomWeightsCard } from './CustomWeightsCard'
import { FranchisesCard } from './FranchisesCard'
import { GenresCard } from './GenresCard'
import { InterestsCard } from './InterestsCard'
import { LibrarySourcesCard } from './LibrarySourcesCard'
import { LowRatedTitlesCard } from './LowRatedTitlesCard'
import { RescanDialog } from './RescanDialog'
import { WatchedTitlesCard } from './WatchedTitlesCard'
import { formatScanDate } from './scanDate'
import { useTasteData, type MediaType, type RescanMode } from './useTasteData'

type Notice = { severity: 'success' | 'warning' | 'error'; text: string }

/**
 * Everything that decides what this viewer is recommended, on one tab, grouped
 * by what it is about rather than by where it is stored: their taste, what is
 * allowed onto their list, and — out of the way — the fine-tuning.
 *
 * It replaces three tabs ("Watcher Identity", "AI Algorithm" and half of
 * "Preferences") that split these by implementation, put a Movies/TV switch
 * above per-user settings, and showed the rarely-touched controls first.
 */
export function RecommendationsTab() {
  const { t, i18n } = useTranslation()
  const data = useTasteData()
  const [askMode, setAskMode] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const typeLabel = (type: MediaType) =>
    type === 'movie' ? t('userSettings.identitySubtabMovies') : t('userSettings.identitySubtabSeries')

  const runScan = async (mode: RescanMode) => {
    setAskMode(false)
    setScanning(true)
    setNotice(null)
    try {
      const outcome = await data.rescan(mode)
      if (outcome.failed.length === data.mediaTypes.length) {
        setNotice({ severity: 'error', text: t('watcherIdentity.errAnalyzeWatchHistory') })
        return
      }
      const summary =
        mode === 'merge'
          ? outcome.newFranchises + outcome.newGenres > 0
            ? t('watcherIdentity.successMergeNew', { franchiseCount: outcome.newFranchises, genreCount: outcome.newGenres })
            : t('watcherIdentity.successMergeNone')
          : t('watcherIdentity.successResetComplete', {
              franchiseCount: outcome.franchisesFound,
              genreCount: outcome.genresFound,
            })
      setNotice(
        outcome.failed.length > 0
          ? {
              severity: 'warning',
              text: t('userSettings.recs.rescanPartial', {
                summary,
                types: outcome.failed.map(typeLabel).join(', '),
              }),
            }
          : { severity: 'success', text: summary }
      )
    } finally {
      setScanning(false)
    }
  }

  const startScan = () => {
    // Nothing to overwrite yet: no question to ask.
    if (data.hasPreferences) setAskMode(true)
    else void runScan('reset')
  }

  if (data.loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={28} />
      </Box>
    )
  }

  if (data.loadFailed) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => void data.reload()}>
            {t('userSettings.recs.retry')}
          </Button>
        }
      >
        {t('watcherIdentity.errFetchData')}
      </Alert>
    )
  }

  const scanLabel = t('userSettings.recs.rescan')
  const scanStatus = data.mediaTypes
    .map((type) => {
      const profile = data.profiles[type]
      const status = profile?.autoUpdatedAt
        ? t('watcherIdentity.analyzedOn', { date: formatScanDate(profile.autoUpdatedAt, i18n.language) })
        : t('userSettings.recs.notScannedYet')
      return t('userSettings.recs.scanStatus', { type: typeLabel(type), status })
    })
    .join(' · ')

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 820 }}>
        {t('userSettings.recs.intro')}
      </Typography>

      {data.error && (
        <Alert severity="error" onClose={data.clearError}>
          {data.error}
        </Alert>
      )}

      <SettingsSection
        title={t('userSettings.recs.tasteTitle')}
        description={
          <>
            {t('userSettings.recs.tasteBody')}
            <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {scanStatus}
            </Typography>
          </>
        }
        action={
          <Button
            variant="outlined"
            size="small"
            startIcon={scanning ? <CircularProgress size={16} color="inherit" /> : <HistoryIcon />}
            onClick={startScan}
            disabled={scanning}
          >
            {scanning ? t('watcherIdentity.analyzing') : scanLabel}
          </Button>
        }
      >
        {notice && (
          <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
            {notice.text}
          </Alert>
        )}
        <SettingsColumns
          left={
            <>
              <InterestsCard interests={data.interests} onAdd={(text) => void data.addInterest(text)} onRemove={(i) => void data.removeInterest(i)} />
              <LibrarySourcesCard libraries={data.libraries} savingLibrary={data.savingLibrary} onToggle={(lib) => void data.toggleLibrary(lib)} />
            </>
          }
          right={
            <>
              <GenresCard
                genres={data.genres}
                newGenres={data.newGenres}
                saving={data.savingGenres}
                scanLabel={scanLabel}
                onChange={data.setGenreWeight}
                onRemove={(genre) => void data.removeGenre(genre)}
              />
              <FranchisesCard
                mediaTypes={data.mediaTypes}
                franchises={data.franchises}
                newFranchises={data.newFranchises}
                profiles={data.profiles}
                saving={data.savingFranchises}
                scanLabel={scanLabel}
                onChange={data.setFranchiseScore}
                onRemove={(type, name) => void data.removeFranchise(type, name)}
                onSaveProfile={(type, patch) => void data.saveProfile(type, patch)}
              />
            </>
          }
        />
      </SettingsSection>

      <SettingsSection title={t('userSettings.recs.picksTitle')} description={t('userSettings.recs.picksBody')}>
        <SettingsGrid columns={3}>
          <WatchedTitlesCard />
          <LowRatedTitlesCard />
          <AiExplanationPreferenceCard />
        </SettingsGrid>
      </SettingsSection>

      <SettingsSection
        title={t('userSettings.recs.advancedTitle')}
        description={t('userSettings.recs.advancedBody')}
        action={
          <Button
            size="small"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            endIcon={
              <ExpandMoreIcon sx={{ transition: 'transform 150ms', transform: advancedOpen ? 'rotate(180deg)' : 'none' }} />
            }
          >
            {advancedOpen ? t('userSettings.recs.advancedHide') : t('userSettings.recs.advancedShow')}
          </Button>
        }
      >
        <Collapse in={advancedOpen} unmountOnExit>
          <SettingsGrid>
            <CustomWeightsCard mediaTypes={data.mediaTypes} />
            <AutoRefreshCard
              mediaTypes={data.mediaTypes}
              profiles={data.profiles}
              onSave={(type, patch) => void data.saveProfile(type, patch)}
            />
          </SettingsGrid>
        </Collapse>
      </SettingsSection>

      <RescanDialog open={askMode} onClose={() => setAskMode(false)} onChoose={(mode) => void runScan(mode)} />
    </Box>
  )
}
