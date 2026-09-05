import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import TranslateIcon from '@mui/icons-material/Translate'
import EditIcon from '@mui/icons-material/Edit'
import DownloadIcon from '@mui/icons-material/Download'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { useTranslation } from 'react-i18next'
import { PageHeading } from '@/components/PageHeading'
import { keyAudience, namespaceAudience, type StringAudience } from '@/i18n/audience'
import { useTranslationCatalog } from './useTranslationCatalog'
import { EditKeyDialog } from './EditKeyDialog'
import { CsvImportDialog } from './CsvImportDialog'
import { buildOverridesCsv, downloadCsv } from './csvExport'

const NAMESPACE_ALL = '__all__'
const AUDIENCE_ALL = 'all'

type AudienceFilter = StringAudience | typeof AUDIENCE_ALL

export function TranslationsPage() {
  const { t } = useTranslation()
  const catalog = useTranslationCatalog()
  const { loading, error, locales, defaults, overrides, effective, keys, namespaces } = catalog

  const [search, setSearch] = useState('')
  const [namespace, setNamespace] = useState(NAMESPACE_ALL)
  const [audience, setAudience] = useState<AudienceFilter>(AUDIENCE_ALL)
  const [onlyOverridden, setOnlyOverridden] = useState(false)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(50)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const filteredKeys = useMemo(() => {
    const query = search.trim().toLowerCase()
    return keys.filter((key) => {
      if (audience !== AUDIENCE_ALL && keyAudience(key) !== audience) return false
      if (namespace !== NAMESPACE_ALL && !key.startsWith(`${namespace}.`)) return false
      if (onlyOverridden && !Object.values(overrides).some((locale) => key in locale)) return false
      if (query && !key.toLowerCase().includes(query) && !(defaults.en?.[key] || '').toLowerCase().includes(query)) {
        return false
      }
      return true
    })
  }, [keys, audience, namespace, onlyOverridden, overrides, search, defaults])

  // Narrowed so the namespace list answers the audience already chosen. The
  // selection resets with it rather than being carried across: a MUI Select
  // whose value is absent from its options renders blank, and the next thing
  // the reader does is wonder which namespace they are looking at.
  const visibleNamespaces = useMemo(
    () => (audience === AUDIENCE_ALL ? namespaces : namespaces.filter((ns) => namespaceAudience(ns) === audience)),
    [namespaces, audience]
  )

  const pageKeys = useMemo(
    () => filteredKeys.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [filteredKeys, page, rowsPerPage]
  )

  const overrideCountFor = (key: string) =>
    locales.reduce((count, locale) => count + (overrides[locale.code]?.[key] !== undefined ? 1 : 0), 0)

  // Exports what the table is showing, not the whole catalogue — the point
  // of the audience filter is being able to hand a translator the strings a
  // viewer can actually see. The audience rides in the filename because a
  // partial export is otherwise indistinguishable from a full one.
  const handleExport = () => {
    const csv = buildOverridesCsv(locales, filteredKeys, effective)
    downloadCsv(csv, `aperture-translations-${audience}-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <Box>
      <PageHeading
        title={t('admin.translationsPage.title')}
        description={t('admin.translationsPage.subtitle')}
        icon={<TranslateIcon />}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('admin.translationsPage.loadFailed')}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 2 }}>
        <TextField
          size="small"
          placeholder={t('admin.translationsPage.searchPlaceholder')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(0)
          }}
          sx={{ minWidth: 260 }}
        />
        <FormControl size="small" sx={{ minWidth: 170 }}>
          <InputLabel id="translations-audience-label">{t('admin.translationsPage.audienceLabel')}</InputLabel>
          <Select
            labelId="translations-audience-label"
            label={t('admin.translationsPage.audienceLabel')}
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value as AudienceFilter)
              setNamespace(NAMESPACE_ALL)
              setPage(0)
            }}
          >
            <MenuItem value={AUDIENCE_ALL}>{t('admin.translationsPage.audienceAll')}</MenuItem>
            <MenuItem value="user">{t('admin.translationsPage.audienceUser')}</MenuItem>
            <MenuItem value="admin">{t('admin.translationsPage.audienceAdmin')}</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="translations-namespace-label">{t('admin.translationsPage.namespaceLabel')}</InputLabel>
          <Select
            labelId="translations-namespace-label"
            label={t('admin.translationsPage.namespaceLabel')}
            value={namespace}
            onChange={(e) => {
              setNamespace(e.target.value)
              setPage(0)
            }}
          >
            <MenuItem value={NAMESPACE_ALL}>{t('admin.translationsPage.namespaceAll')}</MenuItem>
            {visibleNamespaces.map((ns) => (
              <MenuItem key={ns} value={ns}>
                {ns}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControlLabel
          control={
            <Checkbox
              checked={onlyOverridden}
              onChange={(e) => {
                setOnlyOverridden(e.target.checked)
                setPage(0)
              }}
            />
          }
          label={t('admin.translationsPage.onlyOverridden')}
        />

        <Box sx={{ display: 'flex', gap: 1, ml: 'auto' }}>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExport} disabled={loading}>
            {t('admin.translationsPage.exportCsv')}
          </Button>
          <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => setImportOpen(true)} disabled={loading}>
            {t('admin.translationsPage.importCsv')}
          </Button>
        </Box>
      </Box>

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <TableContainer sx={{ maxHeight: 600 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>{t('admin.translationsPage.colKey')}</TableCell>
                  <TableCell>{t('admin.translationsPage.colDefault')}</TableCell>
                  <TableCell align="center">{t('admin.translationsPage.colOverrides')}</TableCell>
                  <TableCell align="right">{t('admin.translationsPage.colActions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pageKeys.map((key) => {
                  const count = overrideCountFor(key)
                  return (
                    <TableRow key={key} hover onClick={() => setEditingKey(key)} sx={{ cursor: 'pointer' }}>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{key}</TableCell>
                      <TableCell>
                        <Tooltip title={defaults.en?.[key] || ''}>
                          <Typography
                            variant="body2"
                            sx={{
                              maxWidth: 480,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {defaults.en?.[key]}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell align="center">
                        {count > 0 ? (
                          <Chip size="small" color="primary" label={`${count}/${locales.length}`} />
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            —
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingKey(key)
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {pageKeys.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                        {t('admin.translationsPage.noResults')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={filteredKeys.length}
            page={page}
            onPageChange={(_e, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10))
              setPage(0)
            }}
            rowsPerPageOptions={[25, 50, 100]}
          />
        </>
      )}

      <EditKeyDialog
        open={editingKey !== null}
        keyPath={editingKey}
        onClose={() => setEditingKey(null)}
        catalog={catalog}
      />

      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        catalog={catalog}
      />
    </Box>
  )
}
