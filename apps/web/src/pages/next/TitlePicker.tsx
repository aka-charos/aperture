import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Autocomplete, Box, TextField, Typography } from '@mui/material'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import { getProxiedImageUrl } from '@aperture/ui'
import { useLibraryTitleSearch, type LibrarySearchHit } from '@/hooks/useLibraryTitleSearch'
import type { TrailTitle } from './types'

function toTrailTitle(hit: LibrarySearchHit): TrailTitle {
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
 * A library title chosen by typing its name, through the shared library
 * search (`useLibraryTitleSearch`: `/api/search`, scoped to the viewer).
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
  // Typing into a box that shows the chosen title echoes the title back; that
  // is not a search.
  const echoesValue = value != null && input.trim() === value.title
  const { hits, loading, tooShort } = useLibraryTitleSearch(input, { enabled: !echoesValue })
  const options = hits.map(toTrailTitle)

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
      noOptionsText={tooShort ? t('next.picker.typeMore') : t('next.picker.noResults')}
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
              sx={{ width: 28, height: 42, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0, bgcolor: 'surface.fillDeep' }}
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
        <TextField {...params} label={label} placeholder={t('next.picker.placeholder')} autoFocus={autoFocus} size="small" />
      )}
      sx={{ minWidth: 220, flex: 1 }}
    />
  )
}
