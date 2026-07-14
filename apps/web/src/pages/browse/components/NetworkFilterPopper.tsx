import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Button,
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
import LiveTvIcon from '@mui/icons-material/LiveTv'
import SearchIcon from '@mui/icons-material/Search'
import CloseIcon from '@mui/icons-material/Close'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import type { NetworkOption } from '../types'

type NetworkSortMode = 'count' | 'name'

interface NetworkFilterPopperProps {
  networks: NetworkOption[]
  selected: string
  onChange: (network: string) => void
}

export function NetworkFilterPopper({ networks, selected, onChange }: NetworkFilterPopperProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null)
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<NetworkSortMode>('count')

  const open = Boolean(anchorEl)

  const close = () => {
    setAnchorEl(null)
    setSearch('')
  }

  const selectNetwork = (network: string) => {
    // Clicking the active network clears the filter; otherwise select and close.
    onChange(network === selected ? '' : network)
    close()
  }

  const query = search.trim().toLowerCase()

  const visibleNetworks = useMemo(() => {
    const filtered = networks.filter((n) => !query || n.network.toLowerCase().includes(query))
    return filtered.sort((a, b) =>
      sortMode === 'count'
        ? b.count - a.count || a.network.localeCompare(b.network)
        : a.network.localeCompare(b.network)
    )
  }, [networks, query, sortMode])

  const handleSearchKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      close()
    } else if (event.key === 'Enter') {
      const first = visibleNetworks[0]
      if (first) selectNetwork(first.network)
    }
  }

  const active = open || selected !== ''

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<LiveTvIcon />}
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
          fontWeight: selected !== '' ? 600 : 400,
          '&:hover': {
            borderColor: active ? 'primary.main' : 'text.primary',
            backgroundColor: alpha(theme.palette.primary.main, 0.08),
          },
        }}
      >
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected || t('networkFilter.label')}
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
                {t('networkFilter.title')}
              </Typography>
              {selected !== '' && (
                <IconButton
                  size="small"
                  onClick={() => {
                    onChange('')
                    close()
                  }}
                  title={t('networkFilter.clearTooltip')}
                >
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
                placeholder={t('networkFilter.searchPlaceholder')}
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
                        title={t('networkFilter.clearSearch')}
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
                  {t('networkFilter.shownCount', { count: visibleNetworks.length })}
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={sortMode}
                  onChange={(_, mode: NetworkSortMode | null) => {
                    if (mode !== null) setSortMode(mode)
                  }}
                  sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 1, textTransform: 'none' } }}
                >
                  <ToggleButton value="count">{t('networkFilter.sortByCount')}</ToggleButton>
                  <ToggleButton value="name">{t('networkFilter.sortAz')}</ToggleButton>
                </ToggleButtonGroup>
              </Box>
            </Box>

            {/* Network list */}
            <Box sx={{ overflow: 'auto', px: 1, pb: 1, flexGrow: 1 }}>
              {visibleNetworks.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 2, textAlign: 'center' }}>
                  {t('networkFilter.noMatches', { query: search.trim() })}
                </Typography>
              ) : (
                <List dense disablePadding>
                  {visibleNetworks.map((option) => {
                    const isSelected = option.network === selected
                    return (
                      <ListItemButton
                        key={option.network}
                        dense
                        selected={isSelected}
                        onClick={() => selectNetwork(option.network)}
                        sx={{
                          py: 0.25,
                          borderRadius: 1,
                          '&.Mui-selected': {
                            backgroundColor: alpha(theme.palette.primary.main, 0.08),
                            '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.12) },
                          },
                        }}
                      >
                        <ListItemText
                          primary={option.network}
                          primaryTypographyProps={{
                            variant: 'body2',
                            noWrap: true,
                            fontWeight: isSelected ? 600 : 400,
                            color: isSelected ? 'primary.main' : 'text.primary',
                          }}
                        />
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ marginInlineStart: 1, flexShrink: 0 }}
                        >
                          {option.count.toLocaleString()}
                        </Typography>
                      </ListItemButton>
                    )
                  })}
                </List>
              )}
            </Box>
          </Paper>
        </ClickAwayListener>
      </Popper>
    </>
  )
}
