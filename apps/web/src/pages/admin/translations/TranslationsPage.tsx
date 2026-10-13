import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  LinearProgress,
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
import { countUntranslated, keyMatchesFilter } from './catalogFilter'
import { InlineTranslationCell } from './InlineTranslationCell'

const NAMESPACE_ALL = '__all__'
const AUDIENCE_ALL = 'all'
const LANGUAGE_ALL = '__all__'
// Per-viewer convenience: a translator working through one language should
// come back to it. Never relied on, so every access is guarded.
const LANGUAGE_STORAGE_KEY = 'aperture-translations-language'

type AudienceFilter = StringAudience | typeof AUDIENCE_ALL

function readStoredLanguage(): string {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) || LANGUAGE_ALL
  } catch {
    return LANGUAGE_ALL
  }
}

function storeLanguage(code: string): void {
  try {
    if (code === LANGUAGE_ALL) localStorage.removeItem(LANGUAGE_STORAGE_KEY)
    else localStorage.setItem(LANGUAGE_STORAGE_KEY, code)
  } catch {
    // Storage blocked: the choice simply is not remembered.
  }
}

export function TranslationsPage() {
  const { t } = useTranslation()
  const catalog = useTranslationCatalog()
  const { loading, error, locales, defaults, overrides, effective, keys, namespaces } = catalog

  const [search, setSearch] = useState('')
  const [namespace, setNamespace] = useState(NAMESPACE_ALL)
  const [audience, setAudience] = useState<AudienceFilter>(AUDIENCE_ALL)
  const [storedLanguage, setStoredLanguage] = useState(readStoredLanguage)
  const [onlyOverridden, setOnlyOverridden] = useState(false)
  const [onlyUntranslated, setOnlyUntranslated] = useState(false)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(50)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [listVersion, setListVersion] = useState(0)
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false)

  // English is the default column already, so it is not a language to pick.
  const languageOptions = useMemo(() => locales.filter((l) => l.code !== 'en'), [locales])
  // A remembered language this instance no longer offers reads as "all",
  // rather than a Select whose value is absent from its options (blank).
  const languageLocale = languageOptions.find((l) => l.code === storedLanguage) ?? null
  const language = languageLocale?.code ?? null

  // The text is read through a ref, so the list re-forms when a FILTER
  // changes and not when a string is saved: with "same as English" on, a
  // string translated inline would otherwise vanish from under the cursor
  // the moment it saves, and the next row would jump into its place.
  const textRef = useRef({ effective, overrides })
  textRef.current = { effective, overrides }

  // The filter, applied to whichever text it is handed: the held-still text
  // for the table, the live text for an export.
  const selectKeys = useCallback(
    (text: { effective: Record<string, Record<string, string>>; overrides: Record<string, Record<string, string>> }) => {
      const filter = {
        query: search.trim().toLowerCase(),
        namespace: namespace === NAMESPACE_ALL ? null : namespace,
        locale: language,
        onlyOverridden,
        onlyUntranslated,
      }
      const data = { english: defaults.en ?? {}, ...text }
      return keys.filter((key) => {
        if (audience !== AUDIENCE_ALL && keyAudience(key) !== audience) return false
        return keyMatchesFilter(key, filter, data)
      })
    },
    [keys, audience, namespace, language, onlyOverridden, onlyUntranslated, search, defaults]
  )

  const filteredKeys = useMemo(
    () => selectKeys(textRef.current),
    // `loading` and `listVersion` are dependencies so the list is formed
    // again once the overrides arrive and after an import; the text itself
    // deliberately is not (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectKeys, loading, listVersion]
  )

  // Narrowed so the namespace list answers the audience already chosen. The
  // selection resets with it rather than being carried across: a MUI Select
  // whose value is absent from its options renders blank, and the next thing
  // the reader does is wonder which namespace they are looking at.
  const visibleNamespaces = useMemo(
    () => (audience === AUDIENCE_ALL ? namespaces : namespaces.filter((ns) => namespaceAudience(ns) === audience)),
    [namespaces, audience]
  )

  // The keys the untranslated counts are taken over: the audience and the
  // namespace, which say WHICH strings someone is working on, but not the
  // search or the checkboxes, which only say how they are looking at them.
  const scopeKeys = useMemo(
    () =>
      keys.filter(
        (key) =>
          (audience === AUDIENCE_ALL || keyAudience(key) === audience) &&
          (namespace === NAMESPACE_ALL || key.startsWith(`${namespace}.`))
      ),
    [keys, audience, namespace]
  )

  // Live, unlike the list: each save lowers the count straight away. Only
  // the chosen language is counted on a save; the other languages' counts are
  // for the picker, so they are taken only while its menu is open.
  const untranslatedCount = useMemo(
    () => (language ? countUntranslated(scopeKeys, language, defaults.en ?? {}, effective) : 0),
    [scopeKeys, language, defaults, effective]
  )
  const untranslatedByLanguage = useMemo(() => {
    const counts: Record<string, number> = {}
    if (!languageMenuOpen) return counts
    for (const locale of languageOptions) {
      counts[locale.code] = countUntranslated(scopeKeys, locale.code, defaults.en ?? {}, effective)
    }
    return counts
  }, [languageMenuOpen, scopeKeys, languageOptions, defaults, effective])
  const translatedShare =
    scopeKeys.length > 0 ? Math.floor(((scopeKeys.length - untranslatedCount) / scopeKeys.length) * 100) : 100

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
  // With a language chosen the file is key, en and that language — what one
  // translator works on — and the language rides in the filename too.
  // The rows are chosen again from the LIVE text: the table is held still
  // while editing, so after translating inline under "Only untranslated" it
  // still lists rows that are done, and the file should not.
  const handleExport = () => {
    const csv = buildOverridesCsv(locales, selectKeys({ effective, overrides }), effective, language)
    const scope = language ? `${audience}-${language}` : audience
    downloadCsv(csv, `aperture-translations-${scope}-${new Date().toISOString().slice(0, 10)}.csv`)
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
          placeholder={
            languageLocale
              ? t('admin.translationsPage.searchPlaceholderLanguage', { language: languageLocale.label })
              : t('admin.translationsPage.searchPlaceholder')
          }
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
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel id="translations-language-label">{t('admin.translationsPage.languageLabel')}</InputLabel>
          <Select
            labelId="translations-language-label"
            onOpen={() => setLanguageMenuOpen(true)}
            onClose={() => setLanguageMenuOpen(false)}
            label={t('admin.translationsPage.languageLabel')}
            value={language ?? LANGUAGE_ALL}
            // The menu carries a count per language; the closed box names one.
            renderValue={(value) =>
              value === LANGUAGE_ALL
                ? t('admin.translationsPage.languageAll')
                : `${languageLocale?.label ?? value} (${value})`
            }
            onChange={(e) => {
              const code = e.target.value
              setStoredLanguage(code)
              storeLanguage(code)
              if (code === LANGUAGE_ALL) setOnlyUntranslated(false)
              setPage(0)
            }}
          >
            <MenuItem value={LANGUAGE_ALL}>{t('admin.translationsPage.languageAll')}</MenuItem>
            {languageOptions.map((locale) => (
              <MenuItem key={locale.code} value={locale.code}>
                <Box sx={{ display: 'flex', width: '100%', gap: 2, justifyContent: 'space-between' }}>
                  <span>
                    {locale.label} ({locale.code})
                  </span>
                  {!loading && untranslatedByLanguage[locale.code] !== undefined && (
                    <Typography variant="caption" color="text.secondary">
                      {t('admin.translationsPage.untranslatedShort', {
                        count: untranslatedByLanguage[locale.code] ?? 0,
                      })}
                    </Typography>
                  )}
                </Box>
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
        {languageLocale && (
          <Tooltip title={t('admin.translationsPage.onlyUntranslatedHint')}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={onlyUntranslated}
                  onChange={(e) => {
                    setOnlyUntranslated(e.target.checked)
                    setPage(0)
                  }}
                />
              }
              label={t('admin.translationsPage.onlyUntranslated')}
            />
          </Tooltip>
        )}

        <Box sx={{ display: 'flex', gap: 1, ml: 'auto' }}>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExport} disabled={loading}>
            {t('admin.translationsPage.exportCsv')}
          </Button>
          <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => setImportOpen(true)} disabled={loading}>
            {t('admin.translationsPage.importCsv')}
          </Button>
        </Box>
      </Box>

      {languageLocale && !loading && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 2 }}>
          <Box sx={{ flex: '1 1 260px', minWidth: 200, maxWidth: 480 }}>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              {untranslatedCount === 0
                ? t('admin.translationsPage.untranslatedNone', { language: languageLocale.label })
                : t('admin.translationsPage.untranslatedSummary', {
                    count: untranslatedCount,
                    total: scopeKeys.length,
                    language: languageLocale.label,
                    percent: translatedShare,
                  })}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={translatedShare}
              color={untranslatedCount === 0 ? 'success' : 'primary'}
              sx={{ height: 6, borderRadius: 3 }}
            />
          </Box>
          {untranslatedCount > 0 && (
            <Chip
              clickable
              color={onlyUntranslated ? 'primary' : 'default'}
              variant={onlyUntranslated ? 'filled' : 'outlined'}
              label={
                onlyUntranslated
                  ? t('admin.translationsPage.showAllStrings')
                  : t('admin.translationsPage.showUntranslated', { count: untranslatedCount })
              }
              onClick={() => {
                setOnlyUntranslated((on) => !on)
                setPage(0)
              }}
            />
          )}
        </Box>
      )}

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
                  <TableCell sx={languageLocale ? { width: '22%' } : undefined}>
                    {t('admin.translationsPage.colKey')}
                  </TableCell>
                  <TableCell sx={languageLocale ? { width: '33%' } : undefined}>
                    {t('admin.translationsPage.colDefault')}
                  </TableCell>
                  {languageLocale ? (
                    <TableCell>
                      {languageLocale.label} ({languageLocale.code})
                    </TableCell>
                  ) : (
                    <TableCell align="center">{t('admin.translationsPage.colOverrides')}</TableCell>
                  )}
                  <TableCell align="right">{t('admin.translationsPage.colActions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pageKeys.map((key) => {
                  const count = overrideCountFor(key)
                  return (
                    <TableRow key={key} hover onClick={() => setEditingKey(key)} sx={{ cursor: 'pointer' }}>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                        {key}
                      </TableCell>
                      <TableCell>
                        {languageLocale ? (
                          // Translating needs the whole sentence, so it wraps here.
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                            {effective.en?.[key]}
                          </Typography>
                        ) : (
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
                        )}
                      </TableCell>
                      {languageLocale ? (
                        <TableCell>
                          <InlineTranslationCell keyPath={key} locale={languageLocale.code} catalog={catalog} />
                        </TableCell>
                      ) : (
                        <TableCell align="center">
                          {count > 0 ? (
                            <Chip size="small" color="primary" label={`${count}/${locales.length}`} />
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              —
                            </Typography>
                          )}
                        </TableCell>
                      )}
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
        onClose={() => {
          setImportOpen(false)
          // An import changes text the list is filtered on; form it again.
          setListVersion((v) => v + 1)
        }}
        catalog={catalog}
      />
    </Box>
  )
}
