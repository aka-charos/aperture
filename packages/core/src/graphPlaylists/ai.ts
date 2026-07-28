import { createChildLogger } from '../lib/logger.js'
import {
  buildChatContextBlocks,
  buildUserNotesBlock,
  fetchMoviesWithOverviewByIds,
  fetchSeriesWithOverviewByIds,
  generatePlaylistText,
  type MediaItem,
  type PlaylistChatContext,
  type PlaylistTextMode,
} from '../lib/ai-playlist-generation.js'

export type { PlaylistChatContext } from '../lib/ai-playlist-generation.js'

const logger = createChildLogger('graphPlaylists')

async function buildGraphContext(
  movieIds: string[],
  seriesIds: string[]
): Promise<{ context: string; items: MediaItem[] }> {
  const [movies, series] = await Promise.all([
    fetchMoviesWithOverviewByIds(movieIds),
    fetchSeriesWithOverviewByIds(seriesIds),
  ])

  const allItems = [...movies, ...series]
  if (allItems.length === 0) {
    return { context: '', items: [] }
  }

  const titleList = allItems
    .map((item) => `"${item.title}" (${item.year || 'N/A'})`)
    .join(', ')

  const allGenres = [...new Set(allItems.flatMap((item) => item.genres || []))]

  const contextParts: string[] = []
  contextParts.push(`TITLES: ${titleList}`)

  if (allGenres.length > 0) {
    contextParts.push(`GENRES: ${allGenres.join(', ')}`)
  }

  const overviews = allItems
    .filter((item) => item.overview)
    .slice(0, 3)
    .map((item) => `${item.title}: ${item.overview?.substring(0, 150)}...`)

  if (overviews.length > 0) {
    contextParts.push(`SAMPLE SYNOPSES:\n${overviews.join('\n')}`)
  }

  return { context: contextParts.join('\n\n'), items: allItems }
}

/**
 * Same endpoint serves the similarity-graph explorer and the assistant chat. The
 * chat sends what it knows (the request, the per-card notes); the explorer sends
 * nothing and keeps the graph brief. The request goes above the title list — it's
 * the brief — and the rationale below it, as evidence.
 */
function composePrompt(
  context: string,
  chatContext: PlaylistChatContext | undefined,
  extra = '',
  userNotes?: string
): { prompt: string; mode: PlaylistTextMode; hasUserNotes: boolean } {
  const { requestBlock, reasonsBlock } = buildChatContextBlocks(chatContext)
  const notesBlock = buildUserNotesBlock(userNotes)
  return {
    // The draft leads: it is the most recent and most specific thing the user said, and it
    // outranks even the request that produced these picks.
    prompt: [notesBlock, requestBlock, context + extra, reasonsBlock].filter(Boolean).join('\n\n'),
    mode: requestBlock || reasonsBlock ? 'chat' : 'graph',
    hasUserNotes: Boolean(notesBlock),
  }
}

export async function generateGraphPlaylistName(
  movieIds: string[],
  seriesIds: string[],
  userId?: string,
  chatContext?: PlaylistChatContext
): Promise<string> {
  logger.info({ movieCount: movieIds.length, seriesCount: seriesIds.length }, 'Generating graph playlist name')

  const { context, items } = await buildGraphContext(movieIds, seriesIds)

  if (!context || items.length === 0) {
    return 'My Collection'
  }

  const { prompt, mode } = composePrompt(context, chatContext)

  try {
    const cleanName = await generatePlaylistText({
      mode,
      kind: 'name',
      prompt,
      userId,
    })
    logger.info({ name: cleanName }, 'Generated graph playlist name')
    return cleanName
  } catch (error) {
    // Keep the actionable message generatePlaylistText produced (quota, auth, empty output).
    logger.error({ error }, 'Failed to generate graph playlist name')
    throw error instanceof Error ? error : new Error('Failed to generate playlist name.')
  }
}

/**
 * `userNotes` is whatever the user had already typed in the Description box, passed only when they
 * chose "build on what I wrote". Omitted on a plain re-roll, which is what lets a second click
 * produce a genuinely different take rather than a rewrite of the first one.
 */
export async function generateGraphPlaylistDescription(
  movieIds: string[],
  seriesIds: string[],
  playlistName?: string,
  userId?: string,
  chatContext?: PlaylistChatContext,
  userNotes?: string
): Promise<string> {
  logger.info(
    { movieCount: movieIds.length, seriesCount: seriesIds.length, playlistName },
    'Generating graph playlist description'
  )

  const { context, items } = await buildGraphContext(movieIds, seriesIds)

  if (!context || items.length === 0) {
    return 'A curated collection of movies and shows.'
  }

  const nameContext = playlistName ? `\nPLAYLIST NAME: "${playlistName}"` : ''
  const itemCount = items.length
  const hasMovies = movieIds.length > 0
  const hasSeries = seriesIds.length > 0
  const mediaType = hasMovies && hasSeries ? 'movies and shows' : hasMovies ? 'movies' : 'shows'

  const { prompt, mode, hasUserNotes } = composePrompt(context, chatContext, nameContext, userNotes)

  try {
    const description = await generatePlaylistText({
      mode,
      kind: 'description',
      prompt,
      userId,
      descriptionOptions: { playlistName, itemCount, mediaType, hasUserNotes },
    })
    logger.info({ descriptionLength: description.length }, 'Generated graph playlist description')
    return description
  } catch (error) {
    logger.error({ error }, 'Failed to generate graph playlist description')
    throw error instanceof Error ? error : new Error('Failed to generate playlist description.')
  }
}
