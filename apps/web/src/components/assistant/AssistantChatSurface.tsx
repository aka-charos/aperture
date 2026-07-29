import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Drawer,
  Tooltip,
  Box,
  IconButton,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Divider,
  CircularProgress,
  TextField,
  Snackbar,
  Alert,
  useTheme,
} from '@mui/material'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import AddIcon from '@mui/icons-material/Add'
import ChatIcon from '@mui/icons-material/Chat'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditIcon from '@mui/icons-material/Edit'
import HistoryIcon from '@mui/icons-material/History'
import { AssistantRuntimeProvider, useThreadRuntime } from '@assistant-ui/react'
import { useChatRuntime, AssistantChatTransport } from '@assistant-ui/react-ai-sdk'
import { Thread } from './Thread'
import { getUnwatchedOnly } from './unwatchedPreference'
import { setStatusPhase } from './assistantStatus'
import { AICapabilityBanner } from '../AICapabilityBanner'
import { MediaDetailModalProvider } from '@/hooks/MediaDetailModalProvider'
import type { AssistantChatState, BackendMessage } from './useAssistantChat'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// Chat thread area that gets remounted when conversation changes
function ChatThreadArea({
  conversationId,
  historicalMessages,
  suggestions,
  setSavingMessages,
  fetchConversations,
  onSaveError,
}: {
  conversationId: string | null
  historicalMessages: BackendMessage[]
  suggestions: string[]
  setSavingMessages: (saving: boolean) => void
  fetchConversations: () => Promise<void>
  onSaveError: () => void
}) {
  // Memoize transport to prevent recreation on re-renders.
  // The server rebuilds prior turns from this conversation (the runtime is
  // remounted empty on every conversation load / id assignment, so history has
  // to come from the DB, not the runtime). The id is fixed for this mount —
  // ChatThreadArea is keyed by conversationId — so it's safe to set at creation.
  // Headers are resolved per send, so the composer's "unwatched only" toggle
  // applies to the next message without rebuilding the transport.
  const transport = useRef(new AssistantChatTransport({
    api: '/api/assistant/chat',
    credentials: 'include',
    headers: () => ({
      ...(conversationId ? { 'x-conversation-id': conversationId } : {}),
      ...(getUnwatchedOnly() ? { 'x-exclude-watched': 'true' } : {}),
    }),
  }))

  // Don't pass messages to runtime - it doesn't properly parse tool results
  // Instead, we'll pass historical messages directly to Thread for manual rendering
  const runtime = useChatRuntime({
    transport: transport.current,
    // The server reports its work phase as transient `data-status` parts so the
    // loading line can say what's happening instead of just "Thinking…". They
    // have to be caught here: assistant-ui renders `data-*` parts as null, so
    // they never reach a message component. Forwarded to a module store that
    // Thread's LoadingIndicator subscribes to.
    onData: (part) => {
      if (part.type !== 'data-status') return
      const data = part.data
      const phase = isRecord(data) && typeof data.phase === 'string' ? data.phase : null
      setStatusPhase(phase)
    },
  })

  // This component is keyed by conversationId, so this also clears the phase when
  // the user switches conversations mid-turn.
  useEffect(() => {
    setStatusPhase(null)
    return () => setStatusPhase(null)
  }, [])

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <MessageSaver
        conversationId={conversationId}
        setSavingMessages={setSavingMessages}
        fetchConversations={fetchConversations}
        onSaveError={onSaveError}
      />
      <Thread historicalMessages={historicalMessages} suggestions={suggestions} />
    </AssistantRuntimeProvider>
  )
}

