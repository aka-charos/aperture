import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { getProxiedImageUrl } from '@aperture/ui'
import { useLibraryTitleSearch, type LibrarySearchHit } from '@/hooks/useLibraryTitleSearch'
import type { TitleCardAttrs } from './fields'
import { TitleFieldPicker } from './TitleFieldPicker'

/** Find a library title and choose what its card shows. */
export function TitlePickerDialog({
  open,
  availableFields,
  defaultFields,
  analysisParts: availableParts,
  onClose,
  onInsert,
}: {
  open: boolean
  availableFields: string[]
  defaultFields: string[]
  analysisParts: { movie: string[]; series: string[] }
  onClose: () => void
  onInsert: (attrs: TitleCardAttrs) => void
}) {
  const { t } = useTranslation()
  const [term, setTerm] = useState('')
  const [picked, setPicked] = useState<LibrarySearchHit | null>(null)
  const [fields, setFields] = useState<string[]>(defaultFields)
  const [analysisParts, setAnalysisParts] = useState<string[]>([])
  const { hits, loading, tooShort } = useLibraryTitleSearch(term, { limit: 12, enabled: open })

  // Each opening starts fresh, with the fields the server suggests.
  useEffect(() => {
    if (!open) return
    setTerm('')
    setPicked(null)
    setFields(defaultFields)
    setAnalysisParts([])
  }, [open, defaultFields])

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('newsletters.picker.title')}</DialogTitle>
      <DialogContent dividers>
        <TextField
          autoFocus
          fullWidth
          size="small"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value)
            setPicked(null)
          }}
          placeholder={t('newsletters.picker.search')}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                {loading ? <CircularProgress size={16} /> : <SearchIcon fontSize="small" />}
              </InputAdornment>
            ),
          }}
        />
        {!picked && (
          <List dense sx={{ mt: 1, maxHeight: 320, overflowY: 'auto' }}>
            {hits.map((hit) => (
              <ListItemButton
                key={`${hit.type}:${hit.id}`}
                onClick={() => {
                  setPicked(hit)
                  // Parts belong to a media type (a show has a structure part, a film
                  // does not), so a choice made for another title does not carry over.
                  setAnalysisParts([])
                }}
              >
                <ListItemAvatar>
                  <Avatar
                    variant="rounded"
                    src={hit.poster_url ? getProxiedImageUrl(hit.poster_url) : undefined}
                    sx={{ width: 32, height: 48 }}
                  />
                </ListItemAvatar>
                <ListItemText
                  primary={`${hit.title}${hit.year ? ` (${hit.year})` : ''}`}
                  secondary={t(hit.type === 'series' ? 'newsletters.editor.series' : 'newsletters.editor.movie')}
                />
              </ListItemButton>
            ))}
            {!tooShort && !loading && hits.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                {t('newsletters.picker.noResults')}
              </Typography>
            )}
          </List>
        )}
        {picked && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2">
              {picked.title}
              {picked.year ? ` (${picked.year})` : ''}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('newsletters.picker.chooseFields')}
            </Typography>
            <TitleFieldPicker
              fields={fields}
              available={availableFields}
              mediaType={picked.type}
              onChange={setFields}
              analysisParts={analysisParts}
              availableAnalysisParts={availableParts[picked.type]}
              onAnalysisPartsChange={setAnalysisParts}
            />
            {fields.includes('fullPlot') && (
              <Typography variant="caption" color="warning.main" component="p" sx={{ mt: 1 }}>
                {t('newsletters.editor.fullPlotWarning')}
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {picked && <Button onClick={() => setPicked(null)}>{t('newsletters.picker.back')}</Button>}
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!picked || fields.length === 0}
          onClick={() =>
            picked &&
            onInsert({
              mediaType: picked.type,
              id: picked.id,
              title: picked.title,
              year: picked.year,
              posterUrl: picked.poster_url,
              fields,
              analysisParts: analysisParts.filter((part) => availableParts[picked.type].includes(part)),
            })
          }
        >
          {t('newsletters.picker.insert')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
