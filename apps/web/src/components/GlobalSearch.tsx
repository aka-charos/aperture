import { useIsPhone } from '@/hooks/useIsPhone'
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
  ButtonBase,
  ListSubheader,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import ManageSearchIcon from '@mui/icons-material/ManageSearch'
import CollectionsBookmarkIcon from '@mui/icons-material/CollectionsBookmark'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import CloseIcon from '@mui/icons-material/Close'
import { getProxiedImageUrl } from '@aperture/ui'
import { matchSearchShortcut } from '@/lib/searchShortcut'
import { usePersonPortrait } from '@/hooks/usePersonPortrait'
import type { BrowsePerson } from '@/pages/browse/types'
import { personSubtitle } from '@/pages/browse/utils/personSubtitle'

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

interface FranchiseResult {
  /** The TMDb collection id `/franchises/:id` takes. */
  id: string
  name: string
  movieCount: number
  posterUrl: string | null
}

interface NameResults {
  people: BrowsePerson[]
  franchises: FranchiseResult[]
}

const NO_NAMES: NameResults = { people: [], franchises: [] }

/**
 * One list for the arrow keys, in the order the sections are drawn: people,
 * franchises, then titles. Names come first because they are few and short,
 * and a name someone typed on purpose ("nolan") would otherwise sit below ten
 * of that person's films.
 */
type PaletteEntry =
  | { kind: 'person'; person: BrowsePerson }
  | { kind: 'franchise'; franchise: FranchiseResult }
  | { kind: 'title'; result: SearchResult }

