import { useState } from 'react'
import Papa from 'papaparse'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { useTranslation } from 'react-i18next'
import { diffInterpolationTokens } from '../../../i18n/flatten'
import type { TranslationCatalog } from './useTranslationCatalog'

interface CsvImportDialogProps {
  open: boolean
  onClose: () => void
  catalog: TranslationCatalog
}

type RowStatus = 'update' | 'reset' | 'unchanged' | 'skipped'

interface PlannedRow {
  key: string
  locale: string
  status: RowStatus
  value: string | null
  hasTokenIssue: boolean
}

interface ImportPlan {
  rows: PlannedRow[]
  unknownKeys: string[]
  unrecognizedColumns: string[]
}

const CHUNK_SIZE = 1000
const PREVIEW_LIMIT = 500

function buildPlan(
  parsed: Record<string, string>[],
  fields: string[],
  catalog: TranslationCatalog
): ImportPlan {
  const { keys, locales, effective, overrides } = catalog
  const knownKeys = new Set(keys)
  const knownLocales = new Set(locales.map((l) => l.code))
  const localeColumns = fields.filter((f) => f !== 'key')
  const unrecognizedColumns = localeColumns.filter((f) => !knownLocales.has(f))
  const rows: PlannedRow[] = []
  const unknownKeys: string[] = []

  for (const row of parsed) {
    const key = (row.key || '').trim()
    if (!key) continue
    if (!knownKeys.has(key)) {
      unknownKeys.push(key)
      continue
    }
    const enReference = row.en !== undefined ? row.en : effective.en?.[key] ?? ''
    for (const column of localeColumns) {
      if (!knownLocales.has(column)) continue
      const cell = row[column] ?? ''
      const current = effective[column]?.[key] ?? ''
      const hasOverride = overrides[column]?.[key] !== undefined

      let status: RowStatus
      let value: string | null = null
      if (cell === current) {
        status = 'unchanged'
      } else if (cell.trim() === '') {
        status = hasOverride ? 'reset' : 'unchanged'
        value = null
      } else {
        status = 'update'
        value = cell
      }

      const hasTokenIssue =
        status !== 'unchanged' && column !== 'en' ? diffTokensNonEmpty(enReference, cell || current) : false

      rows.push({ key, locale: column, status, value, hasTokenIssue })
    }
  }

  return { rows, unknownKeys, unrecognizedColumns }
}

function diffTokensNonEmpty(reference: string, value: string): boolean {
  const diff = diffInterpolationTokens(reference, value)
  return diff.missing.length > 0 || diff.extra.length > 0
}

