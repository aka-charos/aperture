/**
 * Schema for a content item (movie or series) in Tool UI format
 */
import { z } from 'zod'

// Action button schema
export const ActionSchema = z.object({
  id: z.string().describe('Unique action identifier'),
  label: z.string().describe('Button label text'),
  href: z.string().optional().describe('URL for the action'),
  variant: z.enum(['default', 'secondary', 'primary']).optional().describe('Button style variant'),
})

/**
 * Episode identity, carried on a card that represents one episode.
 *
 * `ContentItem.id` has to stay the EPISODE id — ContentCarousel keys React on
 * it, and two episodes of the same show would collide otherwise — so the parent
 * series travels here, and the card navigates to `seriesId` when this is
 * present. There is no `'episode'` member of the `type` enum on purpose: type
 * drives watched lookups and detail routes throughout the client, and a third
 * value would need handling in every one of them to fix a problem this field
 * already solves.
 */
export const EpisodeRefSchema = z.object({
  seriesId: z.string().describe('Id of the parent series — the navigation target for the card'),
  seriesTitle: z.string().describe('Title of the parent series'),
  season: z.number().describe('Season number'),
  number: z.number().describe('Episode number within the season'),
})

// Content item schema matching Tool UI ItemCarousel format
export const ContentItemSchema = z.object({
  id: z.string().describe('Unique content ID'),
  type: z.enum(['movie', 'series']).describe('Content type'),
  name: z.string().describe('Title of the content'),
  subtitle: z.string().optional().describe('Year, genres, or other info'),
  image: z.string().nullable().optional().describe('Poster image URL'),
  overview: z.string().nullable().optional().describe('Short synopsis/overview from the library'),
  director: z
    .string()
    .nullable()
    .optional()
    .describe('Director(s) for a movie, or creator(s) for a series — comma separated'),
  reason: z
    .string()
    .nullable()
    .optional()
    .describe('Short rationale for why this title fits the request (rendered on the card)'),
  rating: z.number().nullable().optional().describe('Community rating 0-10'),
  userRating: z.number().nullable().optional().describe('User rating 1-10'),
  watched: z
    .boolean()
    .optional()
    .describe(
      "Whether the user has already watched this title, read from their watch history. This is " +
        'authoritative: use it rather than guessing from whatever history you happen to have ' +
        'fetched, and NEVER claim someone has or has not seen something without it. Absent means ' +
        'not looked up — which is not the same as false.'
    ),
  rank: z.number().optional().describe('Recommendation rank'),
  source: z
    .enum(['ranked', 'twin', 'interest', 'acclaimed'])
    .optional()
    .describe(
      'How a recommendation earned its place in the list. "ranked" = the recommender scored it ' +
        'into the top of the list. "twin" = a reserved slot borrowed it from another viewer on ' +
        'this server whose watch history overlaps the user\'s far more than chance — similarity ' +
        'is precisely what did NOT choose it, so do not explain it as being like something they ' +
        'watched, and never identify the other viewer: they are always "someone here whose taste ' +
        'closely overlaps yours". "interest" = a reserved slot for one of the interests the user ' +
        'stated themselves. "acclaimed" = a reserved slot for a very highly rated title with a ' +
        'large number of votes behind it, which the ranking did NOT choose — explain it as a ' +
        'landmark they have not seen, never as a match to their taste. ' +
        'Absent for anything that is not a recommendation.'
    ),
  sharedTitles: z
    .array(z.string())
    .optional()
    .describe(
      'Only on a "twin" pick: titles the user and that other viewer have BOTH watched, rarest ' +
        'first. This overlap is what identified the match, so it is the honest way to explain ' +
        'the pick — e.g. "you both watched X and Y, and they also watched this". These are ' +
        "films from the user's own history, so naming them reveals nothing about the other " +
        'viewer, who still must never be identified.'
    ),
  episode: EpisodeRefSchema.optional().describe(
    'Present ONLY when this card is a single episode rather than a whole show (searchEpisodes). ' +
      'The card `id` is the episode, so use these fields to talk about it: name the series and ' +
      'the SxEy position, never present an episode as though it were the series.'
  ),
  actions: z.array(ActionSchema).optional().describe('Action buttons'),
})

export type ContentItem = z.infer<typeof ContentItemSchema>
export type Action = z.infer<typeof ActionSchema>
export type EpisodeRef = z.infer<typeof EpisodeRefSchema>


