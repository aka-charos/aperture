/**
 * A tool result is either one value or a stream of them.
 *
 * `ai@5`'s tool contract is `(input, options) => AsyncIterable<OUTPUT> |
 * PromiseLike<OUTPUT> | OUTPUT`. When `execute` is an async generator,
 * `executeTool` emits every yielded value as a tool result flagged
 * `preliminary: true` and treats the LAST yielded value as the real output —
 * the one the model reads and the one the client persists. A generator's
 * `return` value is discarded, so the finished state has to be the final yield.
 *
 * That makes every result-transforming wrapper a hazard, and silently so.
 * `const result = await execute(...)` on a generator resolves to the generator
 * OBJECT: the wrapper finds no cards to filter or stamp, and hands the SDK a
 * Promise — which is not an AsyncIterable — so the tool's whole output
 * serialises to `{}`. Nothing throws. A wrapper must therefore transform each
 * chunk, and must not be an `async function` itself, or it re-wraps the stream
 * in a promise and loses it the same way.
 */

/** A tool's raw return: a value, a promise of one, or a stream of them. */
export type RawToolResult = unknown

export function isAsyncToolResult(value: unknown): value is AsyncIterable<unknown> {
  return (
    value != null &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  )
}

/**
 * Apply `transform` to a tool result, whether it arrived whole or in parts.
 *
 * Deliberately not `async`: a streamed result must be handed back as the
 * iterable it is, not as a promise of one.
 */
export function mapToolResult(
  raw: RawToolResult,
  transform: (value: unknown) => unknown | Promise<unknown>
): RawToolResult {
  if (isAsyncToolResult(raw)) {
    return (async function* () {
      for await (const chunk of raw) {
        yield await transform(chunk)
      }
    })()
  }
  return Promise.resolve(raw).then(transform)
}
