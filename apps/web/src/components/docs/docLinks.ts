/**
 * What a link inside a docs page points at, before any guide decides where
 * that lands in the app.
 *
 * The pages are plain markdown written to read on GitHub, so their links are
 * relative file paths (`smtp.md#account-drift`, `../features/discovery.md`).
 * This resolves one against the file it was written in and answers with a
 * path from the repository root; each guide then maps the paths it carries to
 * its own routes, and reads the rest as text. Pure, shared by both guides.
 */
export type DocHref =
  | { kind: 'external'; href: string }
  | { kind: 'anchor'; anchor: string }
  /** An absolute in-app address written as a link, e.g. `/admin/ops/jobs`. */
  | { kind: 'app'; path: string }
  /** Another file under the repository, as a path from its root. */
  | { kind: 'file'; path: string; anchor?: string }

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

/**
 * @param href   the link as written in the markdown
 * @param fromFile the page it was written in, from the repository root
 *                 (`docs/features/user-settings/preferences.md`)
 */
export function resolveDocHref(href: string, fromFile: string): DocHref {
  const trimmed = href.trim()

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return { kind: 'external', href: trimmed }
  if (trimmed.startsWith('#')) return { kind: 'anchor', anchor: decodeURIComponent(trimmed.slice(1)) }

  const hashAt = trimmed.indexOf('#')
  const pathPart = hashAt === -1 ? trimmed : trimmed.slice(0, hashAt)
  const anchor = hashAt === -1 ? undefined : decodeURIComponent(trimmed.slice(hashAt + 1)) || undefined

  if (pathPart.startsWith('/')) return { kind: 'app', path: pathPart.replace(/\/+$/, '') || '/' }

  const dir = fromFile.split('/').slice(0, -1)
  return { kind: 'file', path: normalize([...dir, ...pathPart.split('/')]).join('/'), anchor }
}

/**
 * The page a repository path names inside one docs folder, or null: with
 * `docs/features`, `docs/features/user-settings/preferences.md` is
 * `user-settings/preferences`.
 */
export function slugInFolder(path: string, folder: string): string | null {
  const prefix = `${folder}/`
  if (!path.startsWith(prefix) || !path.endsWith('.md')) return null
  return path.slice(prefix.length, -'.md'.length) || null
}

/** Where a link inside a page lands, as one guide decides it. */
export type DocLinkTarget =
  | { kind: 'external'; href: string }
  | { kind: 'anchor'; anchor: string }
  /** Another page of the same guide: opened in place, `href` for a new tab. */
  | { kind: 'page'; slug: string; anchor?: string; href: string }
  /** Somewhere else in the app (a section, a page, the other guide). */
  | { kind: 'route'; href: string }
  /** Nothing in the app to open: reads as text. */
  | { kind: 'text' }