export function GlobalSearch() {
  const { t } = useTranslation()
  const fullScreen = useIsPhone()
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
  const [names, setNames] = useState<NameResults>(NO_NAMES)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const hasTerm = query.trim().length >= 2

  // Arrow keys move the highlight; without this it walks off the bottom of
  // the list and the reader cannot see what Enter would open.
  useEffect(() => {
    if (selectedIndex < 0) {
      resultsRef.current?.scrollTo({ top: 0 })
      return
    }
    resultsRef.current
      ?.querySelector(`[data-result-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const handleClose = useCallback(() => {
    setOpen(false)
    setQuery('')
    setResults([])
    setNames(NO_NAMES)
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
      setNames(NO_NAMES)
      setStatus('idle')
      setSelectedIndex(-1)
      return
    }

    // Pending from the first keystroke, so the previous query's "no results"
    // never shows under the new query while the debounce runs.
    setStatus('loading')
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      const q = encodeURIComponent(term)
      // Names are a second request so a failure there costs two sections, not
      // the answer: the status follows the title search alone.
      const namesRequest = fetch(`/api/search/names?q=${q}`, {
        credentials: 'include',
        signal: controller.signal,
      })
        .then((res) => (res.ok ? (res.json() as Promise<NameResults>) : NO_NAMES))
        .catch(() => NO_NAMES)
      try {
        const res = await fetch(`/api/search?q=${q}&limit=10`, {
          credentials: 'include',
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`Search failed with HTTP ${res.status}`)
        const data = (await res.json()) as { results: SearchResult[] }
        const nameData = await namesRequest
        if (controller.signal.aborted) return
        setResults(data.results)
        setNames({ people: nameData.people ?? [], franchises: nameData.franchises ?? [] })
        setStatus('done')
      } catch {
        if (controller.signal.aborted) return
        setResults([])
        setNames(NO_NAMES)
        setStatus('error')
      }
      setSelectedIndex(-1)
    }, 200)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const entries = useMemo<PaletteEntry[]>(
    () => [
      ...names.people.map((person) => ({ kind: 'person' as const, person })),
      ...names.franchises.map((franchise) => ({ kind: 'franchise' as const, franchise })),
      ...results.map((result) => ({ kind: 'title' as const, result })),
    ],
    [names, results]
  )
  const franchiseOffset = names.people.length
  const titleOffset = franchiseOffset + names.franchises.length

  const handleEntryClick = useCallback(
    (entry: PaletteEntry) => {
      if (entry.kind === 'person') {
        navigate(`/person/${encodeURIComponent(entry.person.name)}`)
      } else if (entry.kind === 'franchise') {
        navigate(`/franchises/${encodeURIComponent(entry.franchise.id)}`)
      } else {
        navigate(`/${entry.result.type === 'movie' ? 'movies' : 'series'}/${entry.result.id}`)
      }
      handleClose()
    },
    [navigate, handleClose]
  )

  const handleResultClick = useCallback(
    (result: SearchResult) => handleEntryClick({ kind: 'title', result }),
    [handleEntryClick]
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
        setSelectedIndex((prev) => Math.min(prev + 1, entries.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, -1))
      } else if (e.key === 'Enter' && query.trim()) {
        e.preventDefault()
        if (selectedIndex >= 0 && selectedIndex < entries.length) {
          handleEntryClick(entries[selectedIndex])
        } else {
          handleViewAllResults()
        }
      }
    },
    [entries, selectedIndex, handleEntryClick, handleViewAllResults, query]
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
        fullScreen={fullScreen}
        open={open}
        onClose={handleClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: fullScreen ? 0 : 3,
            maxHeight: fullScreen ? 'none' : '80dvh',
          },
        }}
      >
        {/*
          * One scroll area, not two: the content is a column whose only
          * scrolling child is the result list, so the input, the "view all"
          * row and the shortcut hints stay put while the results move.
          */}
        <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Search Input */}
          <Box
            sx={{
              p: 2,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
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
            {/* Full screen has no backdrop to tap and a phone has no Esc key. */}
            {fullScreen && (
              <IconButton onClick={handleClose} aria-label={t('common.close')} edge="end">
                <CloseIcon />
              </IconButton>
            )}
          </Box>

          {/*
            * The way to the full search page sits under the input, not after
            * the results: below ten results it was off-screen, so the one link
            * that offers filters and AI search was the last thing anyone found.
            * Highlighted while no result is selected, because that is when
            * Enter opens it.
            */}
          {hasTerm && (
            <ButtonBase
              onClick={handleViewAllResults}
              sx={{
                flexShrink: 0,
                width: '100%',
                justifyContent: 'flex-start',
                gap: 1,
                px: 2.5,
                py: 1.25,
                color: 'primary.main',
                bgcolor: selectedIndex === -1 ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) },
              }}
            >
              <ManageSearchIcon fontSize="small" />
              <Typography variant="body2" fontWeight={500} noWrap sx={{ minWidth: 0 }}>
                {t('globalSearch.viewAllForQuery', { query: query.trim() })}
              </Typography>
            </ButtonBase>
          )}

          {/* Results */}
          <Box
            ref={resultsRef}
            sx={{ flex: 1, minHeight: 0, overflowY: 'auto', borderTop: 1, borderColor: 'divider' }}
          >
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

            {status === 'done' && entries.length === 0 && (
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

            {names.people.length > 0 && (
              <List sx={{ py: 0 }} subheader={<SectionHeader label={t('globalSearch.sectionPeople')} />}>
                {names.people.map((person, index) => (
                  <PersonResultRow
                    key={person.name}
                    person={person}
                    index={index}
                    selected={index === selectedIndex}
                    onSelect={() => handleEntryClick({ kind: 'person', person })}
                  />
                ))}
              </List>
            )}

            {names.franchises.length > 0 && (
              <List sx={{ py: 0 }} subheader={<SectionHeader label={t('globalSearch.sectionFranchises')} />}>
                {names.franchises.map((franchise, index) => (
                  <CompactRow
                    key={franchise.id}
                    index={franchiseOffset + index}
                    selected={franchiseOffset + index === selectedIndex}
                    onSelect={() => handleEntryClick({ kind: 'franchise', franchise })}
                    avatar={
                      <Avatar
                        variant="rounded"
                        src={getProxiedImageUrl(franchise.posterUrl)}
                        sx={{ width: 32, height: 48, borderRadius: 0.5 }}
                      >
                        <CollectionsBookmarkIcon fontSize="small" />
                      </Avatar>
                    }
                    primary={franchise.name}
                    secondary={t('globalSearch.franchiseMovies', { count: franchise.movieCount })}
                  />
                ))}
              </List>
            )}

            {results.length > 0 && (
                <List
                  sx={{ py: 0 }}
                  subheader={
                    titleOffset > 0 ? <SectionHeader label={t('globalSearch.sectionTitles')} /> : undefined
                  }
                >
                  {results.map((result, resultIndex) => {
                    const index = titleOffset + resultIndex
                    return (
                    <ListItem
                      key={`${result.type}-${result.id}`}
                      data-result-index={index}
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
                            <Box display="flex" flexWrap="wrap" gap={1} mt={0.5}>
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
                    )
                  })}
                </List>
            )}
          </Box>

          {/* Keyboard shortcuts hint — meaningless on a phone */}
          <Box
            sx={{
              ...(fullScreen && { display: 'none' }),
              flexShrink: 0,
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


function SectionHeader({ label }: { label: string }) {
  return (
    <ListSubheader
      disableSticky
      sx={{
        lineHeight: 1,
        pt: 1.5,
        pb: 0.75,
        bgcolor: 'transparent',
        fontSize: '0.7rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'text.secondary',
      }}
    >
      {label}
    </ListSubheader>
  )
}

interface CompactRowProps {
  index: number
  selected: boolean
  onSelect: () => void
  avatar: React.ReactNode
  primary: string
  secondary: string
}

/** A one-line row for a name: shorter than a title row, since a name has no genres, scores or year. */
function CompactRow({ index, selected, onSelect, avatar, primary, secondary }: CompactRowProps) {
  const theme = useTheme()
  return (
    <ListItem
      data-result-index={index}
      onClick={onSelect}
      sx={{
        cursor: 'pointer',
        py: 0.75,
        gap: 1.5,
        bgcolor: selected ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
        '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) },
      }}
    >
      <Box sx={{ width: 48, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>{avatar}</Box>
      <ListItemText
        primary={primary}
        secondary={secondary}
        primaryTypographyProps={{ fontWeight: 500, noWrap: true }}
        secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
        sx={{ minWidth: 0, my: 0 }}
      />
    </ListItem>
  )
}

interface PersonResultRowProps {
  person: BrowsePerson
  index: number
  selected: boolean
  onSelect: () => void
}

/** The portrait Browse → People shows: the media server's, then TMDb's. */
function PersonResultRow({ person, index, selected, onSelect }: PersonResultRowProps) {
  const { t } = useTranslation()
  const { displaySrc, phase, onImageError } = usePersonPortrait({
    personName: person.name,
    mediaImageUrl: `/api/media/images/Persons/${encodeURIComponent(person.name)}/Images/Primary`,
    fetchTmdbFallback: true,
  })
  return (
    <CompactRow
      index={index}
      selected={selected}
      onSelect={onSelect}
      avatar={
        <Avatar
          src={phase === 'none' ? undefined : displaySrc}
          onError={onImageError}
          alt=""
          sx={{ width: 40, height: 40 }}
        >
          {person.name.charAt(0)}
        </Avatar>
      }
      primary={person.name}
      secondary={personSubtitle(person, t)}
    />
  )
}
