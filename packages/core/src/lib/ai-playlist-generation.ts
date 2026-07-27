import { generateText } from 'ai'
import { query } from './db.js'
import { createChildLogger } from './logger.js'
import { getFunctionConfig, getTextGenerationModelInstance } from './ai-provider.js'
import { buildAiLanguageInstruction, DEFAULT_LOCALE, type AppLocaleCode } from './locales.js'
import { resolveEffectiveAiLanguage } from './userSettings.js'
import { describeAiFailure } from './aiFailure.js'

const logger = createChildLogger('ai-playlist-generation')

/**
 * Where the playlist came from. Each mode gets its own brief: a channel is built
 * from stated preferences, a graph playlist from a similarity exploration, and a
 * 'chat' playlist from an assistant conversation — where the user's request is
 * the thing the name has to answer.
 */
export type PlaylistTextMode = 'channel' | 'graph' | 'chat'

/**
 * What the assistant chat knows about a set of picks that the titles alone don't:
 * the request they answer, and the per-card note explaining each one. Both are
 * shown to the user already; feeding them back is what lets the namer say
 * "In Deeper Madness" instead of "Nightmare Fuel".
 */
export interface PlaylistChatContext {
  /** The user's own words that produced these picks. */
  request?: string
  /** Per-title rationale as shown on the cards. */
  reasons?: Array<{ title: string; reason: string }>
}

/** Caps: this arrives from an HTTP body, and must not be able to swamp the prompt. */
const MAX_CONTEXT_REQUEST_LENGTH = 400
const MAX_CONTEXT_REASONS = 8
const MAX_CONTEXT_REASON_LENGTH = 260

function isChatReason(value: unknown): value is { title: string; reason: string } {
  if (typeof value !== 'object' || value === null) return false
  const { title, reason } = value as { title?: unknown; reason?: unknown }
  return typeof title === 'string' && typeof reason === 'string' && reason.trim().length > 0
}

/**
 * The two chat blocks, kept apart so the caller can put the request above the
 * title list (it's the brief) and the rationale below it (it's the evidence).
 * Both empty when there's nothing usable — which is how a caller with no chat
 * context stays in its own mode.
 */
export function buildChatContextBlocks(context?: PlaylistChatContext): {
  requestBlock: string
  reasonsBlock: string
} {
  const request = context?.request?.trim().slice(0, MAX_CONTEXT_REQUEST_LENGTH) ?? ''
  const reasons = (Array.isArray(context?.reasons) ? context.reasons : [])
    .filter(isChatReason)
    .slice(0, MAX_CONTEXT_REASONS)
    .map((r) => `- ${r.title.trim()}: ${r.reason.trim().slice(0, MAX_CONTEXT_REASON_LENGTH)}`)

  return {
    requestBlock: request ? `USER REQUEST: "${request}"` : '',
    reasonsBlock: reasons.length > 0 ? `WHY THESE WERE PICKED:\n${reasons.join('\n')}` : '',
  }
}

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

const NAME_CONTEXT_LINE: Record<PlaylistTextMode, string> = {
  channel: 'Generate a single catchy, memorable playlist name based on the provided context.',
  graph: 'Generate a single catchy, memorable playlist name based on the provided movies/shows.',
  chat: 'Generate a single catchy, memorable playlist name for a set of titles that were recommended in answer to a request.',
}

const NAME_MODE_RULES: Record<PlaylistTextMode, string> = {
  channel: `- Capture the mood/vibe of the movies
- Don't include genre names directly unless cleverly incorporated`,
  graph: `- Find the common thread: franchise, director, era, mood, theme
- If it's clearly a franchise (Star Wars, Marvel, etc.), reference it cleverly`,
  chat: `- USER REQUEST is the brief — the name should read as an answer to it, not as a label for a genre
- Riff on whatever the request anchored on: a title it referenced, an era, a mood, a filmmaker
- WHY THESE WERE PICKED tells you the specific thread. "Horror" is what they have in common; the thread is why THESE ones
- Never quote the request back or address the user`,
}

