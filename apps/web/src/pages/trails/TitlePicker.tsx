import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Autocomplete, Box, TextField, Typography } from '@mui/material'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import { getProxiedImageUrl } from '@aperture/ui'
import type { TrailTitle } from './types'

interface SearchHit {
  id: string
  type: 'movie' | 'series'
  title: string
  year: number | null
  poster_url: string | null
}

function toTrailTitle(hit: SearchHit): TrailTitle {
  return {
    ref: `${hit.type}:${hit.id.toLowerCase()}`,
    type: hit.type,
    id: hit.id.toLowerCase(),
    title: hit.title,
    year: hit.year,
    posterUrl: hit.poster_url,
  }
}

interface TitlePickerProps {
  label: string
  value: TrailTitle | null
  onChange: (title: TrailTitle | null) => void
  /** Titles not offered (already chosen elsewhere on the page). */
  exclude?: readonly string[]
  disabled?: boolean
  /** Clear the box after each pick: for adding to a list rather than choosing one. */
  clearOnPick?: boolean
  autoFocus?: boolean
}

/**
 * A library title chosen by typing its name. The library search is the one
 * every page uses (`/api/search`, already scoped to the viewer); the request
 * is debounced and a reply to an older query is dropped.
 */
export function TitlePicker({
  label,
  value,
  onChange,
  exclude = [],
  disabled,
  clearOnPick = false,
  autoFocus,
}: TitlePickerProps) {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [options, setOptions] = useState<TrailTitle[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const term = input.trim()
    // Typing into a box that shows the chosen title echoes the title back; that
    // is not a search.
    if (term.length < 2 || (value && term === value.title)) {
      setOptions([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}&type=all&limit=10`, {
        credentials: 'include',
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((json: { results?: SearchHit[] } | null) => {
          setOptions((json?.results ?? []).map(toTrailTitle))
          setLoading(false)
        })
        .catch(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [input, value])

  const offered = options.filter((option) => !exclude.includes(option.ref))

  return (
    <Autocomplete
      value={clearOnPick ? null : value}
      onChange={(_, picked) => {
        onChange(picked)
        if (clearOnPick) setInput('')
      }}
      inputValue={input}
      onInputChange={(_, next, reason) => {
        // A reset is MUI writing the chosen title back into the box.
        if (clearOnPick && reason === 'reset') return
        setInput(next)
      }}
      options={offered}
      loading={loading}
      disabled={disabled}
      filterOptions={(list) => list}
      isOptionEqualToValue={(option, chosen) => option.ref === chosen.ref}
      getOptionLabel={(option) => option.title}
      noOptionsText={input.trim().length < 2 ? t('trails.picker.typeMore') : t('trails.picker.noResults')}
      loadingText={t('common.loading')}
      renderOption={(props, option) => {
        const { key, ...rest } = props as typeof props & { key: string }
        return (
          <Box component="li" key={key} {...rest} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
            <Box
              component="img"
              src={getProxiedImageUrl(option.posterUrl)}
              alt=""
              loading="lazy"
              sx={{ width: 28, height: 42, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0, bgcolor: 'grey.900' }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {option.title}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {option.type === 'movie' ? <MovieIcon sx={{ fontSize: 12 }} /> : <TvIcon sx={{ fontSize: 12 }} />}
                {option.year ?? ''}
              </Typography>
            </Box>
          </Box>
        )
      }}
      renderInput={(params) => (
        <TextField {...params} label={label} placeholder={t('trails.picker.placeholder')} autoFocus={autoFocus} size="small" />
      )}
      sx={{ minWidth: 220, flex: 1 }}
    />
  )
}
