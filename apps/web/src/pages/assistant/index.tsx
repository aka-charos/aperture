import { Box, useMediaQuery, useTheme } from '@mui/material'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AssistantChatSurface } from '@/components/assistant/AssistantChatSurface'
import { useAssistantChat } from '@/components/assistant/useAssistantChat'
import { usePageHeader } from '@/hooks/usePageHeader'

/** Conversation handed over by the floating surface's expand button. */
function resumedConversationId(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const id = (state as { conversationId?: unknown }).conversationId
  return typeof id === 'string' ? id : undefined
}

/**
 * Dedicated assistant page (/assistant): the same chat as the floating
 * dialog/dock, but as a regular side-menu destination. The floating surface
 * hides itself on this route (see AssistantModal).
 */
export function AssistantPage() {
  const theme = useTheme()
  const { t } = useTranslation()
  const { state } = useLocation()
  // Inline conversation sidebar when there's room, history drawer below md
  const sidebarInline = useMediaQuery(theme.breakpoints.up('md'))
  const chat = useAssistantChat(true, resumedConversationId(state))

  // Published rather than rendered through PageHeading: the surface owns the
  // whole viewport and has no room for a block above it. At md+ the app bar says
  // what this is, so the surface's own title bar stands down — below md it is the
  // only place the title appears, and it carries the history and new-chat
  // buttons besides.
  usePageHeader(t('assistant.title'), t('assistant.subtitle'))

  return (
    <Box
      sx={{
        // Fill the viewport below the app bar, minus Layout's main padding
        height: { xs: 'calc(100vh - 96px)', sm: 'calc(100vh - 112px)' },
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 3,
        overflow: 'hidden',
        bgcolor: 'rgba(15, 15, 15, 0.5)',
      }}
    >
      <AssistantChatSurface chat={chat} sidebarInline={sidebarInline} showHeader={!sidebarInline} />
    </Box>
  )
}
