import type { TFunction } from 'i18next'
import { withServerMessageDetail } from './withServerMessageDetail'

/**
 * The AI routes answer a failure with a sentence worth reading ("Your Google API key is missing
 * or invalid. Check your API key in Settings > AI.", "The AI model reached its output limit
 * before writing anything…"). Show that instead of the flat fallback — without it, the only
 * signal is "Failed to generate name" and the button gets re-clicked.
 *
 * Shared by every dialog that generates playlist text. The graph and chat dialogs used to throw
 * the server's sentence away and show their fallback on every failure.
 */
export async function aiFailureMessage(
  t: TFunction,
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const data = await response.json()
    return typeof data?.error === 'string' && data.error
      ? withServerMessageDetail(t, data.error)
      : fallback
  } catch {
    return fallback
  }
}
