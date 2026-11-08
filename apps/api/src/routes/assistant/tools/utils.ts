/**
 * Tool utilities for AI assistant
 * Handles compatibility issues with local LLMs (Ollama, etc.)
 */
import { z } from 'zod'
import type { ToolSet } from 'ai'
import { toolErrorText } from '../helpers/errors.js'
import { isAsyncToolResult } from '../helpers/toolStream.js'

/** What a string argument may be turned into, read off the field's own schema. */
type Coercion = 'number' | 'boolean' | null

/**
 * The coercion a field's schema asks for, through the wrappers a tool schema
 * uses (optional, nullable, default, describe-only effects). A union coerces
 * only when no member accepts the string as it is.
 */
export function coercionFor(schema: z.ZodTypeAny): Coercion {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    return coercionFor(schema._def.innerType)
  }
  if (schema instanceof z.ZodEffects) return coercionFor(schema._def.schema)
  if (schema instanceof z.ZodNumber) return 'number'
  if (schema instanceof z.ZodBoolean) return 'boolean'
  if (schema instanceof z.ZodLiteral) {
    const value: unknown = schema._def.value
    return typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : null
  }
  if (schema instanceof z.ZodUnion) {
    const options = schema._def.options as z.ZodTypeAny[]
    if (options.some((option) => acceptsString(option))) return null
    const kinds = new Set(options.map(coercionFor))
    return kinds.size === 1 ? [...kinds][0] : null
  }
  return null
}

function acceptsString(schema: z.ZodTypeAny): boolean {
  return schema.safeParse('x').success || schema.safeParse('1').success
}

/** A string as the type its field wants, or the string itself. */
function coerce(value: string, to: Coercion): unknown {
  if (to === 'number') {
    if (/^-?\d+$/.test(value)) return parseInt(value, 10)
    if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value)
  }
  if (to === 'boolean') {
    if (value === 'true') return true
    if (value === 'false') return false
  }
  return value
}

/**
 * Normalize tool arguments for local LLM compatibility, against the tool's
 * own schema.
 *
 * Local LLMs like Ollama/Llama have quirks:
 * 1. Send explicit nulls for optional parameters (Zod rejects null for .optional())
 * 2. Send numbers as strings (e.g., "15" instead of 15)
 * 3. Send booleans as strings (e.g., "true" instead of true)
 *
 * A string is converted only for a field declared as a number or a boolean.
 * Converting every digit-only string turned a title such as "1917", "1984" or
 * the series "24" into a number, which the field's `z.string()` then refused,
 * so the tool failed on exactly the titles a viewer asked for. A key the
 * schema does not declare is left as sent.
 */
function normalizeToolArgs(obj: unknown, coercions: ReadonlyMap<string, Coercion>): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj
  }

  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>)
      .filter(([, v]) => v !== null) // Strip nulls
      .map(([k, v]) => [k, typeof v === 'string' ? coerce(v, coercions.get(k) ?? null) : v])
  )
}

/**
 * Wrap a Zod schema with argument normalization for local LLM compatibility.
 * Strips nulls, and turns a numeric or boolean string into a number or boolean
 * only where the schema declares that field so (see normalizeToolArgs).
 *
 * Usage:
 * ```typescript
 * import { nullSafe } from './utils.js'
 *
 * inputSchema: nullSafe(z.object({
 *   query: z.string(),
 *   limit: z.number().optional(),
 * }))
 * ```
 */
export function nullSafe<T extends z.ZodTypeAny>(schema: T) {
  const coercions = new Map<string, Coercion>()
  // Through a root `.refine()`/`.transform()` to the object it checks.
  let root: z.ZodTypeAny = schema
  while (root instanceof z.ZodEffects) root = root._def.schema
  if (root instanceof z.ZodObject) {
    for (const [key, field] of Object.entries(root.shape as Record<string, z.ZodTypeAny>)) {
      coercions.set(key, coercionFor(field))
    }
  }
  return z.preprocess((value) => normalizeToolArgs(value, coercions), schema) as unknown as T
}

/**
 * Wrap every tool's execute so an uncaught error (DB down, bad SQL, etc.)
 * becomes a `{ id, error }` payload instead of aborting the stream with a
 * masked "An error occurred". The frontend renders these via ToolResultError,
 * and the model sees them as a tool result it can react to. Tools with their
 * own try/catch (richer carousel error payloads) are unaffected — their
 * internal handler fires first; this is the backstop for the rest.
 */
export function withToolErrorHandling<T extends ToolSet>(tools: T): T {
  return Object.fromEntries(
    Object.entries(tools).map(([name, toolDef]) => {
      const execute = toolDef.execute
      if (!execute) return [name, toolDef]
      const failure = (err: unknown) => {
        console.error(`[${name}] Tool error:`, err)
        return { id: `error-${Date.now()}`, error: toolErrorText(err) }
      }
      // Not `async`: a tool that streams its results returns an async iterable,
      // and awaiting one here would hand the SDK a promise of a generator,
      // whose output serialises to `{}` (see helpers/toolStream.ts). A stream
      // that fails partway yields the error payload LAST, which is what makes
      // it the final output — the same contract as returning it.
      const guarded: typeof execute = (input, options) => {
        let raw: unknown
        try {
          raw = execute(input, options)
        } catch (err) {
          return failure(err)
        }
        if (isAsyncToolResult(raw)) {
          return (async function* () {
            try {
              for await (const chunk of raw) yield chunk
            } catch (err) {
              yield failure(err)
            }
          })()
        }
        return Promise.resolve(raw).catch(failure)
      }
      return [name, { ...toolDef, execute: guarded }]
    })
  ) as T
}


/**
 * The `format` parameter shared by tools that are as often a private lookup as
 * they are the answer.
 *
 * Every tool result carrying `items` renders as a wall of posters, so a model
 * checking the watch history to inform a different answer produced fifty cards
 * that were not the answer — most visibly when it fetched fifty recent plays,
 * failed to find any French noir among them, and announced that none had been
 * watched, with fifty unrelated posters underneath. The model is the only party
 * that knows why it is calling, so it is the one that has to say.
 */
export const FORMAT_PARAM_DESCRIPTION =
  'How to return this result. "cards" (the default) renders posters for the user — use it ' +
  'when this list IS your answer. "brief" returns a short text list and NO cards — use it ' +
  'when you are looking something up to inform a different answer, e.g. checking what they ' +
  'have already seen before recommending. A brief result is invisible to the user, so never ' +
  'use it for the list you are actually presenting to them.'

/** One line of a brief result. `note` carries whatever the tool considers salient. */
export interface BriefEntry {
  name: string
  year?: number | null
  note?: string | null
}

/**
 * A tool result the user never sees: compact text, and crucially NO `items` key.
 *
 * The client dispatches on shape (`carousels` → `items` → `contentId` → …) and
 * falls through to rendering nothing, so omitting `items` is the whole
 * mechanism — no client change, and both the live and replayed renderers agree
 * for free. It also costs a fraction of the context: a ContentItem carries a
 * poster URL, synopsis, director and action hrefs, none of which a lookup uses.
 */
export function briefResult(
  id: string,
  entries: BriefEntry[]
): { id: string; brief: string; count: number } {
  const lines = entries.map((e) => {
    const title = e.year ? `${e.name} (${e.year})` : e.name
    return e.note ? `${title} — ${e.note}` : title
  })
  return {
    id,
    brief: lines.length > 0 ? lines.join('\n') : 'Nothing matched.',
    count: entries.length,
  }
}
