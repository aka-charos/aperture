import { adminPathFor } from '@/pages/admin/nav/registry'

/**
 * Where each guide's pages live, in the repository and in the app.
 *
 * One place for both, because each guide links into the other: an admin page
 * pointing at a user page opens it in the user guide, and a user page pointing
 * at an admin page opens the admin guide for an admin. Kept apart from either
 * guide's own link rules so neither has to import the other.
 */
export const ADMIN_DOCS_FOLDER = 'docs/admin'
export const USER_DOCS_FOLDER = 'docs/features'
/** The user guide's table of contents, written for GitHub and read by the app. */
export const USER_GUIDE_INDEX_FILE = 'docs/user-guide.md'
export const ADMIN_GUIDE_INDEX_FILE = 'docs/admin-guide.md'

export const USER_GUIDE_ROUTE = '/help'

/**
 * Languages the user guide is translated into, besides English. A translation
 * mirrors the English layout under `docs/<lang>/` (`docs/el/features/…`,
 * `docs/el/user-guide.md`) with the same file names, so a page is the same
 * slug in every language and the Help button needs no per-language table.
 * The admin guide is English only, by decision.
 */
export const USER_GUIDE_TRANSLATIONS = ['el'] as const
export type UserGuideLanguage = 'en' | (typeof USER_GUIDE_TRANSLATIONS)[number]

/** `docs/el/features` for Greek, `docs/features` for English. */
export function userDocsFolder(language: UserGuideLanguage): string {
  return language === 'en' ? USER_DOCS_FOLDER : `docs/${language}/features`
}

/** `docs/el/user-guide.md` for Greek, `docs/user-guide.md` for English. */
export function userGuideIndexFile(language: UserGuideLanguage): string {
  return language === 'en' ? USER_GUIDE_INDEX_FILE : `docs/${language}/user-guide.md`
}

/**
 * A translated page's link, read as the English path it stands for. Greek
 * pages link with real relative paths (so they also work on GitHub), which
 * land under `docs/el/`; routing decides by the English path, since a page is
 * one slug in every language. Anything outside a translation passes through.
 */
export function canonicalDocPath(path: string): string {
  for (const language of USER_GUIDE_TRANSLATIONS) {
    const prefix = `docs/${language}/`
    if (path.startsWith(prefix)) return `docs/${path.slice(prefix.length)}`
  }
  return path
}

/** The guide language for an app language: a translation when there is one, else English. */
export function userGuideLanguageFor(appLanguage: string | undefined): UserGuideLanguage {
  const base = (appLanguage ?? '').toLowerCase().split('-')[0]
  return (USER_GUIDE_TRANSLATIONS as readonly string[]).includes(base) ? (base as UserGuideLanguage) : 'en'
}

function withPage(base: string, slug?: string, anchor?: string): string {
  const path = slug ? `${base}/${slug}` : base
  return anchor ? `${path}#${anchor}` : path
}

/** e.g. `/admin/help/smtp#account-drift`; the base follows the admin registry. */
export function adminGuidePath(slug?: string, anchor?: string): string {
  return withPage(adminPathFor('guide'), slug, anchor)
}

/** e.g. `/help/user-settings/preferences`. */
export function userGuidePath(slug?: string, anchor?: string): string {
  return withPage(USER_GUIDE_ROUTE, slug, anchor)
}
