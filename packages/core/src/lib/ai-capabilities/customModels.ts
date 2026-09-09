/**
 * Which providers store their models in `custom_ai_models` rather than in the
 * shipped catalog.
 *
 * This list existed as a hand-written copy in five places — a private `Set` in
 * `ai-provider.ts`, and the same four-way `!==` chain repeated in the add and
 * delete handlers of both the settings and the setup routes — plus a sixth copy
 * as a union type on `CustomModel`, `addCustomModel` and `deleteCustomModel`.
 * Adding LM Studio meant editing all six, and missing one produces the quietest
 * possible failure: the picker offers "add a custom model", the dialog tests the
 * model successfully, and the save comes back 400 saying the provider is not
 * supported.
 *
 * It is deliberately NOT the same list as `registry.ts`'s set of providers that
 * qualify for Chat without a built-in tool-calling model. That one excludes
 * `huggingface` while this one includes it, because the two answer different
 * questions — "may a model be stored for this provider" and "may this provider
 * hold the assistant" — and folding them together would silently admit Hugging
 * Face to the Chat role.
 *
 * The SQL `CHECK` on `custom_ai_models.provider` is the other copy and cannot be
 * derived from here (see F-002: that constraint deliberately stays, because it
 * guards providers, which change only when an integration is written). A new
 * entry here needs a migration alongside it.
 */
export const CUSTOM_MODEL_PROVIDERS = [
  'ollama',
  'lmstudio',
  'openai-compatible',
  'openrouter',
  'huggingface',
  // Z.AI is the one CLOUD provider here that ships a built-in catalog AND
  // accepts custom models. Its catalog moves faster than this repo does — GLM
  // 4.6, 4.7, 5, 5.1, 5.2 and 5.3 all shipped inside eighteen months, and the
  // docs retire a model's guide page the moment it is superseded — so a static
  // list is a floor, not the set. Without this, an operator whose account has
  // a model newer than `zai.json` has no way to reach it at all.
  'zai',
] as const

export type CustomModelProvider = (typeof CUSTOM_MODEL_PROVIDERS)[number]

/** Narrow a provider id that arrived over HTTP to one that can store models. */
export function isCustomModelProvider(value: string): value is CustomModelProvider {
  return (CUSTOM_MODEL_PROVIDERS as readonly string[]).includes(value)
}

/**
 * Providers backed by a server on the operator's own network, whose live
 * catalog can be read straight off that server.
 *
 * `openai-compatible` is in the list because it might BE LM Studio — it has
 * shipped LM Studio's port as its default base URL since before this provider
 * existed, so anyone who wired LM Studio up the old way keeps the probe. The
 * probes fail harmlessly against anything else (vLLM, llama.cpp, TGI).
 */
export const LOCAL_MODEL_PROVIDERS = ['ollama', 'lmstudio', 'openai-compatible'] as const

export type LocalModelProvider = (typeof LOCAL_MODEL_PROVIDERS)[number]

export function isLocalModelProvider(value: string): value is LocalModelProvider {
  return (LOCAL_MODEL_PROVIDERS as readonly string[]).includes(value)
}
