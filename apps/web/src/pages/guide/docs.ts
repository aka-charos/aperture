import { buildDocPages, filterDocPages, type DocPage, type DocPages } from '@/components/docs/pages'
import {
  USER_GUIDE_TRANSLATIONS,
  userDocsFolder,
  userGuideIndexFile,
  type UserGuideLanguage,
} from '@/components/docs/guidePaths'
import { parseGuideIndex, type GuideSection } from './guideIndex'

/**
 * The user guide, compiled into the bundle: English from `docs/features/`
 * (subfolders included) and `docs/user-guide.md`, its table of contents, and
 * each translation from the same layout under `docs/<lang>/`.
 *
 * Built in for the admin guide's reason: an instance shows the pages written
 * for its own build. Eager inside a module only the guide imports — the page
 * and the drawer are lazy — so the markdown is one chunk fetched the first
 * time someone opens help.
 *
 * A translation falls back to English PAGE BY PAGE: a page not yet translated
 * shows in English rather than missing, so adding an English page never
 * breaks the Greek guide, it only leaves one page untranslated.
 */
const FILES = import.meta.glob<string>(
  ['../../../../../docs/features/**/*.md', '../../../../../docs/*/features/**/*.md'],
  { query: '?raw', import: 'default', eager: true }
)

const INDEXES = import.meta.glob<string>(
  ['../../../../../docs/user-guide.md', '../../../../../docs/*/user-guide.md'],
  { query: '?raw', import: 'default', eager: true }
)

function indexMarkdown(file: string): string {
  const key = Object.keys(INDEXES).find((k) => k.endsWith(`/${file}`))
  return key ? INDEXES[key] : ''
}

const ENGLISH = buildDocPages(FILES, userDocsFolder('en'))

/** The pages a reader of this language sees: the translation over English. */
const PAGES_BY_LANGUAGE = new Map<UserGuideLanguage, DocPages>([['en', ENGLISH]])
for (const language of USER_GUIDE_TRANSLATIONS) {
  const translated = buildDocPages(FILES, userDocsFolder(language))
  const merged = new Map(ENGLISH)
  for (const [slug, page] of translated) if (ENGLISH.has(slug)) merged.set(slug, page)
  PAGES_BY_LANGUAGE.set(language, merged)
}

/** English pages; the set every language shares slugs with. */
export const USER_DOC_PAGES = ENGLISH

export function userDocPages(language: UserGuideLanguage): DocPages {
  return PAGES_BY_LANGUAGE.get(language) ?? ENGLISH
}

export function getUserDoc(slug: string, language: UserGuideLanguage = 'en'): DocPage | undefined {
  return userDocPages(language).get(slug)
}

export function filterUserDocs(slugs: readonly string[], query: string, language: UserGuideLanguage = 'en'): string[] {
  return filterDocPages(userDocPages(language), slugs, query)
}

const SECTIONS_BY_LANGUAGE = new Map<UserGuideLanguage, readonly GuideSection[]>()

/**
 * The contents page, grouped and ordered as that language's `user-guide.md`
 * lists them; English's when a translation has no contents of its own.
 */
export function userGuideSections(language: UserGuideLanguage): readonly GuideSection[] {
  const cached = SECTIONS_BY_LANGUAGE.get(language)
  if (cached) return cached
  const file = userGuideIndexFile(language)
  const markdown = indexMarkdown(file)
  const sections = markdown
    ? parseGuideIndex(markdown, file, (slug) => ENGLISH.has(slug))
    : parseGuideIndex(indexMarkdown(userGuideIndexFile('en')), userGuideIndexFile('en'), (slug) => ENGLISH.has(slug))
  SECTIONS_BY_LANGUAGE.set(language, sections)
  return sections
}
