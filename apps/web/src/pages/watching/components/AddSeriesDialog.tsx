/**
 * AddSeriesDialog Component
 * 
 * Dialog for searching and adding series to the watching list.
 */

import { useIsPhone } from '@/hooks/useIsPhone'
import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  ListItemSecondaryAction,
  Avatar,
  IconButton,
  Typography,
  CircularProgress,
  Box,
  Chip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import SearchIcon from '@mui/icons-material/Search'
import CloseIcon from '@mui/icons-material/Close'
import { useWatching } from '@/hooks/useWatching'
import { getProxiedImageUrl } from '@aperture/ui'

interface SearchResult {
  id: string
  title: string
  year: number | null
  posterUrl: string | null
  network: string | null
  status: string | null
}

interface AddSeriesDialogProps {
  open: boolean
  onClose: () => void
}

export function AddSeriesDialog({ open, onClose }: AddSeriesDialogProps) {
  const { t } = useTranslation()
  const fullScreen = useIsPhone()
  const { isWatching, addToWatching } = useWatching()
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([])
      return
    }

    setLoading(true)
    try {
      const params = new URLSearchParams({
        search: query,
        pageSize: '20',
      })
      const response = await fetch(`/api/series?${params}`, { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        setResults(data.series.map((s: {
          id: string
          title: string
          year: number | null
          poster_url: string | null
          network: string | null
          status: string | null
        }) => ({
          id: s.id,
          title: s.title,
          year: s.year,
          posterUrl: s.poster_url,
          network: s.network,
          status: s.status,
        })))
      }
    } catch (err) {
      console.error('Search failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearch(value)
    
    // Debounce search
    const timeoutId = setTimeout(() => {
      handleSearch(value)
    }, 300)

    return () => clearTimeout(timeoutId)
  }

  const handleAdd = async (seriesId: string) => {
    setAdding(seriesId)
    try {
      await addToWatching(seriesId)
    } catch (err) {
      console.error('Failed to add series:', err)
    } finally {
      setAdding(null)
    }
  }

  const handleClose = () => {
    setSearch('')
    setResults([])
    onClose()
  }

  return (
    <Dialog
      fullScreen={fullScreen}
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { minHeight: { xs: 0, sm: 400 } },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box component="span" sx={{ flex: 1 }}>
          {t('watching.addDialogTitle')}
        </Box>
        <IconButton onClick={handleClose} aria-label={t('common.close')} edge="end">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          placeholder={t('watching.searchPlaceholder')}
          value={search}
          onChange={handleSearchChange}
          InputProps={{
            startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
          }}
          sx={{ mb: 2 }}
        />

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : results.length === 0 && search ? (
          <Typography color="text.secondary" textAlign="center" py={4}>
            {t('watching.noResultsFor', { query: search })}
          </Typography>
        ) : results.length === 0 ? (
          <Typography color="text.secondary" textAlign="center" py={4}>
            {t('watching.searchPrompt')}
          </Typography>
        ) : (
          <List>
            {results.map((series) => {
              const alreadyWatching = isWatching(series.id)
              const isAdding = adding === series.id

              return (
                <ListItem
                  key={series.id}
                  sx={{
                    borderRadius: 1,
                    mb: 0.5,
                    '&:hover': {
                      backgroundColor: 'action.hover',
                    },
                  }}
                >
                  <ListItemAvatar>
                    <Avatar
                      src={getProxiedImageUrl(series.posterUrl) || undefined}
                      variant="rounded"
                      sx={{ width: 48, height: 72 }}
                    >
                      {series.title[0]}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="subtitle2">{series.title}</Typography>
                        {series.status === 'Continuing' && (
                          <Chip label={t('watching.chipAiringShort')} size="small" color="success" sx={{ height: 20, fontSize: '0.65rem' }} />
                        )}
                      </Box>
                    }
                    secondary={
                      <Typography variant="caption" color="text.secondary">
                        {series.year} {series.network && `• ${series.network}`}
                      </Typography>
                    }
                    sx={{ ml: 1 }}
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      onClick={() => handleAdd(series.id)}
                      disabled={alreadyWatching || isAdding}
                      color={alreadyWatching ? 'success' : 'primary'}
                    >
                      {isAdding ? (
                        <CircularProgress size={20} />
                      ) : alreadyWatching ? (
                        <CheckIcon />
                      ) : (
                        <AddIcon />
                      )}
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              )
            })}
          </List>
        )}
      </DialogContent>
    </Dialog>
  )
}