const NAME_EXAMPLES: Record<PlaylistTextMode, string> = {
  channel: `- "Neon Noir Nights" (cyberpunk/noir)
- "Popcorn Apocalypse" (action/disaster)
- "Cozy Crimes" (mystery/comfort)
- "Starlight Escapes" (sci-fi/adventure)
- "Midnight Mayhem" (horror/thriller)
- "Retro Rewind" (80s movies)`,
  graph: `- "Galaxy Far Away" (Star Wars movies)
- "Nolan's Mind Games" (Christopher Nolan films)
- "Caped Crusaders" (superhero movies)
- "Cozy Mysteries" (detective/mystery)
- "Midnight Thrills" (horror/thriller mix)
- "Epic Quests" (adventure/fantasy)`,
  chat: `- "In Deeper Madness" (asked for films like In the Mouth of Madness)
- "One Last Score" (asked for heist movies)
- "Quiet Towns, Loud Secrets" (asked for slow-burn rural mysteries)
- "Nobody Sleeps Here" (asked for something to keep them up at night)
- "The Long Way Home" (asked for road movies about going back)`,
}

function buildPlaylistNameSystemPrompt(mode: PlaylistTextMode, langBlock: string): string {
  const contextLine = NAME_CONTEXT_LINE[mode]
  const modeRules = NAME_MODE_RULES[mode]
  const examples = NAME_EXAMPLES[mode]

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

const DESCRIPTION_ORIGIN_INTRO: Record<PlaylistTextMode, string> = {
  channel: '',
  graph:
    ' This playlist was created from a similarity graph exploration, so the items are connected by themes, genres, or creative relationships.',
  chat:
    ' These titles were recommended in answer to the request below, so the description should read as the answer to that request.',
}

function buildPlaylistDescriptionSystemPrompt(
  mode: PlaylistTextMode,
  langBlock: string,
  options: PlaylistDescriptionOptions = {}
): string {
  const originIntro = DESCRIPTION_ORIGIN_INTRO[mode]

  const connectionRule =
    mode === 'chat'
      ? '- Say what connects these in the terms the request cared about, not in genre labels'
      : mode === 'graph' && options.mediaType
        ? `- Highlight what connects these ${options.mediaType} (themes, franchises, directors, mood)`
        : '- Highlight the mood, themes, or experience'

  const requestRule =
    mode === 'chat' ? '\n- Never quote the request back or address the user ("you asked for…")' : ''

  const itemCountRule =
    mode !== 'channel' && options.itemCount !== undefined
      ? `- This collection has ${options.itemCount} items`
      : ''

  const examples =
    mode === 'chat'
      ? `- "Cosmic horror where reality itself stops holding still — nightmares that rewrite the world around their victims."
- "Five heists, five crews, one shared certainty that the last job is always the one that goes wrong."
- "Small towns with long memories, where the mystery is less about the body than about everyone who knew it."`
      : mode === 'graph'
        ? `- "Journey through the complete saga of galactic conflicts and family drama. 12 films that defined a generation."
- "Dark, atmospheric thrillers where nothing is as it seems. Prepare for twist endings and sleepless nights."
- "A curated selection of mind-bending narratives from cinema's most innovative directors."`
        : `- "A pulse-pounding journey through high-stakes heists and impossible escapes. Every film delivers edge-of-your-seat tension."
- "Heartwarming tales of unlikely friendships and second chances. Perfect for when you need to believe in happy endings."
- "Dark, atmospheric thrillers where nothing is as it seems. Prepare for twist endings and sleepless nights."`

  return `You are a movie curator writing a brief playlist description.${originIntro}

Write 1-2 sentences that capture what makes this collection special.

Rules:
- Be concise and engaging
${connectionRule}
- Don't list genres directly - describe the feeling
- If a playlist name is provided, the description should complement it
- Write in third person (describe the playlist, not "you")${requestRule}
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
