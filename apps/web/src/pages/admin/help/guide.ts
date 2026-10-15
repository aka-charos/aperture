import {
  ADMIN_ENTRIES,
  ADMIN_GROUPS,
  adminEntriesInGroup,
  type AdminEntry,
  type AdminGroupId,
} from '../nav/registry'

/**
 * The guide's table of contents, derived from the console's own nav.
 *
 * Most pages describe one section, and the registry already says which
 * (`AdminEntry.docs`), so the index lists them under the same groups, in the
 * same order, as the nav column — a reader who knows where a setting is finds
 * its page in the same place. Only the pages that describe no single section
 * are written out here; `help.test.ts` fails on a page in `docs/admin/` that
 * neither list reaches, so a new page cannot ship unreachable.
 */

export interface GuideSection {
  id: string
  titleKey: string
  docs: readonly string[]
}

/** How to get an instance running and keep it right: no one section owns these. */
const GETTING_STARTED: GuideSection = {
  id: 'start',
  titleKey: 'adminDocs.index.start',
  docs: ['setup-wizard', 'post-setup-checklist', 'recommended-workflow', 'windows-docker-desktop'],
}

/** Pages about a whole group rather than any one section in it, listed first. */
const GROUP_PAGES: Partial<Record<AdminGroupId, readonly string[]>> = {
  integrations: ['integrations-overview', 'api-errors'],
}

export function guideSections(): GuideSection[] {
  const sections: GuideSection[] = [GETTING_STARTED]

  for (const group of ADMIN_GROUPS) {
    const docs = [
      ...(GROUP_PAGES[group.id] ?? []),
      ...adminEntriesInGroup(group.id).flatMap((e) => e.docs ?? []),
    ]
    // A page can describe two sections of one group (the embeddings models
    // page serves AI roles and Embeddings); list it once there. Across groups
    // it is listed in each, since a reader may look in either.
    const unique = [...new Set(docs)]
    if (unique.length) sections.push({ id: group.id, titleKey: group.labelKey, docs: unique })
  }

  return sections
}

/** Every page the index reaches. */
export function guideDocSlugs(): Set<string> {
  return new Set(guideSections().flatMap((s) => s.docs))
}

/** The console sections a page describes, for its "Open …" buttons. */
export function sectionsForDoc(slug: string): AdminEntry[] {
  return ADMIN_ENTRIES.filter((e) => e.docs?.includes(slug))
}
