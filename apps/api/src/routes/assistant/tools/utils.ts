/**
 * Tool utilities for AI assistant
 * Handles compatibility issues with local LLMs (Ollama, etc.)
 */
import { z } from 'zod'
import type { ToolSet } from 'ai'
import { toolErrorText } from '../helpers/errors.js'

/**
 * Normalize tool arguments for local LLM compatibility.
 * 
 * Local LLMs like Ollama/Llama have quirks:
 * 1. Send explicit nulls for optional parameters (Zod rejects null for .optional())
 * 2. Send numbers as strings (e.g., "15" instead of 15)
 * 3. Send booleans as strings (e.g., "true" instead of true)
 * 
 * This function normalizes these values before Zod validation.
 */
function normalizeToolArgs(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj
  }
  
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>)
      .filter(([, v]) => v !== null) // Strip nulls
      .map(([k, v]) => {
        // Coerce string numbers to actual numbers
        if (typeof v === 'string') {
          // Check if it's a numeric string (integer)
          if (/^-?\d+$/.test(v)) {
            return [k, parseInt(v, 10)]
          }
          // Check if it's a numeric string (float)
          if (/^-?\d+\.\d+$/.test(v)) {
            return [k, parseFloat(v)]
          }
          // Check for boolean strings
          if (v === 'true') return [k, true]
          if (v === 'false') return [k, false]
        }
        return [k, v]
      })
  )
}

/**
 * Wrap a Zod schema with argument normalization for local LLM compatibility.
 * Handles null stripping, string-to-number coercion, and string-to-boolean coercion.
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
  return z.preprocess(normalizeToolArgs, schema) as unknown as T
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
      const guarded: typeof execute = async (input, options) => {
        try {
          return await execute(input, options)
        } catch (err) {
          console.error(`[${name}] Tool error:`, err)
          return { id: `error-${Date.now()}`, error: toolErrorText(err) }
        }
      }
      return [name, { ...toolDef, execute: guarded }]
    })
  ) as T
}

