/**
 * The request validator's options, in one place so a test validates a route's
 * querystring exactly as the server does (routes/listQuerystrings.test.ts).
 *
 * Worth knowing when writing a querystring schema: Fastify's validator coerces
 * a one-item array to a scalar and REFUSES a longer one, so a parameter the
 * client repeats (`?country=A&country=B`) must be declared `type: 'array'` —
 * declared `'string'`, every multi-select answers 400 before the handler runs.
 */
export const AJV_OPTIONS = {
  customOptions: {
    // Allow OpenAPI 'example' keyword in schemas for documentation
    keywords: ['example'],
  },
}
