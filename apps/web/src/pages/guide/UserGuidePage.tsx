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
import { DocMarkdown } from '@/components/docs/DocMarkdown'
import type { DocPage } from '@/components/docs/pages'
import { userGuidePath } from '@/components/docs/guidePaths'
import { useAuth } from '@/hooks/useAuth'
import { USER_DOC_PAGES, filterUserDocs, getUserDoc, userGuideSections } from './docs'
import { useGuideLanguage } from './useGuideLanguage'
import { userLinkTarget } from './links'
import { appPathIn, screenForDoc } from './routeDocs'

/**
 * `/help` (the contents) and `/help/<page>` (one page; a page in a subfolder
 * keeps it, `/help/user-settings/preferences`).
 *
 * The contents are `docs/user-guide.md`'s own sections, so the guide is
 * grouped and ordered the way it reads on GitHub; the search reads whole
 * pages, since the usual question is "where is the thing that…".
 */
export function UserGuidePage() {
  const slug = useParams()['*']?.replace(/\/+$/, '')
  return slug ? <GuideDoc slug={slug} /> : <GuideIndex />
}

function GuideIndex() {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const language = useGuideLanguage()

  const sections = useMemo(
    () =>
      userGuideSections(language).map((s) => {
        const keep = new Set(filterUserDocs(s.items.map((i) => i.slug), query, language))
        return { ...s, items: s.items.filter((i) => keep.has(i.slug)) }
      }).filter((s) => s.items.length > 0),
    [query, language]
  )

  return (
    <Box>
      <PageHeading title={t('userGuide.title')} description={t('userGuide.blurb')} />

      <TextField
        size="small"
        fullWidth
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('userGuide.index.filter')}
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

      {sections.length === 0 && (
        <Typography color="text.secondary">{t('userGuide.index.noMatches', { query })}</Typography>
      )}

      {sections.map((section) => (
        <Box key={section.heading} sx={{ mb: 4 }}>
          <Typography variant="overline" color="text.secondary" component="h2" sx={{ display: 'block', mb: 1 }}>
            {section.heading}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              // Sized off the pane, not the window: the main pane narrows
              // when the assistant is docked beside it.
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 1.5,
            }}
          >
            {section.items.map((item) => {
              const doc = getUserDoc(item.slug, language)
              if (!doc) return null
              return (
                <Card key={item.slug} variant="outlined">
                  <CardActionArea component={RouterLink} to={userGuidePath(item.slug)} sx={{ height: '100%' }}>
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
                        {item.blurb || doc.summary}
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
  const { user } = useAuth()
  const isAdmin = user?.isAdmin === true
  const navigate = useNavigate()
  const location = useLocation()
  const language = useGuideLanguage()
  const doc = getUserDoc(slug, language)
  const screen = screenForDoc(slug)

  // A page opened at a heading scrolls to it once it has rendered; a new page
  // otherwise starts at its top. Keyed on the location key, so following the
  // same link twice still lands.
  useEffect(() => {
    const anchor = decodeURIComponent(location.hash.slice(1))
    if (!anchor) {
      window.scrollTo({ top: 0 })
      return
    }
    const frame = requestAnimationFrame(() =>
      document.getElementById(anchor)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    )
    return () => cancelAnimationFrame(frame)
  }, [slug, location.hash, location.key])

  const openPage = useCallback((target: string, anchor?: string) => navigate(userGuidePath(target, anchor)), [navigate])
  const openRoute = useCallback((path: string) => navigate(path), [navigate])
  const toAnchor = useCallback((anchor: string) => navigate({ hash: anchor }), [navigate])
  const linkTarget = useCallback(
    (href: string, page: DocPage) => userLinkTarget(href, page.file, (s) => USER_DOC_PAGES.has(s), isAdmin),
    [isAdmin]
  )

  const back = (
    <Button component={RouterLink} to={userGuidePath()} size="small" startIcon={<ArrowBackIcon />}>
      {t('userGuide.page.allPages')}
    </Button>
  )

  if (!doc) {
    return (
      <Box>
        <PageHeading title={t('userGuide.title')} />
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('userGuide.page.notFound', { slug })}
        </Alert>
        {back}
      </Box>
    )
  }

  return (
    <Box sx={{ maxWidth: 900 }}>
      <PageHeading title={doc.title} description={t('userGuide.title')} />

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 2 }}>
        {back}
        <Box sx={{ flex: 1 }} />
        {screen && (
          <Button component={RouterLink} to={screen} size="small" variant="outlined">
            {t('userGuide.page.openScreen')}
          </Button>
        )}
      </Box>

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <DocMarkdown
          doc={doc}
          linkTarget={linkTarget}
          codeRoute={appPathIn}
          textLinkHint={t('userGuide.link.outside')}
          onOpenPage={openPage}
          onNavigate={openRoute}
          onAnchor={toAnchor}
        />
      </Paper>
    </Box>
  )
}
