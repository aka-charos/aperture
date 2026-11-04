/**
 * Where the analysis bench reaches a provider. Pure.
 *
 * ONE ANSWER for the two things the bench does with a provider, listing its
 * models and running one, because they disagreeing is how a model that runs
 * cannot be listed. And it is the library writer's own answer
 * (`withResolvedCredentials` over the role's config), because the bench exists
 * to measure what the library would do.
 *
 * On the Title Analysis role's own provider: the role's address and nothing
 * else, since the writer falls back to no other, and the role's key or else the
 * shared one. The own key has to be read here because a grounding role's key
 * stays off the shared store and is never lent, so the shared lookup alone cannot
 * see it. On any other provider: the shared address and key.
 *
 * Pairing the role's address with a shared key is deliberate and is not a key
 * going astray: every address stored for a provider may carry its stored key
 * (`storedAiKey.ts` allows the same list), and the writer sends that pair.
 */
export interface BenchEndpoint {
  baseUrl?: string
  apiKey?: string
}

export function benchEndpointFrom(
  provider: string,
  role: { provider: string; baseUrl?: string; apiKey?: string } | null | undefined,
  shared: BenchEndpoint
): BenchEndpoint {
  if (role?.provider !== provider) return shared
  return { baseUrl: role.baseUrl, apiKey: role.apiKey || shared.apiKey }
}
