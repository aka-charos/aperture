/**
 * Request schemas for /api/social/*. Response schemas are deliberately omitted:
 * fast-json-stringify drops any property a response schema does not declare,
 * silently, and a dropped optional flag reads as "no" in the client.
 */

const uuid = { type: 'string' as const, format: 'uuid' }

const idParams = {
  type: 'object' as const,
  properties: { id: uuid },
  required: ['id'] as string[],
}

export const listConnectionsSchema = {
  tags: ['social'],
  summary: "The caller's connections",
  description:
    'People an admin has connected the caller to, who currently have access. Connected people see each other’s watch history, recent watches and names on titles, and can recommend titles to each other.',
}

export const listAllConnectionsSchema = {
  tags: ['social'],
  summary: 'Every connection (admin)',
  description: 'Every connected pair, both ends with whether the account currently has access.',
}

export const createConnectionSchema = {
  tags: ['social'],
  summary: 'Connect two users (admin)',
  description:
    'Idempotent: connecting a pair that already exists answers created=false. Setting up a connection for an account without access is allowed; it stays hidden until access is on.',
  body: {
    type: 'object' as const,
    properties: { userAId: uuid, userBId: uuid },
    required: ['userAId', 'userBId'] as string[],
    additionalProperties: false,
  },
}

export const deleteConnectionSchema = {
  tags: ['social'],
  summary: 'Remove a connection (admin)',
  params: idParams,
}

export const inboxSchema = {
  tags: ['social'],
  summary: 'Titles recommended to the caller',
  description:
    'Grouped by the person who recommended them. A title leaves the list when the caller finishes or dismisses it, when it leaves their libraries, or when the sender is no longer connected.',
}

export const inboxCountSchema = {
  tags: ['social'],
  summary: 'How many titles are waiting for the caller, and how many they have sent',
  description:
    '`count` is the length of the received list (the sidebar badge); `sentCount` the length of the sent list. The Watch This entry is listed while either is above zero.',
}

export const sentSchema = {
  tags: ['social'],
  summary: 'Titles the caller recommended to others',
  description:
    'Grouped by recipient, with where each title stands with them: watched, watching (a series, with episode progress), waiting, or unavailable (they can no longer open it). A dismissal is not disclosed; it reads as waiting.',
}

export const recipientsSchema = {
  tags: ['social'],
  summary: 'Who the caller can recommend a title to',
  description: 'Exactly one of movieId or seriesId.',
  querystring: {
    type: 'object' as const,
    properties: { movieId: uuid, seriesId: uuid },
    additionalProperties: false,
  },
}

export const recommendSchema = {
  tags: ['social'],
  summary: 'Recommend a title to connections',
  description:
    'Exactly one of movieId or seriesId. Each recipient is re-checked: someone not connected, unable to open the title, or who has finished it is skipped with a reason.',
  body: {
    type: 'object' as const,
    properties: {
      movieId: uuid,
      seriesId: uuid,
      recipientUserIds: {
        type: 'array' as const,
        items: uuid,
        minItems: 1,
        maxItems: 50,
        uniqueItems: true,
      },
    },
    required: ['recipientUserIds'] as string[],
    additionalProperties: false,
  },
}

export const dismissSchema = {
  tags: ['social'],
  summary: 'Dismiss a title recommended to the caller',
  params: idParams,
}

export const recentWatchesSchema = {
  tags: ['social'],
  summary: "What the caller's connections watched recently",
  description: 'Limited to titles the caller can open. One entry per connection, ordered by name.',
  querystring: {
    type: 'object' as const,
    properties: {
      limitPerUser: { type: 'integer' as const, minimum: 1, maximum: 50, default: 15 },
    },
    additionalProperties: false,
  },
}
