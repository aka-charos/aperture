import { useAuth } from './useAuth'

/**
 * Whether this viewer holds a capability.
 *
 * The name is the server's (`discover`, `discover:request`, `collections`,
 * `assistant`, `watchHistory:manage`, `emailNotifications`) and the answer is the server's
 * too — this only reads it. Deliberately no fallback logic: a missing
 * capability is false, never "work it out from the user's flags", because
 * working it out is how the bundle came to hold a copy of a permission rule
 * that the API then disagreed with.
 */
export function useCapability(capability: string): boolean {
  const { capabilities } = useAuth()
  return capabilities[capability] === true
}
