/**
 * Echo the user's request back onto the cards it produced.
 *
 * The request text exists server-side for the whole turn, but never left it: a
 * carousel is titled 'Recommendations' and its items carry names and reasons,
 * so by the time the client offers "create a playlist from these", nothing on
 * screen remembers that the user asked for "movies like In the Mouth of
 * Madness". The playlist namer then had eleven horror titles and no idea what
 * connected them beyond genre.
 *
 * Stamping it onto the tool result rather than passing a conversation id around
 * has two properties worth the wrapper: the result is persisted whole in
 * `assistant_messages.tool_invocations`, so the request survives a reload along
 * with the cards it belongs to; and it is the request for THAT turn, not
 * whatever the user typed most recently.
 *
 * A fourth cross-cutting tool wrapper, alongside `withUnwatchedFilter`,
 * `withToolErrorHandling` and `withStatusEvents`.
 */
import type { ToolSet } from 'ai'

/**
 * Long enough for a paragraph of intent, short enough that a pasted essay can't
 * dominate a playlist-naming prompt (or the persisted message row).
 */
const MAX_REQUEST_LENGTH = 400

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Every object in a tool result that renders as a carousel — the result itself
 * (`{ items }`) and each entry of `{ carousels: [...] }`. Mirrors the container
 * walk in `unwatched.ts`; the client renders both shapes the same way.
 */
function carouselContainers(result: unknown): Record<string, unknown>[] {
  if (!isRecord(result)) return []
  const containers: Record<string, unknown>[] = []
  if (Array.isArray(result.items)) containers.push(result)
  if (Array.isArray(result.carousels)) {
    for (const carousel of result.carousels) {
      if (isRecord(carousel) && Array.isArray(carousel.items)) containers.push(carousel)
    }
  }
  return containers
}

/**
 * Wrap every tool so its card lists carry the request that prompted them.
 * Results without cards (stats, help, person lookups) pass through untouched.
 *
 * Wrap this OUTSIDE the other tool wrappers: it needs the final result, after
 * error handling has had its say and the unwatched filter has settled the item
 * lists.
 */
export function withRequestContext<T extends ToolSet>(tools: T, request: string): T {
  const trimmed = request.trim().slice(0, MAX_REQUEST_LENGTH)
  if (!trimmed) return tools

  return Object.fromEntries(
    Object.entries(tools).map(([name, toolDef]) => {
      const execute = toolDef.execute
      if (!execute) return [name, toolDef]
      const stamping: typeof execute = async (input, options) => {
        const result = await execute(input, options)
        for (const container of carouselContainers(result)) {
          container.request = trimmed
        }
        return result
      }
      return [name, { ...toolDef, execute: stamping }]
    })
  ) as T
}
