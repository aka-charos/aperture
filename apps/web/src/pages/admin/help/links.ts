import { resolveDocHref, slugInFolder, type DocLinkTarget } from '@/components/docs/docLinks'
import {
  ADMIN_DOCS_FOLDER,
  USER_DOCS_FOLDER,
  USER_GUIDE_INDEX_FILE,
  adminGuidePath,
  userGuidePath,
} from '@/components/docs/guidePaths'
import { appPathIn } from '@/pages/guide/routeDocs'
import { ADMIN_ENTRIES, adminEntryPath } from '../nav/registry'

/**
 * Where a link in an admin guide page lands, decided once so the page and
 * the drawer cannot route the same link two ways.
 *
 * Another admin page opens in the guide; a user page opens in the user
 * guide (an admin can read both); a console address opens that section; and
 * anything else in the repository (the API reference, release notes) reads
 * as text rather than going to a dead route.
 *
 * @param isAdminPage whether a slug is a page this guide carries
 */
export function adminLinkTarget(
  href: string,
  fromFile: string,
  isAdminPage: (slug: string) => boolean
): DocLinkTarget {
  const link = resolveDocHref(href, fromFile)
  switch (link.kind) {
    case 'external':
    case 'anchor':
      return link
    case 'app': {
      const path = consolePathIn(link.path) ?? appPathIn(link.path)
      return path ? { kind: 'route', href: path } : { kind: 'text' }
    }
    case 'file': {
      const slug = slugInFolder(link.path, ADMIN_DOCS_FOLDER)
      if (slug && isAdminPage(slug)) {
        return { kind: 'page', slug, anchor: link.anchor, href: adminGuidePath(slug, link.anchor) }
      }
      const userSlug = slugInFolder(link.path, USER_DOCS_FOLDER)
      if (userSlug) return { kind: 'route', href: userGuidePath(userSlug, link.anchor) }
      if (link.path === USER_GUIDE_INDEX_FILE) return { kind: 'route', href: userGuidePath() }
      return { kind: 'text' }
    }
  }
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

/** The admin guide's address for a page, e.g. `/admin/help/smtp#account-drift`. */
export const guideDocPath = adminGuidePath
