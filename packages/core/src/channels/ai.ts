import { createChildLogger } from '../lib/logger.js'
import { getFunctionConfig, getTextGenerationModelInstance } from '../lib/ai-provider.js'
import { describeAiFailure } from '../lib/aiFailure.js'
import { generateText } from 'ai'
import { queryOne } from '../lib/db.js'
import { buildAiLanguageInstruction } from '../lib/locales.js'
import { resolveEffectiveAiLanguage } from '../lib/userSettings.js'
import {
  buildUserNotesBlock,
  fetchMoviesBasicByIds,
  fetchMoviesFullByIds,
  fetchSeriesWithOverviewByIds,
  generatePlaylistText,
} from '../lib/ai-playlist-generation.js'

const logger = createChildLogger('channels')

/** The preferences box holds a paragraph or three; past this it's padding, and it arrives over HTTP. */
const MAX_USER_NOTES_LENGTH = 2000

async function buildPlaylistContext(
  genres: string[],
  exampleMovieIds: string[],
  textPreferences?: string,
  exampleSeriesIds: string[] = []
): Promise<string> {
  const contextParts: string[] = []

  if (genres.length > 0) {
    contextParts.push(`GENRES: ${genres.join(', ')}`)
  }

  if (exampleMovieIds.length > 0) {
    const movies = await fetchMoviesBasicByIds(exampleMovieIds)
    const movieList = movies
      .map((m) => `"${m.title}" (${m.year || 'N/A'})`)
      .join(', ')
    contextParts.push(`EXAMPLE MOVIES: ${movieList}`)
  }

  if (exampleSeriesIds.length > 0) {
    const series = await fetchSeriesWithOverviewByIds(exampleSeriesIds)
    const seriesList = series
      .map((s) => `"${s.title}" (${s.year || 'N/A'})`)
      .join(', ')
    contextParts.push(`EXAMPLE TV SERIES: ${seriesList}`)
  }

  if (textPreferences) {
    contextParts.push(`PREFERENCES: ${textPreferences}`)
  }

  return contextParts.join('\n')
}

/**
 * `userNotes` is whatever the user had already typed into the preferences box. Everything else
 * here can be derived from the seeds; the notes can't — they're the one angle no amount of
 * reading the example titles would surface. So they lead the prompt and get their own rule.
 * Omitted when the caller wants a clean re-roll rather than a refinement.
 */
export async function generateAIPreferences(
  userId: string,
  genres: string[],
  exampleMovieIds: string[],
  exampleSeriesIds: string[] = [],
  userNotes?: string
): Promise<string> {
  const notes =
    typeof userNotes === 'string' ? userNotes.trim().slice(0, MAX_USER_NOTES_LENGTH) : ''

  logger.info(
    {
      userId,
      genres,
      exampleMovieCount: exampleMovieIds.length,
      exampleSeriesCount: exampleSeriesIds.length,
      userNotesLength: notes.length,
    },
    'Generating AI preferences'
  )

  const tasteProfile = await queryOne<{ taste_synopsis: string | null }>(
    'SELECT taste_synopsis FROM user_preferences WHERE user_id = $1',
    [userId]
  )

  const exampleMovies = await fetchMoviesFullByIds(exampleMovieIds)
  const exampleSeries = await fetchSeriesWithOverviewByIds(exampleSeriesIds)

  const contextParts: string[] = []

  // First, above the taste profile: it's the most specific and most recent thing the user said.
  if (notes) {
    contextParts.push(`THE USER'S OWN NOTES (their words, written before they asked for help):\n${notes}`)
  }

  if (tasteProfile?.taste_synopsis) {
    contextParts.push(`USER'S TASTE PROFILE:\n${tasteProfile.taste_synopsis}`)
  }

  if (genres.length > 0) {
    contextParts.push(`SELECTED GENRES:\n${genres.join(', ')}`)
  }

  if (exampleMovies.length > 0) {
    const movieList = exampleMovies
      .map((m) => `- "${m.title}" (${m.year || 'N/A'}) - ${m.genres?.join(', ') || 'Unknown genres'}`)
      .join('\n')
    contextParts.push(`EXAMPLE MOVIES (defining the playlist's style):\n${movieList}`)
  }

  if (exampleSeries.length > 0) {
    const seriesList = exampleSeries
      .map((s) => `- "${s.title}" (${s.year || 'N/A'}) - ${s.genres?.join(', ') || 'Unknown genres'}`)
      .join('\n')
    contextParts.push(`EXAMPLE TV SERIES (defining the playlist's style):\n${seriesList}`)
  }

  if (contextParts.length === 0) {
    return 'Please select some genres or example titles to help generate preferences.'
  }

  const config = await getFunctionConfig('textGeneration')

  try {
    const aiLocale = await resolveEffectiveAiLanguage(userId)
    const langBlock = `\n\n${buildAiLanguageInstruction(aiLocale)}`
    const model = await getTextGenerationModelInstance()

    // Without this the model treats the notes as one more piece of context and writes over
    // them — which is the whole complaint: the user types an angle, and it disappears.
    const notesRule = notes
      ? `

The user has already written notes of their own (THE USER'S OWN NOTES). Those outrank the genres and the example titles. Keep every angle they raise, including one the examples give no reason to expect, and build the rest around it. Sharpen and expand their wording; never drop it, contradict it, or hand it back word for word.`
      : ''

    const { text } = await generateText({
      model,
      system: `You are a movie curator helping create a custom playlist. Based on the user's taste profile, selected genres, and example movies, generate 2-3 short preference paragraphs that describe what kind of movies should be included in this playlist.${notesRule}

Be specific and actionable. Reference the qualities, themes, and styles evident in the example movies. Consider what makes these movies work together as a collection.

Focus on:
- Tone and mood (e.g., "dark and atmospheric" vs "light-hearted and fun")
- Storytelling style (e.g., "character-driven narratives" vs "plot-heavy thrillers")
- Visual or stylistic preferences (e.g., "practical effects", "neon-lit aesthetics")
- Thematic elements (e.g., "underdog stories", "moral ambiguity", "found family")
- Era or time period preferences
- What to avoid if implied by the examples

Write in first person as if the user is describing what they want. Keep it concise but specific - each paragraph should be 1-2 sentences. Don't use bullet points.${langBlock}`,
      prompt: contextParts.join('\n\n'),
      temperature: 0.7,
      // Headroom for reasoning models, which spend the budget thinking before they write
      // anything — the same starvation that used to make this fail at random.
      maxOutputTokens: 1500,
    })

    if (!text?.trim()) {
      throw new Error('The AI model returned an empty response.')
    }

    logger.info({ userId, preferencesLength: text.length }, 'AI preferences generated')
    return text
  } catch (error) {
    logger.error({ error, userId, provider: config?.provider }, 'Failed to generate AI preferences')
    throw new Error(await describeAiFailure(config?.provider, error))
  }
}

