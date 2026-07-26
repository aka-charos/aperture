import { generateText } from 'ai'
import { query } from './db.js'
import { createChildLogger } from './logger.js'
import { getFunctionConfig, getTextGenerationModelInstance } from './ai-provider.js'
import { buildAiLanguageInstruction, DEFAULT_LOCALE, type AppLocaleCode } from './locales.js'
import { resolveEffectiveAiLanguage } from './userSettings.js'
import { describeAiFailure } from './aiFailure.js'

const logger = createChildLogger('ai-playlist-generation')

export type PlaylistTextMode = 'channel' | 'graph'

export interface MovieRowBasic {
  title: string
  year: number | null
  genres: string[]
}

export interface MovieRowFull extends MovieRowBasic {
  overview: string | null
}

export interface MediaItem {
  id: string
  title: string
  year: number | null
  genres: string[]
  overview: string | null
}

export async function resolvePlaylistAiLocale(userId?: string): Promise<AppLocaleCode> {
  return userId ? resolveEffectiveAiLanguage(userId) : DEFAULT_LOCALE
}

/**
 * Output budgets, deliberately far larger than the visible answer.
 *
 * A reasoning model (Gemini 2.5's default thinking, DeepSeek R1, the o-series) spends this
 * allowance on hidden reasoning BEFORE writing a word, so a budget sized for a 3-word name comes
 * back empty with finishReason 'length' — which is what made name generation fail intermittently.
 * Length is governed by the prompt ("2-4 words max"), not by this cap; a cap only truncates.
 */
const MAX_OUTPUT_TOKENS: Record<'name' | 'description', number> = {
  name: 600,
  description: 1200,
}

/** No sane playlist name is longer than this; a rambling model gets cut off rather than stored. */
const NAME_MAX_LENGTH = 120

/**
 * Pull the name out of a model response.
 *
 * Most models answer with the bare name, but some prefix a lead-in ("Here's a great name:") or
 * format it as a markdown bullet. Anything ending in a colon is treated as a lead-in and skipped.
 */
