import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Dialog,
  DialogContent,
  TextField,
  InputAdornment,
  Typography,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Chip,
  CircularProgress,
  IconButton,
  alpha,
  useTheme,
  Tooltip,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import CloseIcon from '@mui/icons-material/Close'
import { getProxiedImageUrl } from '@aperture/ui'
import { matchSearchShortcut } from '@/lib/searchShortcut'

interface SearchResult {
  id: string
  type: 'movie' | 'series'
  title: string
  year: number | null
  genres: string[]
  poster_url: string | null
  community_rating: number | null
  rt_critic_score: number | null
  collection_name: string | null
  network: string | null
  combined_score: number
}

/**
 * `error` is its own state because a failed search is not an empty one: the
 * dialog used to show "No results found" for a request the server had refused.
 */
type SearchStatus = 'idle' | 'loading' | 'done' | 'error'

export function GlobalSearch() {
  const { t } = useTranslation()
  const theme = useTheme()
  const navigate = useNavigate()
  const searchShortcutTooltip = useMemo(
    () =>
      typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)
        ? t('globalSearch.tooltipMac')
        : t('globalSearch.tooltipWin'),
    [t]
  )
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClose = useCallback(() => {
    setOpen(false)
    setQuery('')
    setResults([])
    setStatus('idle')
    setSelectedIndex(-1)
  }, [])

  // ⌘K / Ctrl+K. Which palette a keystroke belongs to is decided in one place,
  // because this listener and the settings palette's both see every keydown and
  // `preventDefault()` does not stop the other one — see `matchSearchShortcut`.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchSearchShortcut(e) === 'global') {
        e.preventDefault()
        setOpen(true)
      }
      if (e.key === 'Escape' && open) {
        handleClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, handleClose])

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  // Debounced, and the in-flight request is aborted when the query moves on —
  // otherwise a slow early response lands after a fast later one and the list
  // shows results for text that is no longer in the box.
  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setResults([])
      setStatus('idle')
      setSelectedIndex(-1)
      return
    }

    // Pending from the first keystroke, so the previous query's "no results"
    // never shows under the new query while the debounce runs.
    setStatus('loading')
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}&limit=10`, {
          credentials: 'include',
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`Search failed with HTTP ${res.status}`)
        const data = (await res.json()) as { results: SearchResult[] }
        setResults(data.results)
        setStatus('done')
      } catch {
        if (controller.signal.aborted) return
        setResults([])
        setStatus('error')
      }
      setSelectedIndex(-1)
    }, 200)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const handleResultClick = useCallback(
    (result: SearchResult) => {
      navigate(`/${result.type === 'movie' ? 'movies' : 'series'}/${result.id}`)
      handleClose()
    },
    [navigate, handleClose]
  )

  const handleViewAllResults = useCallback(() => {
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query)}`)
      handleClose()
    }
  }, [navigate, handleClose, query])

  const handleKeyboardNav = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, -1))
      } else if (e.key === 'Enter' && query.trim()) {
        e.preventDefault()
        if (selectedIndex >= 0 && selectedIndex < results.length) {
          handleResultClick(results[selectedIndex])
        } else {
          handleViewAllResults()
        }
      }
    },
    [results, selectedIndex, handleResultClick, handleViewAllResults, query]
  )

  return (
    <>
      {/* Search trigger button in header */}
      <Tooltip title={searchShortcutTooltip}>
        <IconButton
          onClick={() => setOpen(true)}
          color="inherit"
          sx={{ opacity: 0.8 }}
        >
          <SearchIcon />
        </IconButton>
      </Tooltip>

      {/* Search Dialog */}
      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            maxHeight: '80vh',
          },
        }}
      >
        <DialogContent sx={{ p: 0 }}>
          {/* Search Input */}
          <Box
            sx={{
              p: 2,
              borderBottom: 1,
              borderColor: 'divider',
              position: 'sticky',
              top: 0,
              bgcolor: 'background.paper',
              zIndex: 1,
            }}
          >
            <TextField
              inputRef={inputRef}
              fullWidth
              placeholder={t('globalSearch.placeholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyboardNav}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    {status === 'loading' ? (
                      <CircularProgress size={20} />
                    ) : (
                      <SearchIcon />
                    )}
                  </InputAdornment>
                ),
                endAdornment: query && (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setQuery('')}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                },
              }}
            />
          </Box>

          {/* Results */}
          <Box sx={{ maxHeight: 'calc(80vh - 120px)', overflowY: 'auto' }}>
            {status === 'idle' && (
              <Box p={4} textAlign="center">
                <Typography color="text.secondary">
                  {t('globalSearch.emptyHint')}
                </Typography>
                <Typography variant="caption" color="text.disabled" display="block" mt={1}>
                  {t('globalSearch.emptyHintDetail')}
                </Typography>
              </Box>
            )}

            {status === 'done' && results.length === 0 && (
              <Box p={4} textAlign="center">
                <Typography color="text.secondary">
                  {t('globalSearch.noResults', { query: query.trim() })}
                </Typography>
              </Box>
            )}

            {status === 'error' && (
              <Box p={4} textAlign="center">
                <Typography color="error">{t('search.errors.searchFailed')}</Typography>
              </Box>
            )}

            {results.length > 0 && (
              <>
                <List sx={{ py: 0 }}>
                  {results.map((result, index) => (
                    <ListItem
                      key={`${result.type}-${result.id}`}
                      onClick={() => handleResultClick(result)}
                      sx={{
                        cursor: 'pointer',
                        bgcolor: selectedIndex >= 0 && index === selectedIndex ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
                        '&:hover': {
                          bgcolor: alpha(theme.palette.primary.main, 0.08),
                        },
                      }}
                    >
                      <ListItemAvatar>
                        <Avatar
                          variant="rounded"
                          src={getProxiedImageUrl(result.poster_url)}
                          sx={{ width: 48, height: 72, borderRadius: 1 }}
                        >
                          {result.type === 'movie' ? <MovieIcon /> : <TvIcon />}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        sx={{ ml: 1 }}
                        primary={
                          <Box display="flex" alignItems="center" gap={1}>
                            <Typography variant="subtitle1" fontWeight={500}>
                              {result.title}
                            </Typography>
                            {result.year && (
                              <Typography variant="body2" color="text.secondary">
                                ({result.year})
                              </Typography>
                            )}
                            <Chip
                              size="small"
                              label={result.type === 'movie' ? t('globalSearch.typeMovie') : t('globalSearch.typeSeries')}
                              sx={{ fontSize: '0.65rem', height: 20 }}
                            />
                          </Box>
                        }
                        secondary={
                          <Box>
                            {result.genres && result.genres.length > 0 && (
                              <Typography variant="caption" color="text.secondary">
                                {result.genres.slice(0, 3).join(' • ')}
                              </Typography>
                            )}
                            <Box display="flex" gap={1} mt={0.5}>
                              {result.rt_critic_score != null && (
                                <Chip
                                  size="small"
                                  label={`🍅 ${result.rt_critic_score}%`}
                                  sx={{ 
                                    fontSize: '0.65rem', 
                                    height: 18,
                                    bgcolor: Number(result.rt_critic_score) >= 60 ? 'success.dark' : 'warning.dark',
                                  }}
                                />
                              )}
                              {result.community_rating != null && (
                                <Chip
                                  size="small"
                                  label={`⭐ ${Number(result.community_rating).toFixed(1)}`}
                                  sx={{ fontSize: '0.65rem', height: 18 }}
                                />
                              )}
                              {result.collection_name && (
                                <Chip
                                  size="small"
                                  label={result.collection_name}
                                  variant="outlined"
                                  sx={{ fontSize: '0.65rem', height: 18 }}
                                />
                              )}
                            </Box>
                          </Box>
                        }
                      />
                    </ListItem>
                  ))}
                </List>

                {/* View all results link */}
                <Box
                  sx={{
                    p: 2,
                    borderTop: 1,
                    borderColor: 'divider',
                    textAlign: 'center',
                    cursor: 'pointer',
                    '&:hover': {
                      bgcolor: 'action.hover',
                    },
                  }}
                  onClick={handleViewAllResults}
                >
                  <Typography variant="body2" color="primary">
                    {t('globalSearch.viewAllForQuery', { query })}
                  </Typography>
                </Box>
              </>
            )}
          </Box>

          {/* Keyboard shortcuts hint */}
          <Box
            sx={{
              p: 1.5,
              borderTop: 1,
              borderColor: 'divider',
              display: 'flex',
              justifyContent: 'center',
              gap: 3,
            }}
          >
            <Box display="flex" alignItems="center" gap={0.5}>
              <Chip
                size="small"
                label={t('globalSearch.hintChipNavigate')}
                aria-label={t('globalSearch.hintAriaNavigate')}
                title={t('globalSearch.hintAriaNavigate')}
                sx={{ fontSize: '0.65rem', height: 20 }}
              />
              <Typography variant="caption" color="text.secondary">
                {t('globalSearch.shortcutNavigate')}
              </Typography>
            </Box>
            <Box display="flex" alignItems="center" gap={0.5}>
              <Chip
                size="small"
                label={t('globalSearch.hintChipSelect')}
                aria-label={t('globalSearch.hintAriaSelect')}
                title={t('globalSearch.hintAriaSelect')}
                sx={{ fontSize: '0.65rem', height: 20 }}
              />
              <Typography variant="caption" color="text.secondary">
                {t('globalSearch.shortcutSelect')}
              </Typography>
            </Box>
            <Box display="flex" alignItems="center" gap={0.5}>
              <Chip
                size="small"
                label={t('globalSearch.hintChipClose')}
                aria-label={t('globalSearch.hintAriaClose')}
                title={t('globalSearch.hintAriaClose')}
                sx={{ fontSize: '0.65rem', height: 20 }}
              />
              <Typography variant="caption" color="text.secondary">
                {t('globalSearch.shortcutClose')}
              </Typography>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
    </>
  )
}

