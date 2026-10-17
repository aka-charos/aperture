import { Typography } from '@mui/material'
import TheaterComedyIcon from '@mui/icons-material/TheaterComedy'
import { useTranslation } from 'react-i18next'
import { SettingsCard } from '../SettingsCard'
import { WeightList } from './WeightList'
import { GENRE_SCALE } from './weights'
import type { GenreWeight } from './useTasteData'
import { HelpHint } from '@/components/HelpHint'

interface GenresCardProps {
  genres: GenreWeight[]
  newGenres: string[]
  saving: boolean
  scanLabel: string
  onChange: (genre: string, weight: number) => void
  onRemove: (genre: string) => void
}

/**
 * Genre weights. Stored per user (`user_genre_weights` is unique on
 * `(user_id, genre)`), so this is one card for movies and TV alike — it was
 * once rendered under both media sub-tabs, where moving a slider under Movies
 * silently moved the same slider under TV.
 */
export function GenresCard({ genres, newGenres, saving, scanLabel, onChange, onRemove }: GenresCardProps) {
  const { t } = useTranslation()
  return (
    <SettingsCard
      tourAnchor="settings-weights"
      icon={<TheaterComedyIcon />}
      title={
        <>
          {t('userSettings.recs.genresTitle')} <HelpHint doc="user-settings/recommendations" anchor="genres" />
        </>
      }
      description={t('userSettings.recs.genresBody')}
      footer={saving ? t('watcherIdentity.savingSlider') : t('userSettings.recs.autoSaveNote')}
    >
      {genres.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('watcherIdentity.noGenresHint', { action: scanLabel })}
        </Typography>
      ) : (
        <WeightList
          items={genres.map((g) => ({ name: g.genre, value: g.weight }))}
          newNames={newGenres}
          scale={GENRE_SCALE}
          toneLabels={{
            up: t('watcherIdentity.weightBoost'),
            neutral: t('watcherIdentity.weightNormal'),
            down: t('watcherIdentity.weightLess'),
          }}
          adjustLabel={t('userSettings.recs.adjustGenres', { count: genres.length })}
          onChange={onChange}
          onRemove={onRemove}
        />
      )}
    </SettingsCard>
  )
}
