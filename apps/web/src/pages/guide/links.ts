import { resolveDocHref, slugInFolder, type DocLinkTarget } from '@/components/docs/docLinks'
import {
  ADMIN_DOCS_FOLDER,
  ADMIN_GUIDE_INDEX_FILE,
  USER_DOCS_FOLDER,
  USER_GUIDE_INDEX_FILE,
  adminGuidePath,
  canonicalDocPath,
  userGuidePath,
} from '@/components/docs/guidePaths'
import { appPathIn } from './routeDocs'

/**
 * Where a link in a user guide page lands, for this reader.
 *
 * Another user page opens in the guide. An admin page, or the admin guide
 * itself, opens the admin guide for an admin and reads as text for everyone
 * else — a viewer cannot open it, and a link that answers "not allowed" is
 * worse than none. An app address opens that screen; anything else in the
 * repository (the API reference, release notes) has nothing to open.
 *
 * @param isUserPage whether a slug is a page this guide carries
 */
export function userLinkTarget(
  href: string,
  fromFile: string,
  isUserPage: (slug: string) => boolean,
  isAdmin: boolean
): DocLinkTarget {
  const link = resolveDocHref(href, fromFile)
  switch (link.kind) {
    case 'external':
    case 'anchor':
      return link
    case 'app': {
      const path = appPathIn(link.path)
      return path ? { kind: 'route', href: path } : { kind: 'text' }
    }
    case 'file': {
      // A translated page links within its own language's folder; it routes
      // by the English path, since a page is the same slug in every language.
      link.path = canonicalDocPath(link.path)
      if (link.path === USER_GUIDE_INDEX_FILE) return { kind: 'route', href: userGuidePath() }

      const slug = slugInFolder(link.path, USER_DOCS_FOLDER)
      if (slug && isUserPage(slug)) {
        return { kind: 'page', slug, anchor: link.anchor, href: userGuidePath(slug, link.anchor) }
      }

      const adminSlug = slugInFolder(link.path, ADMIN_DOCS_FOLDER)
      if (isAdmin && adminSlug) return { kind: 'route', href: adminGuidePath(adminSlug, link.anchor) }
      if (isAdmin && link.path === ADMIN_GUIDE_INDEX_FILE) return { kind: 'route', href: adminGuidePath() }

      return { kind: 'text' }
    }
  }
}
