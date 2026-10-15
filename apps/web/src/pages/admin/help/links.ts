import { ADMIN_ENTRIES, adminEntryPath, adminPathFor } from '../nav/registry'

/**
 * What a link inside an admin guide page points at, decided once so the page
 * and the drawer cannot route the same link two ways.
 *
 * The pages are plain markdown written to read on GitHub, so their links are
 * relative file paths (`smtp.md#account-drift`, `../features/discovery.md`).
 * In the app a link to another admin page opens that page in the guide; a link
 * anywhere else in `docs/` (the user guide, the API reference) has nothing to
 * open yet, and says so rather than going to a dead route.
 */
export type DocLink =
  | { kind: 'external'; href: string }
  | { kind: 'anchor'; anchor: string }
  | { kind: 'doc'; slug: string; anchor?: string }
  | { kind: 'section'; path: string }
  /** Another part of `docs/`, as a path from the repository root. */
  | { kind: 'outside'; path: string }

/** Where the admin pages live, as the base their relative links resolve from. */
const ADMIN_DOCS_DIR = ['docs', 'admin'] as const

/** `a/b/../c` → `a/c`, without `node:path`, which the browser bundle lacks. */
function normalize(segments: string[]): string[] {
  const out: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out
}

export function resolveDocHref(href: string): DocLink {
  const trimmed = href.trim()

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return { kind: 'external', href: trimmed }
  if (trimmed.startsWith('#')) return { kind: 'anchor', anchor: decodeURIComponent(trimmed.slice(1)) }

  const hashAt = trimmed.indexOf('#')
  const pathPart = hashAt === -1 ? trimmed : trimmed.slice(0, hashAt)
  const anchor = hashAt === -1 ? undefined : decodeURIComponent(trimmed.slice(hashAt + 1)) || undefined

  if (pathPart.startsWith('/admin')) {
    return { kind: 'section', path: pathPart.replace(/\/+$/, '') || '/admin' }
  }

  const resolved = normalize([...ADMIN_DOCS_DIR, ...pathPart.split('/')])
  const isAdminPage =
    resolved.length === 3 &&
    resolved[0] === ADMIN_DOCS_DIR[0] &&
    resolved[1] === ADMIN_DOCS_DIR[1] &&
    resolved[2].endsWith('.md')

  if (isAdminPage) return { kind: 'doc', slug: resolved[2].slice(0, -3), anchor }
  return { kind: 'outside', path: resolved.join('/') }
}

const SECTION_PATHS = new Set(ADMIN_ENTRIES.map(adminEntryPath))

/**
 * A console address written as inline code — every page says where it lives
 * as "Admin console → … (`/admin/integrations/smtp`)". Returned only when it
 * names a real section, so a stale address renders as text rather than as a
 * link that lands on the overview; `help.test.ts` fails on the stale address.
 */
export function consolePathIn(code: string): string | null {
  const candidate = code.trim().replace(/\/+$/, '')
  return SECTION_PATHS.has(candidate) ? candidate : null
}

/** The guide's address for a page, e.g. `/admin/help/smtp#account-drift`. */
export function guideDocPath(slug: string, anchor?: string): string {
  return `${adminPathFor('guide')}/${slug}${anchor ? `#${anchor}` : ''}`
}