export function cleanPlaylistName(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const candidate = lines.find((line) => !line.endsWith(':')) ?? lines[0] ?? ''

  return candidate
    .replace(/^(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim()
    .slice(0, NAME_MAX_LENGTH)
}

/**
 * Why a call that succeeded at the HTTP level still produced nothing. Each of these needs a
 * different fix from the operator, so they are worth telling apart.
 */
function emptyOutputMessage(finishReason: string): string {
  if (finishReason === 'length') {
    return 'The AI model reached its output limit before writing anything. This usually means a reasoning model spent the whole budget thinking — try a non-reasoning model for the Text Generation role in Settings > AI.'
  }
  if (finishReason === 'content-filter') {
    return "The AI provider's content filter blocked this request. Try different seed titles or preferences."
  }
  return `The AI model returned an empty response (finish reason: ${finishReason}).`
}

export async function fetchMoviesBasicByIds(movieIds: string[]): Promise<MovieRowBasic[]> {
  if (movieIds.length === 0) return []

  const result = await query<MovieRowBasic>(
    'SELECT title, year, genres FROM movies WHERE id = ANY($1)',
    [movieIds]
  )
  return result.rows
}

export async function fetchMoviesFullByIds(movieIds: string[]): Promise<MovieRowFull[]> {
  if (movieIds.length === 0) return []

  const result = await query<MovieRowFull>(
    'SELECT title, year, genres, overview FROM movies WHERE id = ANY($1)',
    [movieIds]
  )
  return result.rows
}

export async function fetchMoviesWithOverviewByIds(movieIds: string[]): Promise<MediaItem[]> {
  if (movieIds.length === 0) return []

  const result = await query<MediaItem>(
    'SELECT id, title, year, genres, overview FROM movies WHERE id = ANY($1)',
    [movieIds]
  )
  return result.rows
}

export async function fetchSeriesWithOverviewByIds(seriesIds: string[]): Promise<MediaItem[]> {
  if (seriesIds.length === 0) return []

  const result = await query<MediaItem>(
    'SELECT id, title, year, genres, overview FROM series WHERE id = ANY($1)',
    [seriesIds]
  )
  return result.rows
}

function buildPlaylistNameSystemPrompt(mode: PlaylistTextMode, langBlock: string): string {
  const contextLine =
    mode === 'channel'
      ? 'Generate a single catchy, memorable playlist name based on the provided context.'
      : 'Generate a single catchy, memorable playlist name based on the provided movies/shows.'

  const modeRules =
    mode === 'channel'
      ? `- Capture the mood/vibe of the movies
- Don't include genre names directly unless cleverly incorporated`
      : `- Find the common thread: franchise, director, era, mood, theme
- If it's clearly a franchise (Star Wars, Marvel, etc.), reference it cleverly`

  const examples =
    mode === 'channel'
      ? `- "Neon Noir Nights" (cyberpunk/noir)
- "Popcorn Apocalypse" (action/disaster)
- "Cozy Crimes" (mystery/comfort)
- "Starlight Escapes" (sci-fi/adventure)
- "Midnight Mayhem" (horror/thriller)
- "Retro Rewind" (80s movies)`
      : `- "Galaxy Far Away" (Star Wars movies)
- "Nolan's Mind Games" (Christopher Nolan films)
- "Caped Crusaders" (superhero movies)
- "Cozy Mysteries" (detective/mystery)
- "Midnight Thrills" (horror/thriller mix)
- "Epic Quests" (adventure/fantasy)`

  return `You are a creative playlist naming expert. ${contextLine}

Rules:
- Keep it short (2-4 words max)
- Be creative and evocative, not generic
${modeRules}
- Can use alliteration, wordplay, or cultural references
- Don't use generic words like "Collection", "Playlist", "Mix"

Examples of good names:
${examples}

Return ONLY the playlist name, nothing else.${langBlock}`
}

export interface PlaylistDescriptionOptions {
  playlistName?: string
  itemCount?: number
  mediaType?: string
}

function buildPlaylistDescriptionSystemPrompt(
  mode: PlaylistTextMode,
  langBlock: string,
  options: PlaylistDescriptionOptions = {}
): string {
  const graphIntro =
    mode === 'graph'
      ? ' This playlist was created from a similarity graph exploration, so the items are connected by themes, genres, or creative relationships.'
      : ''

  const connectionRule =
    mode === 'graph' && options.mediaType
      ? `- Highlight what connects these ${options.mediaType} (themes, franchises, directors, mood)`
      : '- Highlight the mood, themes, or experience'

  const itemCountRule =
    mode === 'graph' && options.itemCount !== undefined
      ? `- This collection has ${options.itemCount} items`
      : ''

  const examples =
    mode === 'graph'
      ? `- "Journey through the complete saga of galactic conflicts and family drama. 12 films that defined a generation."
- "Dark, atmospheric thrillers where nothing is as it seems. Prepare for twist endings and sleepless nights."
- "A curated selection of mind-bending narratives from cinema's most innovative directors."`
      : `- "A pulse-pounding journey through high-stakes heists and impossible escapes. Every film delivers edge-of-your-seat tension."
- "Heartwarming tales of unlikely friendships and second chances. Perfect for when you need to believe in happy endings."
- "Dark, atmospheric thrillers where nothing is as it seems. Prepare for twist endings and sleepless nights."`

  return `You are a movie curator writing a brief playlist description.${graphIntro}

Write 1-2 sentences that capture what makes this collection special.

Rules:
- Be concise and engaging
${connectionRule}
- Don't list genres directly - describe the feeling
- If a playlist name is provided, the description should complement it
- Write in third person (describe the playlist, not "you")
${itemCountRule}

Examples:
${examples}

Return ONLY the description, nothing else.${langBlock}`
}

export async function generatePlaylistText(params: {
  mode: PlaylistTextMode
  kind: 'name' | 'description'
  prompt: string
  userId?: string
  descriptionOptions?: PlaylistDescriptionOptions
}): Promise<string> {
  const aiLocale = await resolvePlaylistAiLocale(params.userId)
  const langBlock = `\n\n${buildAiLanguageInstruction(aiLocale)}`
  const config = await getFunctionConfig('textGeneration')
  const model = await getTextGenerationModelInstance()

  const system =
    params.kind === 'name'
      ? buildPlaylistNameSystemPrompt(params.mode, langBlock)
      : buildPlaylistDescriptionSystemPrompt(params.mode, langBlock, params.descriptionOptions)

  let text: string | undefined
  let finishReason: string

  try {
    const result = await generateText({
      model,
      system,
      prompt: params.prompt,
      temperature: params.kind === 'name' ? 0.9 : 0.8,
      maxOutputTokens: MAX_OUTPUT_TOKENS[params.kind],
    })
    text = result.text
    finishReason = result.finishReason
  } catch (error) {
    // Replace the provider's raw error with something the operator can act on, and put quota /
    // auth failures in the api_errors sink so they surface as an alert rather than one toast.
    const message = await describeAiFailure(config?.provider, error)
    logger.error(
      { error, provider: config?.provider, model: config?.model, kind: params.kind },
      'AI playlist text generation failed'
    )
    throw new Error(message)
  }

  const output = params.kind === 'name' ? cleanPlaylistName(text ?? '') : (text ?? '').trim()

  if (!output) {
    logger.warn(
      { provider: config?.provider, model: config?.model, kind: params.kind, finishReason },
      'AI playlist text generation returned nothing'
    )
    throw new Error(emptyOutputMessage(finishReason))
  }

  return output
}