// Component to handle message saving inside the runtime context
function MessageSaver({
  conversationId,
  setSavingMessages,
  fetchConversations,
  onSaveError,
}: {
  conversationId: string | null
  setSavingMessages: (saving: boolean) => void
  fetchConversations: () => Promise<void>
  onSaveError: () => void
}) {
  const threadRuntime = useThreadRuntime()
  // The runtime always starts empty (historical messages are rendered
  // separately, outside the runtime), so live-message counting starts at zero.
  const savedCountRef = useRef(0)
  // Id of the last assistant message we persisted - used to detect regenerated
  // answers, which replace the last message in place (same count, new id).
  const lastSavedAssistantIdRef = useRef<string | null>(null)
  const isSavingRef = useRef(false)

  useEffect(() => {
    // Subscribe to thread state changes
    const unsubscribe = threadRuntime.subscribe(() => {
      const state = threadRuntime.getState()

      // Only save when not currently running (assistant has finished)
      // and we have new messages to save
      if (state.isRunning) return
      if (isSavingRef.current) return
      if (!conversationId) return

      const messages = state.messages
      const lastMessage = messages[messages.length - 1]

      // Get messages that haven't been saved yet (normal turn) ...
      let unsavedMessages = messages.slice(savedCountRef.current)
      if (unsavedMessages.length === 0) {
        // ... or a regenerated answer: append the new variant.
        if (
          lastMessage &&
          lastMessage.role === 'assistant' &&
          lastSavedAssistantIdRef.current !== null &&
          lastMessage.id !== lastSavedAssistantIdRef.current
        ) {
          unsavedMessages = [lastMessage]
        } else {
          return
        }
      }

      // Convert to backend format
      // ThreadMessage uses 'content' as the parts array
      const messagesToSave = unsavedMessages.map(msg => {
        // Extract text content and tool invocations from message content (parts array)
        // A model that talks either side of a tool call produces several text
        // parts; they're kept apart so the reloaded answer reads the way the
        // live one did, rather than running two paragraphs into one line.
        const textParts: string[] = []
        const toolInvocations: Array<{ toolCallId: string; toolName: string; args: unknown; result?: unknown }> = []

        const contentParts = Array.isArray(msg.content) ? msg.content : []
        for (const part of contentParts) {
          if (!isRecord(part) || typeof part.type !== 'string') {
            continue
          }
          if (part.type === 'text' && typeof part.text === 'string') {
            if (part.text.trim()) textParts.push(part.text)
          } else if (
            part.type === 'tool-call' &&
            typeof part.toolCallId === 'string' &&
            typeof part.toolName === 'string'
          ) {
            // In ThreadMessage, the result is embedded directly in the tool-call part
            toolInvocations.push({
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args: part.args,
              result: part.result,
            })
          }
        }

        return {
          role: msg.role,
          content: textParts.join('\n\n'),
          ...(toolInvocations.length > 0 && { toolInvocations }),
        }
      })

      // Save to backend
      isSavingRef.current = true
      setSavingMessages(true)

      fetch(`/api/assistant/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ messages: messagesToSave }),
      })
        .then((res) => {
          if (!res.ok) {
            return res.text().then(text => {
              console.error('Failed to save messages:', text)
              onSaveError()
            })
          }
          savedCountRef.current = messages.length
          if (lastMessage && lastMessage.role === 'assistant') {
            lastSavedAssistantIdRef.current = lastMessage.id
          }
          fetchConversations() // Refresh to update titles
        })
        .catch(err => {
          console.error('Failed to save messages:', err)
          onSaveError()
        })
        .finally(() => {
          isSavingRef.current = false
          setSavingMessages(false)
        })
    })

    return () => unsubscribe()
  }, [threadRuntime, conversationId, setSavingMessages, fetchConversations, onSaveError])

  return null
}

export interface AssistantChatSurfaceProps {
  /** Conversation state + handlers from useAssistantChat */
  chat: AssistantChatState
  /** Render the conversation sidebar inline; otherwise it's behind the history drawer toggle */
  sidebarInline: boolean
  /** Extra header controls appended after the standard ones (dock/fullscreen/close in the floating surface) */
  headerActions?: ReactNode
  /** Forwarded to AICapabilityBanner so the floating surface can close itself before navigating to settings */
  onBeforeNavigate?: () => void
  /**
   * Open picked items in a dialog over the chat instead of routing to their page.
   * Right for surfaces that fill the viewport (the /assistant page, the floating
   * dialog), where routing would tear down the conversation and lose the reader's
   * place. Wrong for the dock, which stays put while the main pane shows the item
   * — pass false there. Defaults to true since the dock is the exception.
   */
  openMediaInModal?: boolean
}

/**
 * The full chat surface (sidebar, header, capability banner, thread), shared
 * by the floating dialog/dock and the dedicated /assistant page. The
 * containers stay in the callers; exactly one should mount this at a time.
 */
export function AssistantChatSurface({
  chat,
  sidebarInline,
  headerActions,
  onBeforeNavigate,
  openMediaInModal = true,
}: AssistantChatSurfaceProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const [historyOpen, setHistoryOpen] = useState(false)

  const {
    conversations,
    activeConversationId,
    loadingConversations,
    savingMessages,
    setSavingMessages,
    historicalMessages,
    editingConversationId,
    editTitle,
    setEditTitle,
    suggestions,
    errorKey,
    setErrorKey,
    handleSaveError,
    fetchConversations,
    handleNewChat,
    handleSelectConversation,
    handleDeleteConversation,
    handleStartRename,
    handleCancelRename,
    handleSaveRename,
  } = chat

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return t('assistant.dateToday')
    if (diffDays === 1) return t('assistant.dateYesterday')
    if (diffDays < 7) return t('assistant.dateDaysAgo', { count: diffDays })
    return date.toLocaleDateString()
  }

  // Conversation sidebar; rendered inline when there's room, inside the
  // history drawer everywhere else.
  const sidebarContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* New Chat Button */}
      <Box sx={{ p: 2 }}>
        <Box
          component="button"
          onClick={handleNewChat}
          sx={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            p: 1.5,
            bgcolor: 'rgba(26, 26, 26, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 2,
            color: '#f5f5f5',
            cursor: 'pointer',
            transition: 'all 0.2s',
            '&:hover': {
              bgcolor: 'rgba(37, 37, 37, 0.8)',
              borderColor: '#6366f1',
            },
          }}
        >
          <AddIcon fontSize="small" />
          <Typography variant="body2" fontWeight={500}>
            {t('assistant.newChat')}
          </Typography>
        </Box>
      </Box>

      <Divider sx={{ borderColor: 'rgba(255, 255, 255, 0.1)' }} />

      {/* Conversations List */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {loadingConversations ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : conversations.length === 0 ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {t('assistant.noConversations')}
            </Typography>
          </Box>
        ) : (
          <List dense sx={{ px: 1 }}>
            {conversations.map((convo) => (
              <ListItemButton
                key={convo.id}
                selected={convo.id === activeConversationId}
                onClick={() => {
                  if (editingConversationId === convo.id) return
                  setHistoryOpen(false)
                  void handleSelectConversation(convo.id)
                }}
                sx={{
                  borderRadius: 1,
                  mb: 0.5,
                  '&.Mui-selected': {
                    bgcolor: 'rgba(99, 102, 241, 0.15)',
                  },
                  '&:hover .action-btn': {
                    opacity: 1,
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <ChatIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                </ListItemIcon>
                {editingConversationId === convo.id ? (
                  <TextField
                    size="small"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSaveRename(convo.id)
                      } else if (e.key === 'Escape') {
                        handleCancelRename()
                      }
                    }}
                    onBlur={() => handleSaveRename(convo.id)}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    sx={{
                      flex: 1,
                      '& .MuiInputBase-input': {
                        py: 0.5,
                        fontSize: '0.875rem',
                      },
                      '& .MuiOutlinedInput-root': {
                        bgcolor: 'rgba(26, 26, 26, 0.6)',
                      },
                    }}
                  />
                ) : (
                  <ListItemText
                    primary={convo.title}
                    secondary={formatDate(convo.updated_at)}
                    primaryTypographyProps={{
                      noWrap: true,
                      variant: 'body2',
                    }}
                    secondaryTypographyProps={{
                      variant: 'caption',
                    }}
                  />
                )}
                {editingConversationId !== convo.id && (
                  <>
                    <IconButton
                      className="action-btn"
                      size="small"
                      onClick={(e) => handleStartRename(convo.id, convo.title, e)}
                      sx={{
                        opacity: 0,
                        transition: 'opacity 0.2s',
                        '&:hover': { color: 'primary.main' },
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      className="action-btn"
                      size="small"
                      onClick={(e) => handleDeleteConversation(convo.id, e)}
                      sx={{
                        opacity: 0,
                        transition: 'opacity 0.2s',
                        '&:hover': { color: 'error.main' },
                      }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </>
                )}
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>

      {/* Saving indicator */}
      {savingMessages && (
        <Box sx={{ p: 1, borderTop: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={12} />
          <Typography variant="caption" color="text.secondary">
            {t('assistant.saving')}
          </Typography>
        </Box>
      )}
    </Box>
  )

  return (
    <MediaDetailModalProvider enabled={openMediaInModal}>
      <Box sx={{ display: 'flex', height: '100%' }}>
        {/* Sidebar - inline when the surface has room */}
        {sidebarInline && (
          <Box
            sx={{
              width: 280,
              flexShrink: 0,
              borderInlineEnd: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            {sidebarContent}
          </Box>
        )}

        {/* Main Chat Area */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {/* Header */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              p: 2,
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(139, 92, 246, 0.15) 100%)',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  flexShrink: 0,
                }}
              >
                <SmartToyIcon sx={{ fontSize: 20, color: '#fff' }} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle1" fontWeight={600} noWrap>
                  {t('assistant.title')}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {t('assistant.subtitle')}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
              {!sidebarInline && (
                <Tooltip title={t('assistant.tooltipConversations')}>
                  <IconButton onClick={() => setHistoryOpen(true)} size="small">
                    <HistoryIcon />
                  </IconButton>
                </Tooltip>
              )}
              {!sidebarInline && (
                <Tooltip title={t('assistant.tooltipNewChat')}>
                  <IconButton onClick={handleNewChat} size="small">
                    <AddIcon />
                  </IconButton>
                </Tooltip>
              )}
              {headerActions}
            </Box>
          </Box>

          {/* AI capability warnings (chat not configured / no tool support).
              The wrapper collapses when the banner renders nothing. */}
          <Box sx={{ px: 2, pt: 2, '&:empty': { display: 'none' } }}>
            <AICapabilityBanner context="chat" onBeforeNavigate={onBeforeNavigate} />
          </Box>

          {/* Chat Content - Only this part remounts on conversation switch */}
          <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <ChatThreadArea
              key={activeConversationId || 'new'}
              conversationId={activeConversationId}
              historicalMessages={historicalMessages}
              suggestions={suggestions}
              setSavingMessages={setSavingMessages}
              fetchConversations={fetchConversations}
              onSaveError={handleSaveError}
            />
          </Box>
        </Box>
      </Box>

      {/* Conversation history for surfaces without the inline sidebar */}
      <Drawer
        anchor="left"
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sx={{ zIndex: theme.zIndex.modal + 1 }}
        PaperProps={{
          sx: {
            width: 300,
            maxWidth: '85vw',
            bgcolor: 'rgba(15, 15, 15, 0.95)',
            backgroundImage: 'none',
          },
        }}
      >
        {sidebarContent}
      </Drawer>

      <Snackbar
        open={!!errorKey}
        autoHideDuration={4000}
        onClose={() => setErrorKey(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setErrorKey(null)}
          severity="error"
          variant="filled"
          sx={{ width: '100%' }}
        >
          {errorKey ? t(errorKey) : ''}
        </Alert>
      </Snackbar>
    </MediaDetailModalProvider>
  )
}
