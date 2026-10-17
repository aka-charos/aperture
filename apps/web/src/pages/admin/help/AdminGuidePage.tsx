import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  InputAdornment,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import SearchIcon from '@mui/icons-material/Search'
import { PageHeading } from '@/components/PageHeading'
import { adminEntryPath, adminPathFor } from '../nav/registry'
import { DocMarkdown } from '@/components/docs/DocMarkdown'
import type { DocPage } from '@/components/docs/pages'
import { ADMIN_DOC_PAGES, filterAdminDocs, getAdminDoc } from './docs'
import { guideSections, sectionsForDoc } from './guide'
import { adminLinkTarget, consolePathIn, guideDocPath } from './links'

/**
 * `/admin/help` (the index) and `/admin/help/:slug` (one page).
 *
 * The index groups pages the way the nav groups sections; the filter reads
 * whole pages, since the usual question is "where is the setting that…".
 */
export function AdminGuidePage() {
  const { slug } = useParams<{ slug?: string }>()
  return slug ? <GuideDoc slug={slug} /> : <GuideIndex />
}

function GuideIndex() {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const sections = useMemo(() => guideSections(), [])

  const filtered = useMemo(
    () =>
      sections
        .map((s) => ({ ...s, docs: filterAdminDocs(s.docs, query) }))
        .filter((s) => s.docs.length > 0),
    [sections, query]
  )

  return (
    <Box>
      <PageHeading title={t('adminDocs.guide.title')} description={t('adminDocs.guide.blurb')} />

      <TextField
        size="small"
        fullWidth
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('adminDocs.index.filter')}
        sx={{ mb: 3, maxWidth: 480 }}
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

      {filtered.length === 0 && (
        <Typography color="text.secondary">{t('adminDocs.index.noMatches', { query })}</Typography>
      )}

      {filtered.map((section) => (
        <Box key={section.id} sx={{ mb: 4 }}>
          <Typography variant="overline" color="text.secondary" component="h2" sx={{ display: 'block', mb: 1 }}>
            {t(section.titleKey)}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              // Sized off the pane, not the window: the console sits beside a
              // nav column and sometimes the assistant dock.
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 1.5,
            }}
          >
            {section.docs.map((docSlug) => {
              const doc = getAdminDoc(docSlug)
              if (!doc) return null
              return (
                <Card key={docSlug} variant="outlined">
                  <CardActionArea component={RouterLink} to={guideDocPath(docSlug)} sx={{ height: '100%' }}>
                    <CardContent>
                      <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                        {doc.title}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {doc.summary}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              )
            })}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

function GuideDoc({ slug }: { slug: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const doc = getAdminDoc(slug)
  const sections = useMemo(() => sectionsForDoc(slug), [slug])

  // A new page starts at its top; a page opened at a heading is scrolled
  // there by the shell, which owns hash scrolling for the whole console.
  useEffect(() => {
    if (!location.hash) window.scrollTo({ top: 0 })
  }, [slug, location.hash])

  const openDoc = useCallback((target: string, anchor?: string) => navigate(guideDocPath(target, anchor)), [navigate])
  const openRoute = useCallback((path: string) => navigate(path), [navigate])
  const linkTarget = useCallback(
    (href: string, page: DocPage) => adminLinkTarget(href, page.file, (s) => ADMIN_DOC_PAGES.has(s)),
    []
  )
  // Through the router rather than scrollIntoView, so the shell flashes the
  // heading and a second click on the same link still lands.
  const toAnchor = useCallback((anchor: string) => navigate({ hash: anchor }), [navigate])

  const back = (
    <Button component={RouterLink} to={adminPathFor('guide')} size="small" startIcon={<ArrowBackIcon />}>
      {t('adminDocs.page.allGuides')}
    </Button>
  )

  if (!doc) {
    return (
      <Box>
        <PageHeading title={t('adminDocs.guide.title')} />
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('adminDocs.page.notFound', { slug })}
        </Alert>
        {back}
      </Box>
    )
  }

  return (
    <Box sx={{ maxWidth: 900 }}>
      <PageHeading title={doc.title} description={t('adminDocs.guide.title')} />

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 2 }}>
        {back}
        <Box sx={{ flex: 1 }} />
        {sections.map((entry) => (
          <Button
            key={entry.id}
            component={RouterLink}
            to={adminEntryPath(entry)}
            size="small"
            variant="outlined"
          >
            {t('adminDocs.page.openSection', { section: t(entry.titleKey) })}
          </Button>
        ))}
      </Box>

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <DocMarkdown
          doc={doc}
          linkTarget={linkTarget}
          codeRoute={consolePathIn}
          textLinkHint={t('adminDocs.link.outside')}
          onOpenPage={openDoc}
          onNavigate={openRoute}
          onAnchor={toAnchor}
        />
      </Paper>
    </Box>
  )
}
