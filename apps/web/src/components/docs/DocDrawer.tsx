import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Drawer, IconButton, Tab, Tabs, Tooltip, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import type { DocLinkTarget } from './docLinks'
import { DocMarkdown } from './DocMarkdown'
import type { DocPage, DocPages } from './pages'

/** The words the drawer shows; each guide passes its own, from its own namespace. */
export interface DocDrawerLabels {
  guide: string
  back: string
  openInNewTab: string
  close: string
  textLinkHint: string
  /** Heading of the strip of section links on a long page. */
  onThisPage?: string
}

interface DocDrawerProps {
  open: boolean
  /** The pages offered here; the first opens by default, and several become tabs. */
  slugs: readonly string[]
  pages: DocPages
  /** The guide page's own address, for "open in a new tab". */
  pagePath: (slug: string) => string
  linkTarget: (href: string, page: DocPage) => DocLinkTarget
  codeRoute?: (text: string) => string | null
  /** Prepended to heading ids, so they never collide with the page underneath. */
  idPrefix: string
  labels: DocDrawerLabels
  /** A heading on the first page to open at, as the page's own heading id. */
  initialAnchor?: string
  /** Shown in the header beside the page title (the user guide's "Show me around"). */
  headerAction?: ReactNode
  onClose: () => void
}

/**
 * Guide pages read beside the screen they describe, for either guide.
 *
 * Modal on purpose: the console is full of forms, and a panel the page reflows
 * around would squeeze every two-column section into one cramped column. To
 * read and act at once, "Open in a new tab" puts the same page in its own
 * window. A link to another page of the guide swaps the page in place and
 * Back returns; a link anywhere else in the app closes the drawer and goes
 * there.
 */
export function DocDrawer({
  open,
  slugs,
  pages,
  pagePath,
  linkTarget,
  codeRoute,
  idPrefix,
  labels,
  initialAnchor,
  headerAction,
  onClose,
}: DocDrawerProps) {
  const navigate = useNavigate()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(slugs[0])
  const [trail, setTrail] = useState<string[]>([])
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(initialAnchor ?? null)

  // The host keys this component on the screen it describes, so a new screen
  // starts fresh; this only covers its pages changing under the same key.
  useEffect(() => {
    setActive(slugs[0])
    setTrail([])
  }, [slugs])

  const scrollTo = useCallback(
    (anchor: string) => {
      document.getElementById(`${idPrefix}${anchor}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    },
    [idPrefix]
  )

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

  const openPage = useCallback(
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

  const goTo = useCallback(
    (href: string) => {
      onClose()
      navigate(href)
    },
    [navigate, onClose]
  )

  const goBack = () => {
    const previous = trail[trail.length - 1]
    if (!previous) return
    setTrail(trail.slice(0, -1))
    setActive(previous)
  }

  const doc = pages.get(active)
  const tabValue = slugs.includes(active) ? active : false

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      keepMounted
      // Above a dialog: a title page opens in one, and its inline ? icons
      // open this drawer, which would otherwise slide in behind it.
      sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 560 }, maxWidth: '100%' } } }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
          {trail.length > 0 && (
            <Tooltip title={labels.back}>
              <IconButton size="small" onClick={goBack} aria-label={labels.back}>
                <ArrowBackIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Box sx={{ flex: 1, minWidth: 0, px: 0.5 }}>
            <Typography variant="caption" color="text.secondary" component="div">
              {labels.guide}
            </Typography>
            <Typography variant="subtitle1" fontWeight={700} noWrap>
              {doc?.title ?? active}
            </Typography>
          </Box>
          {headerAction}
          <Tooltip title={labels.openInNewTab}>
            <IconButton
              size="small"
              component="a"
              href={pagePath(active)}
              target="_blank"
              rel="noopener"
              aria-label={labels.openInNewTab}
            >
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={labels.close}>
            <IconButton size="small" onClick={onClose} aria-label={labels.close}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        {slugs.length > 1 && (
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
            {slugs.map((slug) => (
              <Tab
                key={slug}
                value={slug}
                label={pages.get(slug)?.title ?? slug}
                sx={{ textTransform: 'none', minHeight: 40, py: 0.5 }}
              />
            ))}
          </Tabs>
        )}

        <Box ref={bodyRef} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2.5, py: 2 }}>
          {doc && (
            <DocMarkdown
              doc={doc}
              idPrefix={idPrefix}
              // The drawer scrolls itself; there is no app bar above its body.
              scrollMarginTop={8}
              linkTarget={linkTarget}
              codeRoute={codeRoute}
              textLinkHint={labels.textLinkHint}
              onThisPageLabel={labels.onThisPage}
              onOpenPage={openPage}
              onNavigate={goTo}
              onAnchor={scrollTo}
            />
          )}
        </Box>
      </Box>
    </Drawer>
  )
}
