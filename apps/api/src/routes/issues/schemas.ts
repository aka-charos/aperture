/**
 * Issue reporting OpenAPI schemas.
 *
 * Issues are proxied to Seerr live rather than mirrored: `GET /issue` scopes
 * itself to the caller, so acting as the user returns their handful of rows
 * and there is nothing worth caching locally.
 */

export const issueSchemas = {
  Issue: {
    type: 'object',
    description: 'A reported problem with a title, as Aperture presents it',
    properties: {
      id: { type: 'integer', description: 'Seerr issue id' },
      kind: {
        type: 'string',
        enum: ['video', 'audio', 'subtitles', 'other'],
        description: 'What is wrong with the title',
      },
      state: { type: 'string', enum: ['open', 'resolved'] },
      mediaType: { type: 'string', enum: ['movie', 'series'] },
      tmdbId: { type: 'integer' },
      description: {
        type: 'string',
        nullable: true,
        description: "The reporter's own words. Seerr stores this as the issue's first comment.",
      },
      problemSeason: { type: 'integer', nullable: true, description: 'Null means the whole title' },
      problemEpisode: { type: 'integer', nullable: true },
      reportedBy: { type: 'string', nullable: true },
      libraryMediaId: { type: 'string', nullable: true, description: 'Aperture UUID, for linking' },
      libraryTitle: { type: 'string', nullable: true },
      comments: { type: 'array', items: { $ref: 'IssueComment#' } },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  IssueComment: {
    type: 'object',
    description: 'A reply on an issue thread',
    properties: {
      id: { type: 'integer' },
      message: { type: 'string' },
      author: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
}

export const listIssuesSchema = {
  tags: ['issues'],
  summary: 'List issues',
  description:
    "Issues reported by the current user. Admins may pass scope=all for everyone's; a non-admin asking for it is narrowed to their own rather than refused.",
  querystring: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['mine', 'all'] },
      filter: { type: 'string', enum: ['all', 'open', 'resolved'], default: 'all' },
    },
  },
}

export const createIssueSchema = {
  tags: ['issues'],
  summary: 'Report a problem with a title',
  description:
    'Files an issue in Seerr as the current user. Requires the title to be known to Seerr, which the media status endpoint reports as canReportIssue.',
  body: {
    type: 'object',
    required: ['tmdbId', 'mediaType', 'kind', 'message'],
    properties: {
      tmdbId: { type: 'integer' },
      mediaType: { type: 'string', enum: ['movie', 'series'] },
      kind: { type: 'string', enum: ['video', 'audio', 'subtitles', 'other'] },
      message: { type: 'string', minLength: 1, maxLength: 4000 },
      problemSeason: { type: 'integer', minimum: 0, description: 'Omit or 0 for the whole title' },
      problemEpisode: { type: 'integer', minimum: 0 },
    },
  },
}

export const getIssueSchema = {
  tags: ['issues'],
  summary: 'Get one issue with its thread',
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', description: 'Seerr issue id' } },
  },
}

export const commentIssueSchema = {
  tags: ['issues'],
  summary: 'Reply on an issue',
  description:
    "Posts as the current user. Seerr has no on-behalf-of field for comments in any version, so an unmapped user's reply would carry the API key owner's name.",
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  body: {
    type: 'object',
    required: ['message'],
    properties: { message: { type: 'string', minLength: 1, maxLength: 4000 } },
  },
}
