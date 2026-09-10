/**
 * What a role's save may publish to the shared per-provider credential store.
 *
 * `system_settings.ai_provider_credentials` is keyed by PROVIDER and read by
 * every role on it — `resolveApiKeyForProvider` and `resolveBaseUrlForProvider`
 * in core, and `GET /api/settings/ai/credentials/:provider`, which is what the
 * settings card reads back when someone picks a provider. A role's own config
 * is one object that `setFunctionConfig` replaces whole, so the shared store is
 * the ONLY thing that survives a provider switch. What lands in it decides
 * whether switching away and back is recoverable.
 *
 * THE KEY AND THE ADDRESS ARE DIFFERENT QUESTIONS, and answering them together
 * is what lost people their server.
 *
 * A grounding role's API key must stay out. `webSearch` and `titleAnalysis` can
 * both spend Google's grounded-search allowance, and they are separate roles
 * precisely so they can hold separate keys and spend from separate projects —
 * publishing one here lets the other borrow it and put the spend straight back
 * on the quota the split exists to protect (F-003, F-063).
 *
 * A base URL carries no quota, so that argument does not reach it. Core already
 * draws exactly this line: `resolveApiKeyForProvider` refuses to let a
 * grounding role lend a key, while `resolveBaseUrlForProvider` says in its own
 * comment that "a base URL carries no quota, so every role is a valid donor".
 * The route did not, and withheld both — so Title Analysis on LM Studio at
 * `http://host.docker.internal:9099/v1` lost that address the moment the role
 * was pointed at another provider, and offered the shipped
 * `http://localhost:1234/v1` default on the way back. Every non-grounding role
 * on the same server kept it. That asymmetry was the bug.
 *
 * Pure and pinned, because it is one rule the settings and setup routes had
 * each written for themselves, and they had already drifted in opposite
 * directions — settings withheld the address it should have shared, setup
 * shared the key it should have withheld.
 */

/** Roles that can spend a grounded-search allowance, and so guard their key. */
const GROUNDING_ROLES = new Set(['webSearch', 'titleAnalysis'])

export function isGroundingRole(fn: string): boolean {
  return GROUNDING_ROLES.has(fn)
}

export interface SharedCredentialFields {
  apiKey?: string
  baseUrl?: string
}

/**
 * The fields this save should merge into the provider's shared entry, or null
 * when it has nothing to contribute.
 *
 * An empty string is treated as absent throughout: the settings form sends one
 * for a field the operator never filled in, and writing it would overwrite a
 * good stored value with a blank.
 */
export function sharedCredentialUpdate(
  fn: string,
  fields: SharedCredentialFields
): SharedCredentialFields | null {
  const apiKey = fields.apiKey?.trim() ? fields.apiKey : undefined
  const baseUrl = fields.baseUrl?.trim() ? fields.baseUrl : undefined

  const shareApiKey = apiKey != null && !isGroundingRole(fn)

  if (!baseUrl && !shareApiKey) return null

  return {
    ...(shareApiKey && { apiKey }),
    ...(baseUrl && { baseUrl }),
  }
}
