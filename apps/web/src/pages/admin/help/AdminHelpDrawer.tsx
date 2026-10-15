import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Box, Drawer, IconButton, Tab, Tabs, Tooltip, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { getAdminDoc } from './docs'
import { guideDocPath } from './links'
import { HelpMarkdown } from './HelpMarkdown'

/** Heading ids in the drawer carry this, so they never collide with the section's own. */
const ID_PREFIX = 'admin-help-'

interface AdminHelpDrawerProps {
  open: boolean
  /** The section's pages, from `AdminEntry.docs`; the first opens by default. */
  docs: readonly string[]
  onClose: () => void
}

/**
 * A section's guide pages, read beside the section.
 *
 * Modal on purpose: the console is full of forms, and a panel the page reflows
 * around would squeeze every two-column section into one cramped column. To
 * read and type at once, "Open in a new tab" puts the same page in its own
 * window. Following a link to another admin page swaps the page in place and
 * Back returns; a link to a console section closes the drawer and goes there.
 */
export function AdminHelpDrawer({ open, docs, onClose }: AdminHelpDrawerProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(docs[0])
  const [trail, setTrail] = useState<string[]>([])
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null)

  // The shell keys this component on the section, so a new section starts
  // fresh; this only covers its pages changing under the same key.
  useEffect(() => {
    setActive(docs[0])
    setTrail([])
  }, [docs])

  const scrollTo = useCallback((anchor: string) => {
    document.getElementById(`${ID_PREFIX}${anchor}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (pendingAnchor) {
      // After the swapped page has rendered its headings.
      const frame = requestAnimationFrame(() => {
        scrollTo(pendingAnchor)
        setPendingAnchor(null)
      })
      return () => cancelAnimationFrame(frame)
    }
    bodyRef.current?.scrollTo({ top: 0 })
  }, [active, pendingAnchor, scrollTo])

  const openDoc = useCallback(
    (slug: string, anchor?: string) => {
      if (slug === active) {
        if (anchor) scrollTo(anchor)
        return
      }
      setTrail((prev) => [...prev, active])
      setActive(slug)
      setPendingAnchor(anchor ?? null)
    },
    [active, scrollTo]
  )

  const openSection = useCallback(
    (path: string) => {
      onClose()
      navigate(path)
    },
    [navigate, onClose]
  )

  const goBack = () => {
    const previous = trail[trail.length - 1]
    if (!previous) return
    setTrail(trail.slice(0, -1))
    setActive(previous)
  }

  const doc = getAdminDoc(active)
  const tabValue = docs.includes(active) ? active : false

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      keepMounted
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 560 }, maxWidth: '100%' } } }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
          {trail.length > 0 && (
            <Tooltip title={t('adminDocs.help.back')}>
              <IconButton size="small" onClick={goBack} aria-label={t('adminDocs.help.back')}>
                <ArrowBackIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Box sx={{ flex: 1, minWidth: 0, px: 0.5 }}>
            <Typography variant="caption" color="text.secondary" component="div">
              {t('adminDocs.guide.title')}
            </Typography>
            <Typography variant="subtitle1" fontWeight={700} noWrap>
              {doc?.title ?? active}
            </Typography>
          </Box>
          <Tooltip title={t('adminDocs.help.openInNewTab')}>
            <IconButton
              size="small"
              component="a"
              href={guideDocPath(active)}
              target="_blank"
              rel="noopener"
              aria-label={t('adminDocs.help.openInNewTab')}
            >
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('adminDocs.help.close')}>
            <IconButton size="small" onClick={onClose} aria-label={t('adminDocs.help.close')}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        {docs.length > 1 && (
          <Tabs
            value={tabValue}
            onChange={(_, slug: string) => {
              setTrail([])
              setActive(slug)
            }}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
          >
            {docs.map((slug) => (
              <Tab
                key={slug}
                value={slug}
                label={getAdminDoc(slug)?.title ?? slug}
                sx={{ textTransform: 'none', minHeight: 40, py: 0.5 }}
              />
            ))}
          </Tabs>
        )}

        <Box ref={bodyRef} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2.5, py: 2 }}>
          {doc && (
            <HelpMarkdown
              doc={doc}
              idPrefix={ID_PREFIX}
              // The drawer scrolls itself; there is no app bar above its body.
              scrollMarginTop={8}
              onOpenDoc={openDoc}
              onOpenSection={openSection}
              onAnchor={scrollTo}
            />
          )}
        </Box>
      </Box>
    </Drawer>
  )
}
