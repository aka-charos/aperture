/**
 * The Chat role's connection test: a model that answers in prose but cannot
 * call tools passes a plain "say ok" test and then breaks the assistant the
 * first time anyone asks it something, because every library search, card
 * and lookup there is a tool call. So the chat Test asks for one tool call,
 * streamed and with `toolChoice: 'auto'`, as the chat itself asks, and passes
 * only when a valid one comes back. Adapted from upstream v0.8.0-dev.8.3.
 *
 * Only the Test runs it; saving is never held up by it. This file holds the
 * request's fixed parts and the verdict, pure, so both are pinned by
 * `chatToolTest.test.ts`; the call itself is in `ai-provider.ts`.
 */
import { z } from 'zod'

/** The tool the test asks for. Its only argument must be the literal "ok". */
export const CHAT_TEST_TOOL = 'aperture_test'

export const CHAT_TEST_PROMPT = `Call the ${CHAT_TEST_TOOL} tool once, with status set to "ok". Do not answer in text.`

/**
 * Room for a reasoning model to think before it calls: a plain test's 20
 * tokens would cut one off mid-thought and read as "cannot call tools".
 */
export const CHAT_TEST_MAX_OUTPUT_TOKENS = 4000

/**
 * The tool's arguments. A zod schema, because the SDK validates a call against
 * it and marks a mismatch `invalid`; a bare JSON Schema is never checked, so a
 * call with any argument would pass.
 */
export const CHAT_TEST_INPUT_SCHEMA = z.object({ status: z.literal('ok') })

export interface ChatToolTestOutcome {
  calls: ReadonlyArray<{ toolName: string; invalid?: boolean }>
  finishReason: string
}

/**
 * Why the test failed, in words for the Test button, or null when the model
 * made a valid call. Each failure names what the model did instead, since
 * "connection failed" would send the operator after a URL that works.
 */
export function chatToolTestFailure({ calls, finishReason }: ChatToolTestOutcome): string | null {
  const ours = calls.filter((call) => call.toolName === CHAT_TEST_TOOL)
  if (ours.some((call) => call.invalid !== true)) return null
  if (ours.length > 0) {
    return 'The model called the test tool with arguments that did not match its schema. The assistant needs reliable tool calls.'
  }
  if (calls.length > 0) {
    return 'The model called a tool that does not exist instead of the test tool. The assistant needs reliable tool calls.'
  }
  if (finishReason === 'length') {
    return 'The answer reached its length limit before the model called the test tool: a reasoning model may have spent it thinking. Try again, or raise the server\'s output limit.'
  }
  return 'The model answered in text instead of calling the test tool. The assistant runs on tool calls: choose a model with tool-calling support (and, on a local server, turn it on for this model).'
}
