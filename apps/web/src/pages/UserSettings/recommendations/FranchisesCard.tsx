import { useEffect, useState } from 'react'
import { Box, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material'
import LocalMoviesIcon from '@mui/icons-material/LocalMovies'
import { useTranslation } from 'react-i18next'
import { SettingsCard } from '../SettingsCard'
import { MediaTypeToggle } from './MediaTypeToggle'
import { WeightList } from './WeightList'
import { FRANCHISE_SCALE } from './weights'
import type { Franchise, MediaType, TasteProfileSettings } from './useTasteData'

const MIN_SIZE_VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const
const MIN_WATCHED_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

type DetectionPatch = Partial<Pick<TasteProfileSettings, 'minFranchiseSize' | 'minFranchiseItems'>>

interface FranchisesCardProps {
  mediaTypes: MediaType[]
  franchises: Record<MediaType, Franchise[]>
  newFranchises: Record<MediaType, string[]>
  profiles: Record<MediaType, TasteProfileSettings | null>
  saving: boolean
  scanLabel: string
  onChange: (type: MediaType, name: string, score: number) => void
  onRemove: (type: MediaType, name: string) => void
  onSaveProfile: (type: MediaType, patch: DetectionPatch) => void
}

/**
 * When a franchise is counted at all. Lives with the franchise list because
 * that is the only thing it changes — it used to head the whole page as "Min
 * Franchise Size" and "Min Watched", the first two controls anyone saw.
 */
function DetectionRules({
  type,
  profile,
  onSave,
}: {
  type: MediaType
  profile: TasteProfileSettings | null
  onSave: (patch: DetectionPatch) => void
}) {
  const { t } = useTranslation()
  const disabled = !profile
  return (
    <Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        <FormControl size="small" sx={{ minWidth: 200, flex: '1 1 200px' }} disabled={disabled}>
          <InputLabel id={`franchise-size-${type}`}>{t('userSettings.recs.franchiseMinSize')}</InputLabel>
          <Select
            labelId={`franchise-size-${type}`}
            label={t('userSettings.recs.franchiseMinSize')}
            value={profile?.minFranchiseSize ?? 2}
            onChange={(e) => onSave({ minFranchiseSize: Number(e.target.value) })}
          >
            {MIN_SIZE_VALUES.map((value) => (
              <MenuItem key={value} value={value}>
                {type === 'movie'
                  ? t('watcherIdentity.minFranchiseSizeOptionMovies', { count: value })
                  : t('watcherIdentity.minFranchiseSizeOptionShows', { count: value })}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 200, flex: '1 1 200px' }} disabled={disabled}>
          <InputLabel id={`franchise-watched-${type}`}>{t('userSettings.recs.franchiseMinWatched')}</InputLabel>
          <Select
            labelId={`franchise-watched-${type}`}
            label={t('userSettings.recs.franchiseMinWatched')}
            value={profile?.minFranchiseItems ?? 1}
            onChange={(e) => onSave({ minFranchiseItems: Number(e.target.value) })}
          >
            {MIN_WATCHED_VALUES.map((value) => (
              <MenuItem key={value} value={value}>
                {t('watcherIdentity.minWatchedOption', { count: value })}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
        {disabled ? t('userSettings.recs.needsFirstScan') : t('userSettings.recs.franchiseDetectionNote')}
      </Typography>
    </Box>
  )
}

/** Franchise preferences: stored per media type, so this card carries its own Movies/TV switch. */
export function FranchisesCard({
  mediaTypes,
  franchises,
  newFranchises,
  profiles,
  saving,
  scanLabel,
  onChange,
  onRemove,
  onSaveProfile,
}: FranchisesCardProps) {
  const { t } = useTranslation()
  const [type, setType] = useState<MediaType>(mediaTypes[0] ?? 'movie')

  // Keep the selection valid if the library list arrives after first render.
  useEffect(() => {
    if (!mediaTypes.includes(type)) setType(mediaTypes[0] ?? 'movie')
  }, [mediaTypes, type])

  // After a scan, show the media type that found something if this one found nothing.
  useEffect(() => {
    setType((current) => {
      if (newFranchises[current].length > 0) return current
      return mediaTypes.find((candidate) => newFranchises[candidate].length > 0) ?? current
    })
  }, [newFranchises, mediaTypes])

  const list = franchises[type]
  const rules = <DetectionRules type={type} profile={profiles[type]} onSave={(patch) => onSaveProfile(type, patch)} />

  return (
    <SettingsCard
      icon={<LocalMoviesIcon />}
      title={t('userSettings.recs.franchisesTitle')}
      description={t('userSettings.recs.franchisesBody')}
      footer={saving ? t('watcherIdentity.savingSlider') : t('userSettings.recs.autoSaveNote')}
    >
      {mediaTypes.length > 1 && (
        <Box sx={{ mb: 2 }}>
          <MediaTypeToggle value={type} options={mediaTypes} onChange={setType} />
        </Box>
      )}
      {list.length === 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {t('watcherIdentity.noFranchisesHint', { action: scanLabel })}
          </Typography>
          {rules}
        </Box>
      ) : (
        <WeightList
          // Keyed by media type so switching resets the open state and the order.
          key={type}
          items={list.map((f) => ({ name: f.franchiseName, value: f.preferenceScore }))}
          newNames={newFranchises[type]}
          scale={FRANCHISE_SCALE}
          toneLabels={{
            up: t('watcherIdentity.weightBoost'),
            neutral: t('watcherIdentity.weightNeutral'),
            down: t('watcherIdentity.weightAvoid'),
          }}
          adjustLabel={t('userSettings.recs.adjustFranchises', { count: list.length })}
          onChange={(name, value) => onChange(type, name, value)}
          onRemove={(name) => onRemove(type, name)}
          footer={rules}
        />
      )}
    </SettingsCard>
  )
}
