import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  ClickAwayListener,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Popper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import PublicIcon from '@mui/icons-material/Public'
import SearchIcon from '@mui/icons-material/Search'
import CloseIcon from '@mui/icons-material/Close'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import type { CountryOption } from '../types'
import type { CountryMatchMode } from './FilterPopper'

type CountrySortMode = 'count' | 'name'

interface CountryFilterPopperProps {
  countries: CountryOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  match: CountryMatchMode
  onMatchChange: (match: CountryMatchMode) => void
}

export function CountryFilterPopper({ countries, selected, onChange, match, onMatchChange }: CountryFilterPopperProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null)
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<CountrySortMode>('count')

  const open = Boolean(anchorEl)

  const close = () => {
    setAnchorEl(null)
    setSearch('')
  }

  const toggleCountry = (country: string) => {
    if (selected.includes(country)) {
      onChange(selected.filter((c) => c !== country))
    } else {
      onChange([...selected, country])
    }
  }

  // Selected values can outlive the options list (e.g. loaded from a preset
  // after a library re-sync); keep them visible so they can be deselected.
  const selectedOptions = useMemo(() => {
    const known = new Map(countries.map((c) => [c.country, c]))
    return selected.map((value) => known.get(value) ?? { country: value, count: 0 })
  }, [countries, selected])

  const query = search.trim().toLowerCase()

  const visibleSelected = useMemo(
    () => selectedOptions.filter((c) => !query || c.country.toLowerCase().includes(query)),
    [selectedOptions, query]
  )

  const visibleUnselected = useMemo(() => {
    const rest = countries.filter(
      (c) => !selected.includes(c.country) && (!query || c.country.toLowerCase().includes(query))
    )
    return rest.sort((a, b) =>
      sortMode === 'count'
        ? b.count - a.count || a.country.localeCompare(b.country)
        : a.country.localeCompare(b.country)
    )
  }, [countries, selected, query, sortMode])

  const visibleCount = visibleSelected.length + visibleUnselected.length

  const handleSearchKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      close()
    } else if (event.key === 'Enter') {
      const first = visibleUnselected[0] ?? visibleSelected[0]
      if (first) {
        toggleCountry(first.country)
        setSearch('')
      }
    }
  }

  const buttonLabel =
    selected.length === 0
      ? t('countryFilter.label')
      : selected.length === 1
        ? selected[0]
        : t('countryFilter.buttonSummary', { name: selected[0], count: selected.length - 1 })

  const active = open || selected.length > 0

  const renderRow = (option: CountryOption, isSelected: boolean) => (
    <ListItemButton
      key={option.country}
      dense
      onClick={() => toggleCountry(option.country)}
      sx={{
        py: 0.25,
        borderRadius: 1,
        backgroundColor: isSelected ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
        '&:hover': {
          backgroundColor: isSelected
            ? alpha(theme.palette.primary.main, 0.12)
            : alpha(theme.palette.action.hover, 0.08),
        },
      }}
    >
      <Checkbox
        size="small"
        checked={isSelected}
        tabIndex={-1}
        disableRipple
        sx={{ p: 0.5, marginInlineEnd: 1 }}
      />
      <ListItemText
        primary={option.country}
        primaryTypographyProps={{
          variant: 'body2',
          noWrap: true,
          fontWeight: isSelected ? 600 : 400,
          color: isSelected ? 'primary.main' : 'text.primary',
        }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ marginInlineStart: 1, flexShrink: 0 }}>
        {option.count.toLocaleString()}
      </Typography>
    </ListItemButton>
  )

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<PublicIcon />}
        onClick={(e) => setAnchorEl(anchorEl ? null : e.currentTarget)}
        size="small"
        sx={{
          height: 40,
          px: 1.75,
          maxWidth: 240,
          borderColor: active ? 'primary.main' : alpha(theme.palette.text.primary, 0.23),
          color: active ? 'primary.main' : 'text.primary',
          backgroundColor: open ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
          textTransform: 'none',
          fontWeight: selected.length > 0 ? 600 : 400,
          '&:hover': {
            borderColor: active ? 'primary.main' : 'text.primary',
            backgroundColor: alpha(theme.palette.primary.main, 0.08),
          },
        }}
      >
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {buttonLabel}
        </Box>
      </Button>

      <Popper
        open={open}
        anchorEl={anchorEl}
        placement="bottom-start"
        sx={{ zIndex: 1300 }}
        modifiers={[{ name: 'offset', options: { offset: [0, 8] } }]}
      >
        <ClickAwayListener onClickAway={close}>
          <Paper
            elevation={8}
            sx={{
              width: 320,
              borderRadius: 2,
              border: 1,
              borderColor: 'divider',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '70vh',
            }}
          >
            {/* Header */}
            <Box
              sx={{
                p: 2,
                pb: 1.5,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <Typography variant="subtitle1" fontWeight={700}>
                {t('countryFilter.title')}
              </Typography>
              {selected.length > 0 && (
                <IconButton size="small" onClick={() => onChange([])} title={t('countryFilter.clearTooltip')}>
                  <RestartAltIcon fontSize="small" />
                </IconButton>
              )}
            </Box>

            {/* Search + sort */}
            <Box sx={{ px: 2, pt: 1.5, pb: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <TextField
                autoFocus
                fullWidth
                size="small"
                placeholder={t('countryFilter.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                  endAdornment: search ? (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => setSearch('')}
                        title={t('countryFilter.clearSearch')}
                        edge="end"
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ) : undefined,
                }}
              />

              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Typography variant="caption" color="text.secondary">
                  {t('countryFilter.shownCount', { count: visibleCount })}
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={sortMode}
                  onChange={(_, mode: CountrySortMode | null) => {
                    if (mode !== null) setSortMode(mode)
                  }}
                  sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 1, textTransform: 'none' } }}
                >
                  <ToggleButton value="count">{t('countryFilter.sortByCount')}</ToggleButton>
                  <ToggleButton value="name">{t('countryFilter.sortAz')}</ToggleButton>
                </ToggleButtonGroup>
              </Box>

              {selected.length > 0 && (
                <Box display="flex" flexWrap="wrap" gap={0.5} sx={{ maxHeight: 88, overflow: 'auto' }}>
                  {selected.map((country) => (
                    <Chip
                      key={country}
                      label={country}
                      size="small"
                      color="primary"
                      variant="outlined"
                      onDelete={() => toggleCountry(country)}
                    />
                  ))}
                </Box>
              )}

              {selected.length > 1 && (
                <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                  <Typography variant="caption" color="text.secondary">
                    {t('countryFilter.matchLabel')}
                  </Typography>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={match}
                    onChange={(_, mode: CountryMatchMode | null) => {
                      if (mode !== null) onMatchChange(mode)
                    }}
                    sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 1, textTransform: 'none' } }}
                  >
                    <ToggleButton value="all">{t('countryFilter.matchAll')}</ToggleButton>
                    <ToggleButton value="any">{t('countryFilter.matchAny')}</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
              )}
            </Box>

            {/* Country list */}
            <Box sx={{ overflow: 'auto', px: 1, pb: 1, flexGrow: 1 }}>
              {visibleCount === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 2, textAlign: 'center' }}>
                  {t('countryFilter.noMatches', { query: search.trim() })}
                </Typography>
              ) : (
                <List dense disablePadding>
                  {visibleSelected.map((option) => renderRow(option, true))}
                  {visibleUnselected.map((option) => renderRow(option, false))}
                </List>
              )}
            </Box>
          </Paper>
        </ClickAwayListener>
      </Popper>
    </>
  )
}
