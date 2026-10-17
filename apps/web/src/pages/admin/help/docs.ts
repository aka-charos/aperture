import { buildDocPages, filterDocPages, type DocPage } from '@/components/docs/pages'
import { ADMIN_DOCS_FOLDER } from '@/components/docs/guidePaths'

/**
 * The admin guide, compiled into the bundle from `docs/admin/`.
 *
 * Built in rather than served, so the guide an instance shows is the one
 * written for the code it runs — the same commit, never a newer page about a
 * setting this build does not have. The folder is the source of truth and
 * reads on GitHub as before; nothing is copied.
 *
 * Eager inside a module only the guide imports: the page and the drawer are
 * both lazy, so the markdown is one chunk an admin downloads the first time
 * they open help, and nobody else ever does.
 */
const FILES = import.meta.glob<string>('../../../../../../docs/admin/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

export const ADMIN_DOC_PAGES = buildDocPages(FILES, ADMIN_DOCS_FOLDER)

export type AdminDoc = DocPage

export function getAdminDoc(slug: string): AdminDoc | undefined {
  return ADMIN_DOC_PAGES.get(slug)
}

export function filterAdminDocs(slugs: readonly string[], query: string): string[] {
  return filterDocPages(ADMIN_DOC_PAGES, slugs, query)
}
