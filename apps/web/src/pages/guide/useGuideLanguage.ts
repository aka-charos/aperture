import { useTranslation } from 'react-i18next'
import { userGuideLanguageFor, type UserGuideLanguage } from '@/components/docs/guidePaths'

/**
 * The language the user guide is read in: the app's own language when the
 * guide is translated into it, English otherwise. Follows the app-bar language
 * switch live, since it reads the same i18next instance.
 */
export function useGuideLanguage(): UserGuideLanguage {
  const { i18n } = useTranslation()
  return userGuideLanguageFor(i18n.resolvedLanguage ?? i18n.language)
}
