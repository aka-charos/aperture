/**
 * n8n-backed assistant tools
 *
 * Unlike the other tool factories this one is async and conditional: the
 * search_web tool only exists when the n8n search webhook is enabled in
 * Settings > Integrations. Works with any chat provider — to the model it is
 * an ordinary function tool, so it also avoids the Gemini restriction on
 * mixing native google_search with function declarations.
 */
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { getN8nConfig, callN8nWebhook } from '@aperture/core'

export async function createN8nTools(): Promise<ToolSet> {
  const { searchTool } = await getN8nConfig()
  if (!searchTool?.enabled || !searchTool.webhookUrl) return {}

  return {
    search_web: tool({
      description:
        'Search the live web for current information that is not in the local media library: news, upcoming release dates, streaming availability, reviews, cast updates. Use only when local library tools cannot answer.',
      inputSchema: z.object({
        query: z.string().describe('The web search query'),
        maxResults: z.number().optional().default(5).describe('Maximum number of results to return'),
      }),
      execute: async ({ query, maxResults }) => {
        try {
          return await callN8nWebhook(searchTool, { type: 'search', query, maxResults })
        } catch (error) {
          // Return the failure as a tool result so the model can tell the
          // user instead of the whole stream erroring out
          return { error: error instanceof Error ? error.message : 'Web search failed' }
        }
      },
    }),
  }
}
