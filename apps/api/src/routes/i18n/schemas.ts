/**
 * i18n OpenAPI Schemas
 *
 * Admin-only Translations editor endpoints. The public overrides-by-locale
 * endpoint intentionally has no schema (see handlers/publicOverrides.ts).
 */

export const adminOverrideSchemas = {
  list: {
    tags: ['i18n'],
    summary: 'List all translation overrides (admin only)',
    description: 'Returns every admin-edited UI string override, across all locales including English.',
  },
  upsert: {
    tags: ['i18n'],
    summary: 'Set or reset a translation override (admin only)',
    description: 'Upserts an override for one (locale, key) pair. A null or empty value deletes the override, resetting that key back to the file/bundled default.',
    body: {
      type: 'object' as const,
      required: ['value'],
      properties: {
        value: { type: ['string', 'null'] as const, description: 'Override text, or null/empty to reset to default' },
      },
    },
  },
  bulk: {
    tags: ['i18n'],
    summary: 'Bulk set/reset translation overrides (admin only)',
    description: 'Used by CSV import. Upserts or deletes many (locale, key, value) entries in a single transaction.',
    body: {
      type: 'object' as const,
      required: ['overrides'],
      properties: {
        overrides: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            required: ['locale', 'key', 'value'],
            properties: {
              locale: { type: 'string' as const },
              key: { type: 'string' as const },
              value: { type: ['string', 'null'] as const },
            },
          },
        },
      },
    },
  },
}
