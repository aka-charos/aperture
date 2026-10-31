/**
 * The words in notifications, per language. Pure.
 *
 * A notification is written on the server in its RECIPIENT's interface
 * language, so the app and the email say the same thing and neither carries a
 * copy of the wording. The pattern is `email/strings.ts`': English is complete,
 * any other language may leave a key out and gets the English for it, values
 * are plain text, and `{{name}}` is filled in by `notificationText`. The words
 * of the email that carries them (subject, heading, footer) are email words
 * and live in `email/strings.ts` with the rest.
 */
import { normalizeAppLocale, type AppLocaleCode } from '../lib/locales.js'

const EN = {
  'watchThis.title': '{{sender}} recommended a title',
  'watchThis.body': '{{title}}',
  'requests.approved.title': 'Request approved',
  'requests.approved.body': '{{title}} was approved and is on its way.',
  'requests.declined.title': 'Request declined',
  'requests.declined.body': 'Your request for {{title}} was declined.',
  'requests.available.title': 'Now available',
  'requests.available.body': '{{title}} is ready to watch.',
  'issueReplies.reply.title': 'New reply on your issue',
  'issueReplies.reply.body': '{{author}} replied about {{title}}: {{message}}',
  'issueReplies.resolved.title': 'Issue resolved',
  'issueReplies.resolved.body': 'Your issue about {{title}} was marked resolved.',
  'recommendations.movie.title': 'New movie recommendations',
  'recommendations.movie.body': 'Your movie recommendations were refreshed.',
  'recommendations.series.title': 'New series recommendations',
  'recommendations.series.body': 'Your series recommendations were refreshed.',
  'someone': 'Someone',
} as const satisfies Record<string, string>

export type NotificationStringKey = keyof typeof EN

type Translations = Partial<Record<NotificationStringKey, string>>

const TRANSLATIONS: Readonly<Partial<Record<AppLocaleCode, Translations>>> = {
  el: {
    'watchThis.title': 'Ο/Η {{sender}} σας πρότεινε έναν τίτλο',
    'requests.approved.title': 'Το αίτημα εγκρίθηκε',
    'requests.approved.body': 'Το {{title}} εγκρίθηκε και έρχεται.',
    'requests.declined.title': 'Το αίτημα απορρίφθηκε',
    'requests.declined.body': 'Το αίτημά σας για το {{title}} απορρίφθηκε.',
    'requests.available.title': 'Διαθέσιμο τώρα',
    'requests.available.body': 'Το {{title}} είναι έτοιμο για προβολή.',
    'issueReplies.reply.title': 'Νέα απάντηση στο πρόβλημά σας',
    'issueReplies.reply.body': 'Ο/Η {{author}} απάντησε για το {{title}}: {{message}}',
    'issueReplies.resolved.title': 'Το πρόβλημα επιλύθηκε',
    'issueReplies.resolved.body': 'Το πρόβλημα που αναφέρατε για το {{title}} σημειώθηκε ως επιλυμένο.',
    'recommendations.movie.title': 'Νέες προτάσεις ταινιών',
    'recommendations.movie.body': 'Οι προτάσεις ταινιών σας ανανεώθηκαν.',
    'recommendations.series.title': 'Νέες προτάσεις σειρών',
    'recommendations.series.body': 'Οι προτάσεις σειρών σας ανανεώθηκαν.',
    'someone': 'Κάποιος',
  },
}

/** The English source, for the test that holds every translation to its keys and placeholders. */
export const NOTIFICATION_STRINGS_EN: Readonly<Record<NotificationStringKey, string>> = EN
export const NOTIFICATION_STRING_TRANSLATIONS: Readonly<Record<string, Translations>> = TRANSLATIONS

/** One string in `locale`, falling back to English per key; a placeholder with no value becomes empty. */
export function notificationText(
  locale: string | null | undefined,
  key: NotificationStringKey,
  vars: Readonly<Record<string, string>> = {}
): string {
  const code = normalizeAppLocale((locale ?? '').split(/[-_]/)[0])
  const template = (code === 'en' ? undefined : TRANSLATIONS[code]?.[key]) ?? EN[key]
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? '')
}
