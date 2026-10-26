import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Box,
  Button,
  Drawer,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  MenuItem,
  Paper,
  Select,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'
import EditNoteIcon from '@mui/icons-material/EditNote'
import CloseIcon from '@mui/icons-material/Close'
import ListAltIcon from '@mui/icons-material/ListAlt'
import SearchIcon from '@mui/icons-material/Search'
import { useTranslation } from 'react-i18next'
import { getTextIndex, refreshRenderedStrings, setInlineEditEnabled } from '@/i18n/inlineEdit/store'
import {
  candidateTexts,
  chooseCompareLocale,
  matchTexts,
  type RenderedString,
} from '@/i18n/inlineEdit/textIndex'
import { flattenTranslation, type TranslationTree } from '@/i18n/flatten'
import { useTranslationCatalog } from '@/pages/admin/translations/useTranslationCatalog'
import { InlineStringEditor, type InlineTexts } from './InlineStringEditor'
import { useEditorT, useInlineEdit } from './useInlineEdit'

const COMPARE_STORAGE_KEY = 'aperture-inline-edit-compare'
const UI_ATTRIBUTE = 'data-inline-edit-ui'
/** How far up from the clicked element a label is looked for: an icon inside
 *  a button inside a list item still finds the item's text. */
const MAX_ANCESTORS = 6
const MATCH_ATTRIBUTES = ['placeholder', 'aria-label', 'title', 'alt']
const MAX_CHILD_ELEMENTS = 12
const PANEL_WIDTH = 420

function readStoredCompare(): string | null {
  try {
    return localStorage.getItem(COMPARE_STORAGE_KEY)
  } catch {
    return null
  }
}

function storeCompare(code: string): void {
  try {
    localStorage.setItem(COMPARE_STORAGE_KEY, code)
  } catch {
    // A convenience only.
  }
}

interface Hit {
  element: Element
  matches: RenderedString[]
}

/** The nearest element at or above `start` whose text some key rendered.
 *  textContent, not innerText: innerText applies CSS uppercasing and would
 *  stop an uppercased button matching its own string. */
function findHit(start: EventTarget | null): Hit | null {
  let element = start instanceof Element ? start : null
  const index = getTextIndex()
  for (let depth = 0; element && depth < MAX_ANCESTORS; depth += 1) {
    if (element === document.body || element.closest(`[${UI_ATTRIBUTE}]`)) return null
    let ownText = ''
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) ownText += node.textContent ?? ''
    }
    const texts = candidateTexts({
      ownText,
      // A container's whole text is never a label, and reading it from a
      // page-sized subtree on every mouse move is the expensive part.
      fullText: element.childElementCount > MAX_CHILD_ELEMENTS ? '' : (element.textContent ?? ''),
      attributes: MATCH_ATTRIBUTES.map((name) => element!.getAttribute(name)),
    })
    const match = matchTexts(index, texts)
    if (match) return { element, matches: match.matches }
    element = element.parentElement
  }
  return null
}

interface Outline {
  top: number
  left: number
  width: number
  height: number
  label: string
}

/**
 * Inline text editing, while it is on: hovering a translated string outlines
 * it and names its key, clicking it opens the editor (English beside one
 * other language), and Alt+click reaches the page as normal. A panel lists
 * every string the screen has drawn, for text that cannot be clicked (a
 * tooltip, a closed menu, a toast). Admin-only — Layout mounts it.
 */
