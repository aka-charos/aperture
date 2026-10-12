import { useEffect, useState } from 'react'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Collapse,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  Typography,
} from '@mui/material'
import ThumbDownIcon from '@mui/icons-material/ThumbDown'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import CloseIcon from '@mui/icons-material/Close'
import ListIcon from '@mui/icons-material/List'
import { useTranslation } from 'react-i18next'
import { StarRating, getProxiedImageUrl } from '@aperture/ui'
import { useUserRatings } from '@/hooks/useUserRatings'
import { SettingsCard } from '../SettingsCard'

type DislikeBehavior = 'exclude' | 'penalize'
type ItemType = 'movie' | 'series'

interface DislikedItem {
  id: string
  title: string
  year: number | null
  posterUrl: string | null
  rating: number
}

/** The top of the disliked band: a rating above this leaves the list. */
const DISLIKED_MAX_RATING = 3

function DislikedRow({
  item,
  type,
  onRate,
  onClear,
}: {
  item: DislikedItem
  type: ItemType
  onRate: (rating: number) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1, borderTop: 1, borderColor: 'divider' }}>
      <Avatar src={getProxiedImageUrl(item.posterUrl) || undefined} variant="rounded" sx={{ width: 32, height: 46 }}>
        {type === 'movie' ? <MovieIcon fontSize="small" /> : <TvIcon fontSize="small" />}
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={500} noWrap>
          {item.title}
        </Typography>
        {item.year != null && (
          <Typography variant="caption" color="text.secondary">
            {item.year}
          </Typography>
        )}
      </Box>
      <StarRating value={item.rating} onChange={(rating) => rating && onRate(rating)} size="small" />
      <IconButton size="small" onClick={onClear} aria-label={t('algorithmSettings.clearRatingTooltip')}>
        <CloseIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

/** What a low rating does to recommendations, and the titles it currently applies to. */
export function LowRatedTitlesCard() {
  const { t } = useTranslation()
  const { setRating } = useUserRatings()
  const [behavior, setBehavior] = useState<DislikeBehavior>('exclude')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [items, setItems] = useState<Record<ItemType, DislikedItem[]>>({ movie: [], series: [] })
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [behaviorRes, listRes] = await Promise.all([
          fetch('/api/settings/user/dislike-behavior', { credentials: 'include' }),
          fetch('/api/ratings/disliked', { credentials: 'include' }),
        ])
        if (cancelled) return
        if (behaviorRes.ok) {
          const data = (await behaviorRes.json()) as { dislikeBehavior?: DislikeBehavior }
          setBehavior(data.dislikeBehavior ?? 'exclude')
        }
        if (listRes.ok) {
          const data = (await listRes.json()) as { movies?: DislikedItem[]; series?: DislikedItem[] }
          setItems({ movie: data.movies ?? [], series: data.series ?? [] })
        }
      } catch {
        // The defaults shown are the defaults the server applies.
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const saveBehavior = async (value: DislikeBehavior) => {
    const previous = behavior
    setSaving(true)
    setError(null)
    setBehavior(value)
    try {
      const response = await fetch('/api/settings/user/dislike-behavior', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ dislikeBehavior: value }),
      })
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || t('userSettings.errSavePreference'))
      }
    } catch (e) {
      setBehavior(previous)
      setError(e instanceof Error ? e.message : t('userSettings.errSavePreference'))
    } finally {
      setSaving(false)
    }
  }

  const rate = async (type: ItemType, id: string, rating: number | null) => {
    try {
      // Through the provider, not a fetch of its own: these ratings are on
      // cards elsewhere too, and a direct post would leave the shared map
      // holding the old number until a reload.
      await setRating(type, id, rating)
      setItems((prev) => ({
        ...prev,
        [type]:
          rating == null || rating > DISLIKED_MAX_RATING
            ? prev[type].filter((item) => item.id !== id)
            : prev[type].map((item) => (item.id === id ? { ...item, rating } : item)),
      }))
    } catch {
      setError(rating == null ? t('algorithmSettings.errClearRating') : t('algorithmSettings.errUpdateRating'))
    }
  }

  const count = items.movie.length + items.series.length

  return (
    <SettingsCard
      icon={<ThumbDownIcon />}
      title={t('userSettings.recs.lowRatedTitle')}
      description={t('algorithmSettings.dislikedHandlingSubtitle')}
    >
      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <RadioGroup value={behavior} onChange={(e) => void saveBehavior(e.target.value as DislikeBehavior)}>
        {(['exclude', 'penalize'] as const).map((value) => (
          <FormControlLabel
            key={value}
            value={value}
            disabled={!loaded || saving}
            control={<Radio size="small" />}
            sx={{ alignItems: 'flex-start', mb: 0.5, '& .MuiRadio-root': { pt: 0.25 } }}
            label={
              <Box>
                <Typography variant="body2" fontWeight={500}>
                  {t(`algorithmSettings.${value}OptionTitle`)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t(`algorithmSettings.${value}OptionDesc`)}
                </Typography>
              </Box>
            }
          />
        ))}
      </RadioGroup>

      {loaded && count === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('algorithmSettings.noDislikedItems')}
        </Typography>
      ) : (
        loaded && (
          <>
            <Button
              size="small"
              startIcon={<ListIcon />}
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              sx={{ mt: 1, textTransform: 'none' }}
            >
              {t('userSettings.recs.reviewLowRated', { count })}
            </Button>
            <Collapse in={open} unmountOnExit>
              <Box sx={{ mt: 1, maxHeight: 320, overflowY: 'auto' }}>
                {(['movie', 'series'] as const).map((type) =>
                  items[type].map((item) => (
                    <DislikedRow
                      key={`${type}:${item.id}`}
                      item={item}
                      type={type}
                      onRate={(rating) => void rate(type, item.id, rating)}
                      onClear={() => void rate(type, item.id, null)}
                    />
                  ))
                )}
              </Box>
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                {t('algorithmSettings.dislikedTipFooter')}
              </Typography>
            </Collapse>
          </>
        )
      )}
    </SettingsCard>
  )
}
