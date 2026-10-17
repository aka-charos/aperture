import { useCallback, useState } from 'react'

/**
 * "How picks are made": the explainer of how AI recommendations are built.
 *
 * It used to open by itself on the Recommendations page, with a snooze menu to
 * keep it away. The welcome tour (components/tour) is what a new account meets
 * now, and it links here, as do the Recommendations page and the user menu —
 * so this opens only when asked for, and has nothing to snooze. The old
 * storage keys (`aperture-welcome-dismissed` and friends) are simply no longer
 * read.
 */
export function useWelcomeModal() {
  const [open, setOpen] = useState(false)
  const showWelcome = useCallback(() => setOpen(true), [])
  const hideWelcome = useCallback(() => setOpen(false), [])
  return { open, showWelcome, hideWelcome }
}