export function CsvImportDialog({ open, onClose, catalog }: CsvImportDialogProps) {
  const { t } = useTranslation()
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<{ upserted: number; deleted: number } | null>(null)

  const reset = () => {
    setPlan(null)
    setParseError(null)
    setImportError(null)
    setImportResult(null)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    reset()
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          setParseError(results.errors[0].message)
          return
        }
        const fields = results.meta.fields || []
        if (!fields.includes('key')) {
          setParseError(t('admin.translationsPage.import.missingKeyColumn'))
          return
        }
        setPlan(buildPlan(results.data, fields, catalog))
      },
      error: (err) => setParseError(err.message),
    })
  }

  const actionableRows = plan ? plan.rows.filter((r) => r.status === 'update' || r.status === 'reset') : []
  const updateCount = plan ? plan.rows.filter((r) => r.status === 'update').length : 0
  const resetCount = plan ? plan.rows.filter((r) => r.status === 'reset').length : 0
  const unchangedCount = plan ? plan.rows.filter((r) => r.status === 'unchanged').length : 0
  const tokenWarningCount = plan ? plan.rows.filter((r) => r.hasTokenIssue).length : 0

  const handleConfirm = async () => {
    if (!plan || actionableRows.length === 0) return
    setImporting(true)
    setImportError(null)
    let upserted = 0
    let deleted = 0
    try {
      for (let i = 0; i < actionableRows.length; i += CHUNK_SIZE) {
        const chunk = actionableRows.slice(i, i + CHUNK_SIZE)
        const res = await fetch('/api/i18n/admin/overrides/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            overrides: chunk.map((r) => ({ locale: r.locale, key: r.key, value: r.value })),
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error((err as { error?: string }).error || t('admin.translationsPage.import.error'))
        }
        const data: { upserted: number; deleted: number } = await res.json()
        upserted += data.upserted
        deleted += data.deleted
      }
      await catalog.refetchOverrides()
      setImportResult({ upserted, deleted })
      setPlan(null)
    } catch (err) {
      setImportError((err as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const previewRows = plan
    ? plan.rows.filter((r) => r.status !== 'unchanged').slice(0, PREVIEW_LIMIT)
    : []

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('admin.translationsPage.import.title')}</DialogTitle>
      <DialogContent dividers>
        {!plan && !importResult && (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <Button variant="outlined" component="label" startIcon={<UploadFileIcon />}>
              {t('admin.translationsPage.import.chooseFile')}
              <input type="file" hidden accept=".csv" onChange={handleFile} />
            </Button>
            {parseError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {parseError}
              </Alert>
            )}
          </Box>
        )}

        {plan && (
          <>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
              <Chip
                color="primary"
                label={t('admin.translationsPage.import.updateLabel', { count: updateCount })}
              />
              <Chip label={t('admin.translationsPage.import.resetLabel', { count: resetCount })} />
              <Chip
                variant="outlined"
                label={t('admin.translationsPage.import.unchangedLabel', { count: unchangedCount })}
              />
              {plan.unknownKeys.length > 0 && (
                <Chip
                  color="warning"
                  label={t('admin.translationsPage.import.skippedLabel', { count: plan.unknownKeys.length })}
                />
              )}
              {tokenWarningCount > 0 && (
                <Chip color="warning" label={t('admin.translationsPage.import.tokenWarningCount', { count: tokenWarningCount })} />
              )}
            </Stack>

            {plan.unrecognizedColumns.length > 0 && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('admin.translationsPage.import.unrecognizedColumns', {
                  columns: plan.unrecognizedColumns.join(', '),
                })}
              </Alert>
            )}

            {(previewRows.length > 0 || plan.unknownKeys.length > 0) && (
              <List dense sx={{ maxHeight: 320, overflow: 'auto', bgcolor: 'background.default', borderRadius: 1 }}>
                {previewRows.map((row, idx) => (
                  <ListItem key={`${row.key}-${row.locale}-${idx}`}>
                    <ListItemText
                      primaryTypographyProps={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                      primary={`${row.key} · ${row.locale}`}
                      secondary={
                        <>
                          {row.status === 'reset'
                            ? t('admin.translationsPage.import.resetLabel', { count: 1 })
                            : t('admin.translationsPage.import.updateLabel', { count: 1 })}
                          {row.hasTokenIssue && ` — ${t('admin.translationsPage.import.tokenWarning')}`}
                        </>
                      }
                    />
                  </ListItem>
                ))}
                {plan.unknownKeys.slice(0, PREVIEW_LIMIT - previewRows.length).map((key) => (
                  <ListItem key={key}>
                    <ListItemText
                      primaryTypographyProps={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                      primary={key}
                      secondary={t('admin.translationsPage.import.skippedUnknownKey')}
                    />
                  </ListItem>
                ))}
              </List>
            )}
            {plan.rows.filter((r) => r.status !== 'unchanged').length + plan.unknownKeys.length > PREVIEW_LIMIT && (
              <Typography variant="caption" color="text.secondary">
                {t('admin.translationsPage.import.moreRows', {
                  count: plan.rows.filter((r) => r.status !== 'unchanged').length + plan.unknownKeys.length - PREVIEW_LIMIT,
                })}
              </Typography>
            )}

            {importError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {importError}
              </Alert>
            )}
          </>
        )}

        {importResult && (
          <Alert severity="success">
            {t('admin.translationsPage.import.success', {
              upserted: importResult.upserted,
              deleted: importResult.deleted,
            })}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t('admin.translationsPage.import.cancel')}</Button>
        {plan && (
          <Button
            variant="contained"
            onClick={() => void handleConfirm()}
            disabled={importing || actionableRows.length === 0}
            startIcon={importing ? <CircularProgress size={16} /> : undefined}
          >
            {importing ? t('admin.translationsPage.import.importing') : t('admin.translationsPage.import.confirm')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