export default function InlineEditLayer() {
  const t = useEditorT()
  const { i18n } = useTranslation()
  const theme = useTheme()
  const location = useLocation()
  const { version } = useInlineEdit()
  const catalog = useTranslationCatalog()

  // null until the answer arrives; [] when there is none to have (the
  // request failed, or the instance has not narrowed its languages).
  const [enabledUi, setEnabledUi] = useState<string[] | null>(null)
  // The operator file layer per locale, which the catalog does not carry and
  // the screen shows: without it the editor would offer, and Reset return
  // to, the bundled text rather than what was clicked.
  const [fileLayers, setFileLayers] = useState<Record<string, Record<string, string>>>({})
  const [storedCompare, setStoredCompare] = useState(readStoredCompare)
  const [outline, setOutline] = useState<Outline | null>(null)
  const [editing, setEditing] = useState<RenderedString[] | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const editingRef = useRef(false)
  editingRef.current = editing !== null

  useEffect(() => {
    let cancelled = false
    fetch('/api/settings/language-defaults', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { enabledUiLanguages?: string[] } | null) => {
        if (!cancelled) setEnabledUi(Array.isArray(data?.enabledUiLanguages) ? data.enabledUiLanguages : [])
      })
      .catch(() => {
        if (!cancelled) setEnabledUi([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Languages offered beside English: the ones this instance has switched on,
  // or every language when it has not narrowed the list.
  // Not decided until both lists are in: choosing from every locale while
  // the enabled list is on its way would put Spanish (the first non-English
  // locale) beside English for a moment, and in the editor if clicked then.
  const offered = useMemo(() => {
    if (enabledUi === null || catalog.loading) return null
    const all = catalog.locales.map((l) => l.code)
    const enabled = enabledUi.filter((code) => all.includes(code))
    return enabled.some((code) => code !== 'en') ? enabled : all
  }, [catalog.locales, catalog.loading, enabledUi])
  const compareLocale = offered ? chooseCompareLocale(storedCompare, i18n.language, offered) : null

  // Each locale is asked for once per session of editing; a ref rather than
  // the state, or the first answer re-runs the effect and requests the rest
  // again while they are still in flight.
  const requestedLayers = useRef(new Set<string>())
  useEffect(() => {
    if (!offered) return
    for (const locale of compareLocale ? ['en', compareLocale] : ['en']) {
      if (requestedLayers.current.has(locale)) continue
      requestedLayers.current.add(locale)
      fetch(`/api/i18n/admin/file-overrides/${encodeURIComponent(locale)}`, { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : {}))
        .catch(() => ({}))
        .then((tree: TranslationTree) => {
          // A failed read leaves the bundled text as the baseline, which is
          // right whenever there is no file, the usual case.
          setFileLayers((prev) => ({ ...prev, [locale]: flattenTranslation(tree ?? {}) }))
        })
    }
  }, [offered, compareLocale])

  const texts = useMemo<InlineTexts>(() => {
    const baseline = (locale: string, key: string) =>
      fileLayers[locale]?.[key] ?? catalog.defaults[locale]?.[key] ?? ''
    return {
      baseline,
      current: (locale, key) => catalog.overrides[locale]?.[key] ?? baseline(locale, key),
    }
  }, [fileLayers, catalog.defaults, catalog.overrides])
  const editorReady =
    offered !== null && fileLayers.en !== undefined && (!compareLocale || fileLayers[compareLocale] !== undefined)
  const localeLabel = useCallback(
    (code: string) => catalog.locales.find((l) => l.code === code)?.label ?? code,
    [catalog.locales]
  )

  // A new screen: forget the old one's strings and record what is drawn now.
  useEffect(() => {
    refreshRenderedStrings()
    setOutline(null)
  }, [location.pathname, location.search])

  useEffect(() => {
    let frame = 0
    let lastTarget: EventTarget | null = null
    const onMove = (event: MouseEvent) => {
      lastTarget = event.target
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (editingRef.current) return
        const hit = findHit(lastTarget)
        if (!hit) {
          setOutline(null)
          return
        }
        const rect = hit.element.getBoundingClientRect()
        const extra = hit.matches.length > 1 ? ` +${hit.matches.length - 1}` : ''
        setOutline({ top: rect.top, left: rect.left, width: rect.width, height: rect.height, label: hit.matches[0].key + extra })
      })
    }
    const clear = () => setOutline(null)
    // Pressing a matched control must not also act on it, so the press is
    // stopped before React (listening at the root) sees it. Alt lets it
    // through; mousedown and pointerdown too, or a Select opens anyway.
    const onPress = (event: MouseEvent) => {
      if (event.altKey || event.button !== 0 || editingRef.current) return
      const hit = findHit(event.target)
      if (!hit) return
      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'click') {
        setOutline(null)
        setEditing(hit.matches)
      }
    }
    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('scroll', clear, true)
    window.addEventListener('pointerdown', onPress, true)
    window.addEventListener('mousedown', onPress, true)
    window.addEventListener('click', onPress, true)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('scroll', clear, true)
      window.removeEventListener('pointerdown', onPress, true)
      window.removeEventListener('mousedown', onPress, true)
      window.removeEventListener('click', onPress, true)
    }
  }, [])

  // Built only while the panel is open: closed, a newly recorded key would
  // otherwise refilter and redraw a list nobody is looking at.
  const rendered = useMemo(() => {
    void version
    if (!panelOpen) return []
    const query = filter.trim().toLowerCase()
    return getTextIndex()
      .rendered()
      .filter(
        (entry) =>
          !query ||
          entry.key.toLowerCase().includes(query) ||
          entry.value.toLowerCase().includes(query) ||
          (compareLocale && texts.current(compareLocale, entry.key).toLowerCase().includes(query))
      )
  }, [version, panelOpen, filter, compareLocale, texts])

  const overlayZ = theme.zIndex.tooltip + 1

  return (
    <>
      {outline && !editing && (
        <Box
          aria-hidden
          sx={{
            position: 'fixed',
            top: outline.top - 2,
            left: outline.left - 2,
            width: outline.width + 4,
            height: outline.height + 4,
            border: 2,
            borderColor: 'primary.main',
            borderRadius: 1,
            bgcolor: 'action.hover',
            pointerEvents: 'none',
            zIndex: overlayZ,
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              left: -2,
              ...(outline.top > 24 ? { bottom: '100%', mb: '2px' } : { top: '100%', mt: '2px' }),
              px: 0.75,
              py: 0.25,
              borderRadius: 0.5,
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              fontFamily: 'monospace',
              fontSize: 11,
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
              maxWidth: '80vw',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {outline.label}
          </Box>
        </Box>
      )}

      <Paper
        data-inline-edit-ui
        elevation={8}
        sx={{
          position: 'fixed',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: theme.zIndex.drawer + 1,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
          px: 1.5,
          py: 0.75,
          maxWidth: 'calc(100vw - 32px)',
          borderRadius: 2,
          border: 1,
          borderColor: 'primary.main',
        }}
      >
        <EditNoteIcon color="primary" fontSize="small" />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
            {t('inlineEdit.toolbarTitle')}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' }, lineHeight: 1.3 }}>
            {t('inlineEdit.toolbarHint')}
          </Typography>
        </Box>
        {offered?.some((code) => code !== 'en') && (
          <Tooltip title={t('inlineEdit.compareWith')}>
            <Select
              size="small"
              value={compareLocale ?? ''}
              onChange={(e) => {
                setStoredCompare(e.target.value)
                storeCompare(e.target.value)
              }}
              inputProps={{ 'aria-label': t('inlineEdit.compareWith') }}
              renderValue={(code) => `en + ${code}`}
              sx={{ fontSize: '0.8rem', '& .MuiSelect-select': { py: 0.5 } }}
            >
              {(offered ?? [])
                .filter((code) => code !== 'en')
                .map((code) => (
                  <MenuItem key={code} value={code}>
                    {localeLabel(code)} ({code})
                  </MenuItem>
                ))}
            </Select>
          </Tooltip>
        )}
        <Button
          size="small"
          variant={panelOpen ? 'contained' : 'outlined'}
          startIcon={<ListAltIcon fontSize="small" />}
          onClick={() => setPanelOpen((open) => !open)}
        >
          {t('inlineEdit.stringsOnScreen', { count: getTextIndex().size })}
        </Button>
        <Button size="small" onClick={() => setInlineEditEnabled(false)}>
          {t('inlineEdit.done')}
        </Button>
      </Paper>

      <Drawer
        anchor="right"
        variant="persistent"
        open={panelOpen}
        data-inline-edit-ui
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: PANEL_WIDTH }, top: 0, height: '100%' } } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, pt: 2, pb: 1 }}>
          <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
            {t('inlineEdit.panelTitle')}
          </Typography>
          <IconButton size="small" onClick={() => setPanelOpen(false)} aria-label={t('inlineEdit.closePanel')}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ px: 2, display: 'block' }}>
          {t('inlineEdit.panelHint')}
        </Typography>
        <Box sx={{ px: 2, py: 1.5 }}>
          <TextField
            size="small"
            fullWidth
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('inlineEdit.panelFilter')}
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
        <List dense sx={{ overflowY: 'auto', flex: 1, pt: 0 }}>
          {rendered.map((entry) => {
            const english = texts.current('en', entry.key) || entry.value
            const other = compareLocale ? texts.current(compareLocale, entry.key) : undefined
            return (
              <ListItemButton
                key={entry.key}
                onClick={() => setEditing([entry])}
                sx={{ display: 'block', borderBottom: 1, borderColor: 'divider', py: 1 }}
              >
                <Typography
                  component="code"
                  sx={{ fontFamily: 'monospace', fontSize: 11, color: 'text.secondary', display: 'block', overflowWrap: 'anywhere' }}
                >
                  {entry.key}
                </Typography>
                <Typography variant="body2" lang="en" sx={{ overflowWrap: 'anywhere' }}>
                  {english}
                </Typography>
                {compareLocale && (
                  <Typography
                    variant="body2"
                    lang={compareLocale}
                    sx={{ color: other && other !== english ? 'text.primary' : 'warning.main', overflowWrap: 'anywhere' }}
                  >
                    <Box component="span" sx={{ color: 'text.secondary', fontSize: 11, mr: 0.75 }}>
                      {compareLocale}
                    </Box>
                    {other || '—'}
                  </Typography>
                )}
              </ListItemButton>
            )
          })}
          {rendered.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 3, textAlign: 'center' }}>
              {t('inlineEdit.panelEmpty')}
            </Typography>
          )}
        </List>
      </Drawer>

      {editing && editorReady && (
        <InlineStringEditor
          key={`${editing.map((m) => m.key).join('|')}:${compareLocale ?? ''}`}
          matches={editing}
          compareLocale={compareLocale}
          catalog={catalog}
          texts={texts}
          localeLabel={localeLabel}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
