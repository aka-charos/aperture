import { createChildLogger } from '../lib/logger.js'
import { getTextGenerationModelInstance } from '../lib/ai-provider.js'
import { generateText } from 'ai'
import { queryOne } from '../lib/db.js'
import { buildAiLanguageInstruction } from '../lib/locales.js'
import { resolveEffectiveAiLanguage } from '../lib/userSettings.js'
import {
  fetchMoviesBasicByIds,
  fetchMoviesFullByIds,
  fetchSeriesWithOverviewByIds,
  generatePlaylistText,
} from '../lib/ai-playlist-generation.js'

const logger = createChildLogger('channels')

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

export async function generateAIPreferences(
  userId: string,
  genres: string[],
  exampleMovieIds: string[],
  exampleSeriesIds: string[] = []
): Promise<string> {
  logger.info(
    {
      userId,
      genres,
      exampleMovieCount: exampleMovieIds.length,
      exampleSeriesCount: exampleSeriesIds.length,
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

  try {
    const aiLocale = await resolveEffectiveAiLanguage(userId)
    const langBlock = `\n\n${buildAiLanguageInstruction(aiLocale)}`
    const model = await getTextGenerationModelInstance()
    const { text } = await generateText({
      model,
      system: `You are a movie curator helping create a custom playlist. Based on the user's taste profile, selected genres, and example movies, generate 2-3 short preference paragraphs that describe what kind of movies should be included in this playlist.

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
      maxOutputTokens: 500,
    })

    if (!text) {
      throw new Error('No response from AI')
    }

    logger.info({ userId, preferencesLength: text.length }, 'AI preferences generated')
    return text
  } catch (error) {
    logger.error({ error, userId }, 'Failed to generate AI preferences')
    throw new Error('Failed to generate AI preferences. Please try again.')
  }
}

export async function generateAIPlaylistName(
  genres: string[],
  exampleMovieIds: string[],
  textPreferences?: string,
  userId?: string,
  exampleSeriesIds: string[] = []
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

  try {
    return await generatePlaylistText({
      mode: 'channel',
      kind: 'name',
      prompt: context,
      userId,
    })
  } catch (error) {
    logger.error({ error }, 'Failed to generate AI playlist name')
    throw new Error('Failed to generate playlist name. Please try again.')
  }
}

export async function generateAIPlaylistDescription(
  genres: string[],
  exampleMovieIds: string[],
  textPreferences?: string,
  playlistName?: string,
  userId?: string,
  exampleSeriesIds: string[] = []
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

  try {
    return await generatePlaylistText({
      mode: 'channel',
      kind: 'description',
      prompt: context + nameContext,
      userId,
      descriptionOptions: { playlistName },
    })
  } catch (error) {
    logger.error({ error }, 'Failed to generate AI playlist description')
    throw new Error('Failed to generate playlist description. Please try again.')
  }
}