/**
 * `userNotes` is the name the user had already drafted, sent only for "build on what I wrote".
 * Distinct from `textPreferences`, which is a brief about the titles rather than about the name.
 */
export async function generateAIPlaylistName(
  genres: string[],
  exampleMovieIds: string[],
  textPreferences?: string,
  userId?: string,
  exampleSeriesIds: string[] = [],
  userNotes?: string
): Promise<string> {
  logger.info(
    { genres, exampleMovieCount: exampleMovieIds.length, exampleSeriesCount: exampleSeriesIds.length },
    'Generating AI playlist name'
  )

  const context = await buildPlaylistContext(
    genres,
    exampleMovieIds,
    textPreferences,
    exampleSeriesIds
  )

  if (!context) {
    return 'My Playlist'
  }

  const notesBlock = buildUserNotesBlock(userNotes)

  try {
    return await generatePlaylistText({
      mode: 'channel',
      kind: 'name',
      // The draft leads — everything below it can be derived from the seeds, and it can't.
      prompt: [notesBlock, context].filter(Boolean).join('\n\n'),
      userId,
      hasUserNotes: Boolean(notesBlock),
    })
  } catch (error) {
    // generatePlaylistText already turned this into an actionable message; keep it rather than
    // flattening every cause into "please try again".
    logger.error({ error }, 'Failed to generate AI playlist name')
    throw error instanceof Error ? error : new Error('Failed to generate playlist name.')
  }
}

/** `userNotes` is the description the user had already drafted — see `generateAIPlaylistName`. */
export async function generateAIPlaylistDescription(
  genres: string[],
  exampleMovieIds: string[],
  textPreferences?: string,
  playlistName?: string,
  userId?: string,
  exampleSeriesIds: string[] = [],
  userNotes?: string
): Promise<string> {
  logger.info(
    {
      genres,
      exampleMovieCount: exampleMovieIds.length,
      exampleSeriesCount: exampleSeriesIds.length,
      playlistName,
    },
    'Generating AI playlist description'
  )

  const context = await buildPlaylistContext(
    genres,
    exampleMovieIds,
    textPreferences,
    exampleSeriesIds
  )

  if (!context) {
    return 'A curated collection of movies.'
  }

  const nameContext = playlistName ? `\nPLAYLIST NAME: "${playlistName}"` : ''
  const notesBlock = buildUserNotesBlock(userNotes)

  try {
    return await generatePlaylistText({
      mode: 'channel',
      kind: 'description',
      prompt: [notesBlock, context + nameContext].filter(Boolean).join('\n\n'),
      userId,
      hasUserNotes: Boolean(notesBlock),
      descriptionOptions: { playlistName },
    })
  } catch (error) {
    logger.error({ error }, 'Failed to generate AI playlist description')
    throw error instanceof Error ? error : new Error('Failed to generate playlist description.')
  }
}
