import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Box,
  Divider,
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
} from '@mui/material'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import type { AdminDoc } from './docs'
import { consolePathIn, guideDocPath, resolveDocHref } from './links'

interface HelpMarkdownProps {
  doc: AdminDoc
  /**
   * Prepended to every heading id. The drawer renders over a section whose own
   * DOM carries ids, and a heading called "Configuration" must not collide
   * with a field anchor the search palette scrolls to.
   */
  idPrefix?: string
  /** Gap left above a heading scrolled to; defaults to clearing the app bar. */
  scrollMarginTop?: number | string
  onOpenDoc: (slug: string, anchor?: string) => void
  onOpenSection: (path: string) => void
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

/**
 * One admin guide page.
 *
 * The page's `# Title` is not rendered: both hosts show it in their own
 * header. Links are routed by `resolveDocHref`, so a link to another admin
 * page opens it in the guide, a console address in inline code opens that
 * section, and a link into the rest of `docs/` reads as text — there is
 * nothing in the app for it to open yet.
 */
export function HelpMarkdown({
  doc,
  idPrefix = '',
  scrollMarginTop = 'calc(var(--aperture-chrome-top, 64px) + 16px)',
  onOpenDoc,
  onOpenSection,
  onAnchor,
}: HelpMarkdownProps) {
  const { t } = useTranslation()

  const components = useMemo<Components>(() => {
    const slugByLine = new Map(doc.headings.map((h) => [h.line, h.slug]))
    const headingId = (line: number | undefined) => {
      const slug = line == null ? undefined : slugByLine.get(line)
      return slug ? `${idPrefix}${slug}` : undefined
    }

    return {
      h1: () => null,
      h2: ({ node, children }) => (
        <Typography id={headingId(node?.position?.start.line)} variant="h6" component="h2" sx={{ fontWeight: 700, mt: 4, mb: 1.5 }}>
          {children}
        </Typography>
      ),
      h3: ({ node, children }) => (
        <Typography id={headingId(node?.position?.start.line)} variant="subtitle1" component="h3" sx={{ fontWeight: 700, mt: 3, mb: 1 }}>
          {children}
        </Typography>
      ),
      h4: ({ node, children }) => (
        <Typography id={headingId(node?.position?.start.line)} variant="subtitle2" component="h4" sx={{ fontWeight: 700, mt: 2.5, mb: 1 }}>
          {children}
        </Typography>
      ),
      p: ({ node, children }) => {
        // A paragraph that held only a screenshot is empty once the image is
        // dropped, and would leave a gap where it was.
        const onlyImages = node?.children.every(
          (c) => (c.type === 'element' && c.tagName === 'img') || (c.type === 'text' && !c.value.trim())
        )
        if (onlyImages) return null
        return (
          <Typography variant="body2" component="p" sx={{ mb: 1.5, lineHeight: 1.7 }}>
            {children}
          </Typography>
        )
      },
      img: () => null,
      hr: () => <Divider sx={{ my: 3 }} />,
      a: ({ href, children }) => {
        const link = resolveDocHref(href ?? '')
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
          case 'doc':
            return (
              <Link
                href={guideDocPath(link.slug, link.anchor)}
                onClick={(e) => routeClick(e, () => onOpenDoc(link.slug, link.anchor))}
              >
                {children}
              </Link>
            )
          case 'section':
            return (
              <Link href={link.path} onClick={(e) => routeClick(e, () => onOpenSection(link.path))}>
                {children}
              </Link>
            )
          case 'outside':
            return (
              <Tooltip title={t('adminDocs.link.outside')}>
                <Box component="span" sx={{ borderBottom: 1, borderColor: 'divider', borderBottomStyle: 'dotted' }}>
                  {children}
                </Box>
              </Tooltip>
            )
        }
      },
      code: ({ className, children }) => {
        const text = textOf(children)
        const path = !className && !text.includes('\n') ? consolePathIn(text) : null
        if (path) {
          return (
            <Link href={path} onClick={(e) => routeClick(e, () => onOpenSection(path))}>
              <code>{children}</code>
            </Link>
          )
        }
        return <code className={className}>{children}</code>
      },
      blockquote: ({ children }) => (
        <Box sx={{ borderInlineStart: 3, borderColor: 'primary.main', pl: 2, my: 2, color: 'text.secondary' }}>
          {children}
        </Box>
      ),
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
  }, [doc, idPrefix, onAnchor, onOpenDoc, onOpenSection, t])

  return (
    <Box
      sx={{
        // Anchored headings land below the app bar rather than under it.
        '& [id]': { scrollMarginTop },
        '& ul, & ol': { pl: 3, my: 1.5 },
        '& li': { typography: 'body2', lineHeight: 1.7, mb: 0.5 },
        '& li > p': { mb: 0.5 },
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
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {doc.markdown}
      </Markdown>
    </Box>
  )
}
