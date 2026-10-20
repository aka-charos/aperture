import { useMemo, type MouseEvent, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Box,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import type { DocLinkTarget } from './docLinks'
import type { DocPage } from './pages'
import { rehypeGuideLayout } from './guideLayout'

interface DocMarkdownProps {
  doc: DocPage
  /**
   * Prepended to every heading id. The drawer renders over a section whose own
   * DOM carries ids, and a heading called "Configuration" must not collide
   * with a field anchor the search palette scrolls to.
   */
  idPrefix?: string
  /** Gap left above a heading scrolled to; defaults to clearing the app bar. */
  scrollMarginTop?: number | string
  /** Where each link lands; decided by the guide, which knows its routes and its reader. */
  linkTarget: (href: string, page: DocPage) => DocLinkTarget
  /**
   * An in-app address written as inline code (`/admin/integrations/smtp`),
   * or null. Optional: only a guide whose pages name addresses links them.
   */
  codeRoute?: (text: string) => string | null
  /** Tooltip on a link that has nothing in the app to open. */
  textLinkHint: string
  /** Heading of the strip of section links above a long page's sections. */
  onThisPageLabel?: string
  onOpenPage: (slug: string, anchor?: string) => void
  onNavigate: (href: string) => void
  onAnchor: (anchor: string) => void
}

/** Text content of rendered children, for the few decisions made on it. */
function textOf(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(textOf).join('')
  return ''
}

/**
 * A plain click is ours to route; a modified one (new tab, new window) is the
 * browser's, which is why every link carries a real href.
 */
function routeClick(event: MouseEvent, go: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  go()
}

/** What the layout pass (`guideLayout.ts`) made of an element, if anything. */
function docRole(node: { properties?: Record<string, unknown> } | undefined): string | undefined {
  const role = node?.properties?.dataDoc
  return typeof role === 'string' ? role : undefined
}

const REHYPE_PLUGINS = [rehypeGuideLayout]

/**
 * One docs page, for either guide.
 *
 * The page's `# Title` is not rendered: every host shows it in its own
 * header. Where a link lands is the guide's decision (`linkTarget`): another
 * page of the same guide opens in place, an in-app address navigates, and a
 * link with nothing in the app to open reads as text rather than as a link
 * to a dead route. Screenshots are never drawn — the reader is looking at
 * the real screen.
 *
 * The pages stay plain markdown for GitHub; the layout is read off their
 * shape by `rehypeGuideLayout` — a lead paragraph, one numbered card per
 * section, term lists, feature rows, on-screen labels (quoted words and short
 * capitalised bold), notice/tip/info callouts and a "Next" card — so there is
 * no second copy of the guide to keep.
 */
export function DocMarkdown({
  doc,
  idPrefix = '',
  scrollMarginTop = 'calc(var(--aperture-chrome-top, 64px) + 16px)',
  linkTarget,
  codeRoute,
  textLinkHint,
  onThisPageLabel,
  onOpenPage,
  onNavigate,
  onAnchor,
}: DocMarkdownProps) {

  const components = useMemo<Components>(() => {
    const slugByLine = new Map(doc.headings.map((h) => [h.line, h.slug]))
    const headingId = (line: number | undefined) => {
      const slug = line == null ? undefined : slugByLine.get(line)
      return slug ? `${idPrefix}${slug}` : undefined
    }
    const sections = doc.headings.filter((h) => h.depth === 2)

    return {
      h1: () => null,
      h2: ({ node, children }) => {
        const index = Number(node?.properties?.dataIndex)
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
            {index > 0 && (
              <Box
                aria-hidden
                sx={{
                  flex: 'none',
                  width: 28,
                  height: 28,
                  borderRadius: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: (theme) => alpha(theme.palette.primary.main, 0.14),
                  color: 'primary.light',
                  fontSize: 12,
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {String(index).padStart(2, '0')}
              </Box>
            )}
            <Typography
              id={headingId(node?.position?.start.line)}
              variant="subtitle1"
              component="h2"
              sx={{ fontWeight: 700, lineHeight: 1.35 }}
            >
              {children}
            </Typography>
          </Box>
        )
      },
      h3: ({ node, children }) => (
        <Typography id={headingId(node?.position?.start.line)} variant="subtitle2" component="h3" sx={{ fontWeight: 700, mt: 2.5, mb: 1 }}>
          {children}
        </Typography>
      ),
      h4: ({ node, children }) => (
        <Typography id={headingId(node?.position?.start.line)} variant="subtitle2" component="h4" sx={{ fontWeight: 700, mt: 2, mb: 0.75 }}>
          {children}
        </Typography>
      ),
      section: ({ children }) => (
        <Box
          component="section"
          sx={{
            bgcolor: (theme) => alpha(theme.palette.text.primary, 0.03),
            border: 1,
            borderColor: 'divider',
            borderRadius: 1.5,
            p: { xs: 2, sm: 2.5 },
            mb: 2,
            '& > :last-child': { mb: 0 },
          }}
        >
          {children}
        </Box>
      ),
      nav: ({ node, children, ...rest }) => {
        if (docRole(node) !== 'toc') return <nav {...rest}>{children}</nav>
        return (
          <Box component="nav" aria-label={onThisPageLabel} sx={{ mb: 2.5 }}>
            {onThisPageLabel && (
              <Typography variant="overline" component="div" color="text.secondary" sx={{ lineHeight: 2, fontWeight: 600 }}>
                {onThisPageLabel}
              </Typography>
            )}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {sections.map((heading) => (
                <Box
                  key={heading.slug}
                  component="a"
                  href={`#${idPrefix}${heading.slug}`}
                  onClick={(e: MouseEvent) => routeClick(e, () => onAnchor(heading.slug))}
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    minHeight: 30,
                    px: 1.5,
                    borderRadius: 999,
                    border: 1,
                    borderColor: 'divider',
                    bgcolor: (theme) => alpha(theme.palette.text.primary, 0.04),
                    color: 'text.secondary',
                    typography: 'body2',
                    fontSize: 13,
                    fontWeight: 500,
                    textDecoration: 'none',
                    '&:hover, &:focus-visible': { borderColor: 'primary.main', color: 'text.primary' },
                  }}
                >
                  {heading.text}
                </Box>
              ))}
            </Box>
          </Box>
        )
      },
      p: ({ node, children }) => {
        // A paragraph that held only a screenshot is empty once the image is
        // dropped, and would leave a gap where it was.
        const onlyImages = node?.children.every(
          (c) => (c.type === 'element' && c.tagName === 'img') || (c.type === 'text' && !c.value.trim())
        )
        if (onlyImages) return null
        if (docRole(node) === 'lede') {
          return (
            <Typography variant="body1" component="p" sx={{ mb: 2.5, fontSize: '1.0625rem', lineHeight: 1.6, color: 'text.primary' }}>
              {children}
            </Typography>
          )
        }
        return (
          <Typography variant="body2" component="p" sx={{ mb: 1.5, lineHeight: 1.7 }}>
            {children}
          </Typography>
        )
      },
      img: () => null,
      hr: () => <Box component="hr" sx={{ border: 0, borderTop: 1, borderColor: 'divider', my: 2.5 }} />,
      span: ({ node, children, ...rest }) => {
        switch (docRole(node)) {
          case 'ui':
            // Words the screen shows: a label, not prose.
            return (
              <Box
                component="span"
                sx={{
                  px: 0.75,
                  py: '1px',
                  borderRadius: 0.75,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: (theme) => alpha(theme.palette.text.primary, 0.08),
                  color: 'text.primary',
                  fontSize: '0.92em',
                  boxDecorationBreak: 'clone',
                  WebkitBoxDecorationBreak: 'clone',
                }}
              >
                {children}
              </Box>
            )
          case 'term':
            return (
              <Box component="span" sx={{ display: 'block', fontWeight: 600, color: 'text.primary' }}>
                {children}
              </Box>
            )
          case 'desc':
            return (
              <Box component="span" sx={{ display: 'block', color: 'text.secondary', mt: 0.25 }}>
                {children}
              </Box>
            )
          default:
            return <span {...rest}>{children}</span>
        }
      },
      ul: ({ node, children, ...rest }) => {
        if (docRole(node) !== 'features') return <ul {...rest}>{children}</ul>
        return (
          <Box component="ul" data-doc="features" sx={{ listStyle: 'none', p: 0, my: 1.5 }}>
            {children}
          </Box>
        )
      },
      li: ({ node, children, ...rest }) => {
        if (docRole(node) !== 'feature') return <li {...rest}>{children}</li>
        return (
          <Box
            component="li"
            data-doc="feature"
            sx={{
              display: 'flex',
              gap: 1.5,
              alignItems: 'flex-start',
              py: 1.25,
              mb: 0,
              borderTop: 1,
              borderColor: 'divider',
              '&:first-of-type': { borderTop: 0, pt: 0.25 },
              '& p': { mb: 0 },
            }}
          >
            <Box
              aria-hidden
              sx={{
                flex: 'none',
                width: 22,
                height: 22,
                mt: '1px',
                borderRadius: 0.75,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: (theme) => alpha(theme.palette.text.primary, 0.07),
                color: 'primary.light',
              }}
            >
              <CheckRoundedIcon sx={{ fontSize: 15 }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
          </Box>
        )
      },
      dl: ({ children }) => (
        <Box
          component="dl"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(96px, 34%) minmax(0, 1fr)',
            columnGap: 1.75,
            m: 0,
            my: 2,
            px: 1.75,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1.25,
            bgcolor: (theme) => alpha(theme.palette.background.default, 0.5),
            '& > dt, & > dd': { py: 1.25, m: 0, borderTop: 1, borderColor: 'divider', typography: 'body2', lineHeight: 1.5 },
            '& > dt:first-of-type, & > dt:first-of-type + dd': { borderTop: 0 },
            '& > dt': { fontWeight: 600, color: 'text.primary' },
            '& > dd': { color: 'text.secondary' },
            '& p': { m: 0 },
          }}
        >
          {children}
        </Box>
      ),
      div: ({ node, children, ...rest }) => {
        if (docRole(node) !== 'next') return <div {...rest}>{children}</div>
        const label = node?.properties?.dataLabel
        return (
          <Box
            sx={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              mt: 3,
              px: 2.25,
              py: 2,
              borderRadius: 1.5,
              border: 1,
              borderColor: (theme) => alpha(theme.palette.primary.main, 0.4),
              bgcolor: (theme) => alpha(theme.palette.primary.main, 0.07),
              '&:hover': { bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12) },
              '&:focus-within': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main' },
              // The link fills the card, so the whole card opens the page.
              '& a': { color: 'text.primary', fontWeight: 700, fontSize: '1rem', textDecoration: 'none', outline: 'none' },
              '& a::after': { content: '""', position: 'absolute', inset: 0, borderRadius: 'inherit' },
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {typeof label === 'string' && label && (
                <Typography variant="overline" component="div" sx={{ color: 'primary.light', lineHeight: 1.8, fontWeight: 600 }}>
                  {label}
                </Typography>
              )}
              {children}
            </Box>
            <ArrowForwardRoundedIcon
              aria-hidden
              sx={{ color: 'primary.light', transform: (theme) => (theme.direction === 'rtl' ? 'scaleX(-1)' : undefined) }}
            />
          </Box>
        )
      },
      a: ({ href, children }) => {
        const link = linkTarget(href ?? '', doc)
        switch (link.kind) {
          case 'external':
            return (
              <Link href={link.href} target="_blank" rel="noopener noreferrer">
                {children}
                <OpenInNewIcon sx={{ fontSize: '0.8em', ml: 0.25, verticalAlign: 'baseline' }} />
              </Link>
            )
          case 'anchor':
            return (
              <Link href={`#${idPrefix}${link.anchor}`} onClick={(e) => routeClick(e, () => onAnchor(link.anchor))}>
                {children}
              </Link>
            )
          case 'page':
            return (
              <Link href={link.href} onClick={(e) => routeClick(e, () => onOpenPage(link.slug, link.anchor))}>
                {children}
              </Link>
            )
          case 'route':
            return (
              <Link href={link.href} onClick={(e) => routeClick(e, () => onNavigate(link.href))}>
                {children}
              </Link>
            )
          case 'text':
            return (
              <Tooltip title={textLinkHint}>
                <Box component="span" sx={{ borderBottom: 1, borderColor: 'divider', borderBottomStyle: 'dotted' }}>
                  {children}
                </Box>
              </Tooltip>
            )
        }
      },
      code: ({ className, children }) => {
        const text = textOf(children)
        const path = codeRoute && !className && !text.includes('\n') ? codeRoute(text) : null
        if (path) {
          return (
            <Link href={path} onClick={(e) => routeClick(e, () => onNavigate(path))}>
              <code>{children}</code>
            </Link>
          )
        }
        return <code className={className}>{children}</code>
      },
      blockquote: ({ node, children }) => {
        const role = docRole(node)
        if (role === 'example') {
          // Something to type: drawn as a message, the way the assistant shows it.
          return (
            <Box
              sx={{
                width: 'fit-content',
                maxWidth: '100%',
                my: 1,
                px: 1.5,
                py: 1,
                borderRadius: '14px 14px 14px 4px',
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.16),
                color: 'text.primary',
                '& p': { m: 0, color: 'inherit' },
              }}
            >
              {children}
            </Box>
          )
        }
        if (role === 'callout') {
          const tone = node?.properties?.dataTone
          const warning = tone === 'warning'
          const Icon = warning ? WarningAmberRoundedIcon : tone === 'tip' ? LightbulbOutlinedIcon : InfoOutlinedIcon
          return (
            <Box
              sx={(theme) => {
                const color = warning ? theme.palette.warning.main : theme.palette.primary.main
                return {
                  display: 'flex',
                  gap: 1.25,
                  my: 2,
                  px: 1.75,
                  py: 1.5,
                  borderRadius: 1.25,
                  border: 1,
                  borderColor: alpha(color, 0.4),
                  bgcolor: alpha(color, 0.09),
                  ...(warning && { '& strong': { color: theme.palette.warning.light } }),
                  '& > div > :last-child': { mb: 0 },
                }
              }}
            >
              <Icon aria-hidden sx={{ fontSize: 20, mt: '2px', color: warning ? 'warning.main' : 'primary.light' }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
            </Box>
          )
        }
        return (
          <Box sx={{ borderInlineStart: 3, borderColor: 'primary.main', pl: 2, my: 2, color: 'text.secondary' }}>
            {children}
          </Box>
        )
      },
      table: ({ children }) => (
        <TableContainer component={Paper} variant="outlined" sx={{ my: 2 }}>
          <Table size="small">{children}</Table>
        </TableContainer>
      ),
      thead: ({ children }) => <TableHead>{children}</TableHead>,
      tbody: ({ children }) => <TableBody>{children}</TableBody>,
      tr: ({ children }) => <TableRow>{children}</TableRow>,
      th: ({ children }) => (
        <TableCell component="th" sx={{ fontWeight: 700, verticalAlign: 'bottom' }}>
          {children}
        </TableCell>
      ),
      td: ({ children }) => <TableCell sx={{ verticalAlign: 'top' }}>{children}</TableCell>,
    }
  }, [doc, idPrefix, linkTarget, codeRoute, textLinkHint, onThisPageLabel, onAnchor, onOpenPage, onNavigate])

  return (
    <Box
      sx={{
        // Anchored headings land below the app bar rather than under it.
        '& [id]': { scrollMarginTop },
        // A feature list (guideLayout.ts) draws its own rows.
        '& ul:not([data-doc="features"]), & ol': { pl: 3, my: 1.5 },
        '& li': { typography: 'body2', lineHeight: 1.7 },
        '& li:not([data-doc="feature"])': { mb: 0.5 },
        '& li > p': { mb: 0.5 },
        '& strong': { fontWeight: 600, color: 'text.primary' },
        '& code': {
          fontFamily: 'monospace',
          fontSize: '0.85em',
          bgcolor: 'action.hover',
          px: 0.5,
          py: 0.125,
          borderRadius: 0.5,
          wordBreak: 'break-word',
        },
        '& pre': {
          bgcolor: 'action.hover',
          p: 1.5,
          borderRadius: 1,
          overflowX: 'auto',
          my: 2,
          '& code': { bgcolor: 'transparent', p: 0, wordBreak: 'normal', whiteSpace: 'pre' },
        },
        '& td, & th': { typography: 'body2' },
      }}
    >
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={REHYPE_PLUGINS} components={components}>
        {doc.markdown}
      </Markdown>
    </Box>
  )
}
