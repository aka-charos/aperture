import { useTranslation } from 'react-i18next'
import type { ContentCarouselData } from './types'

/**
 * A card section's heading and caption, translated when the tool sent keys and
 * falling back to its English text. Shared by the section itself and by the
 * tab that names it, so a tab can never read differently from the heading it
 * stands in for.
 */
export function useCarouselHeaderText(data: ContentCarouselData) {
  const { t } = useTranslation()
  const title = data.titleKey
    ? t(`assistantToolUi.${data.titleKey}`, {
        ...(data.titleParams ?? {}),
        defaultValue: data.title,
      })
    : data.title
  const description = data.descriptionKey
    ? t(`assistantToolUi.${data.descriptionKey}`, {
        ...(data.descriptionParams ?? {}),
        defaultValue: data.description,
      })
    : data.description
  const resolvedTitle = typeof title === 'string' && title.length > 0 ? title : undefined
  const resolvedDescription = typeof description === 'string' && description.length > 0 ? description : undefined
  return { resolvedTitle, resolvedDescription }
}
