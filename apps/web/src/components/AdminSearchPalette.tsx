import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import {
  ADMIN_GROUPS,
  adminEntriesInGroup,
  adminEntryPath,
  type AdminGroupId,
} from '@/pages/admin/nav/registry'
import { ADMIN_ELEMENTS } from '@/pages/admin/nav/elements'
import { searchAdmin, type AdminSearchResult } from '@/pages/admin/nav/search'

/**
 * Jump to any admin destination, or to a named control inside one.
 *
 * Separate from `GlobalSearch` rather than folded into it, and on ⌘⇧K rather
 * than ⌘K, because the two answer different questions and arrive at different
 * speeds: content results come back from a debounced API call, these are
 * computed locally on every keystroke. One list holding both would reorder
 * under the cursor as the slower half landed.
 */

interface AdminSearchPaletteProps {
  open: boolean
  onClose: () => void
}

export function AdminSearchPalette({ open, onClose }: AdminSearchPaletteProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const rowsRef = useRef<(HTMLElement | null)[]>([])

  const results = useMemo(() => (open ? searchAdmin(query, t) : []), [open, query, t])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
  }, [open])

  useEffect(() => {
    setCursor(0)
  }, [query])

  // Twenty results in a scrolling box: arrowing past the fold would otherwise
  // move a selection the reader cannot see, which reads as the arrow keys doing
  // nothing. `nearest` so an already-visible row does not jerk the list.
  useEffect(() => {
    rowsRef.current[cursor]?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const choose = (result: AdminSearchResult) => {
    navigate(result.path)
    onClose()
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((c) => (results.length ? (c + 1) % results.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const picked = results[cursor]
      if (picked) choose(picked)
    }
  }

  const groupLabel = (id: AdminGroupId) =>
    t(ADMIN_GROUPS.find((g) => g.id === id)?.labelKey ?? '')

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      // Sitting the panel near the top keeps the result list in the same place
      // as it grows and shrinks, instead of sliding around a vertical centre.
      sx={{ '& .MuiDialog-container': { alignItems: 'flex-start', pt: '12vh' } }}
      slotProps={{ paper: { sx: { borderRadius: 2 } } }}
    >
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ p: 2, pb: 1 }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('adminNav.searchPlaceholder')}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        {query.trim().length === 0 ? (
          // An empty query shows the shape of the console, not all 41 rows.
          <Box sx={{ px: 2, pb: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {ADMIN_GROUPS.map((group) => {
              const entries = adminEntriesInGroup(group.id)
              if (entries.length === 0) return null
              return (
                <Chip
                  key={group.id}
                  label={`${t(group.labelKey)} · ${entries.length}`}
                  size="small"
                  onClick={() => {
                    navigate(adminEntryPath(entries[0]))
                    onClose()
                  }}
                />
              )
            })}
          </Box>
        ) : results.length === 0 ? (
          <Box sx={{ px: 3, py: 4 }}>
            <Typography variant="body2" color="text.secondary">
              {t('adminNav.searchNoResults', { query: query.trim() })}
            </Typography>
          </Box>
        ) : (
          <List dense sx={{ pt: 0, pb: 1, maxHeight: '52vh', overflowY: 'auto' }}>
            {results.map((result, index) => (
              <ListItemButton
                key={result.key}
                ref={(el: HTMLElement | null) => {
                  rowsRef.current[index] = el
                }}
                selected={index === cursor}
                onMouseEnter={() => setCursor(index)}
                onClick={() => choose(result)}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  {ADMIN_ELEMENTS[result.entryId]?.icon}
                </ListItemIcon>
                <ListItemText
                  primary={
                    result.parentTitle
                      ? // A control is only meaningful with the section it sits
                        // in, and the section name is often what was typed.
                        `${result.parentTitle} › ${result.title}`
                      : result.title
                  }
                  secondary={result.blurb}
                  primaryTypographyProps={{ fontSize: '0.9rem' }}
                  secondaryTypographyProps={{ fontSize: '0.78rem', noWrap: true }}
                />
                <Typography variant="caption" color="text.disabled" sx={{ ml: 2 }}>
                  {groupLabel(result.group)}
                </Typography>
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
    </Dialog>
  )
}
