import { useState, useEffect, useCallback, type MouseEvent } from 'react'

export interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
}

// Message format from our backend
export interface BackendMessage {
  id: string
  role: string
  content: string
  tool_invocations?: Array<{
    toolCallId: string
    toolName: string
    args: unknown
    result?: unknown
  }>
  created_at: string
}

/**
 * Conversation state + CRUD shared by every assistant surface (modal, dock,
 * dedicated /assistant page). `active` gates initialization: the floating
 * surface passes its open state, the page passes true.
 */
export function useAssistantChat(active: boolean) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [savingMessages, setSavingMessages] = useState(false)
  const [historicalMessages, setHistoricalMessages] = useState<BackendMessage[]>([])
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  // Surfaces conversation CRUD / message-save failures that were previously
  // console-only (same pattern as the ContentCarousel favorite snackbar).
  // Stores the i18n key, translated at render, so handlers don't depend on t.
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const notifyError = useCallback((key: string) => setErrorKey(key), [])
  const handleSaveError = useCallback(
    () => notifyError('assistant.errorMessagesSave'),
    [notifyError]
  )

  // Fetch personalized suggestions
  const fetchSuggestions = useCallback(async () => {
    try {
      const res = await fetch('/api/assistant/suggestions', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setSuggestions(data.suggestions || [])
      }
    } catch {
      // Silently fail - will use default suggestions
    }
  }, [])

  // Fetch conversations when the surface opens
  const fetchConversations = useCallback(async () => {
    setLoadingConversations(true)
    try {
      const res = await fetch('/api/assistant/conversations', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setConversations(data.conversations || [])
      }
    } catch (err) {
      console.error('Failed to fetch conversations:', err)
    } finally {
      setLoadingConversations(false)
    }
  }, [])

  // Re-pull the active conversation from the backend. Used whenever the
  // thread (re)mounts - reopen, surface toggle - so turns saved since the
  // first load (possibly from another surface) reappear.
  const refreshConversation = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/assistant/conversations/${conversationId}`, {
        credentials: 'include',
      })
      if (res.ok) {
        const data = await res.json()
        setHistoricalMessages(data.messages || [])
      }
    } catch {
      // Keep the messages we already have
    }
  }, [])

  // Initialize chat when the surface becomes active - load most recent
  // conversation or create a new one
  useEffect(() => {
    if (!active) return

    const initializeChat = async () => {
      try {
        // Fetch all conversations
        const res = await fetch('/api/assistant/conversations', { credentials: 'include' })
        if (!res.ok) return

        const data = await res.json()
        const convos: Conversation[] = data.conversations || []
        setConversations(convos)

        // If we already have an active conversation, keep it - but re-pull
        // its messages: turns may have been saved from another surface or a
        // previous open session since this snapshot was taken.
        if (activeConversationId) {
          refreshConversation(activeConversationId)
          fetchSuggestions()
          return
        }

        if (convos.length > 0) {
          // Load most recent conversation
          const mostRecent = convos[0]
          const msgRes = await fetch(`/api/assistant/conversations/${mostRecent.id}`, {
            credentials: 'include',
          })
          if (msgRes.ok) {
            const msgData = await msgRes.json()
            const backendMessages = msgData.messages || []
            setHistoricalMessages(backendMessages)
            setActiveConversationId(mostRecent.id)
            fetchSuggestions()
            return
          }
        }

        // No conversations exist - create new one
        const createRes = await fetch('/api/assistant/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        })
        if (createRes.ok) {
          const createData = await createRes.json()
          setActiveConversationId(createData.conversation.id)
          setConversations(prev => [createData.conversation, ...prev])
        }
        fetchSuggestions()
      } catch (err) {
        console.error('Failed to initialize chat:', err)
        notifyError('assistant.errorConversationLoad')
      }
    }

    initializeChat()
  }, [active, activeConversationId, fetchSuggestions, notifyError, refreshConversation])

  const handleNewChat = async () => {
    // Clear messages first to trigger remount with empty state
    setHistoricalMessages([])

    // Create a new conversation in the backend
    try {
      const res = await fetch('/api/assistant/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      })
      if (res.ok) {
        const data = await res.json()
        // Set to null first to force key change, then set new ID
        setActiveConversationId(null)
        // Use setTimeout to ensure React processes the null before setting new ID
        setTimeout(() => {
          setActiveConversationId(data.conversation.id)
        }, 0)
        fetchConversations()
      } else {
        const text = await res.text()
        console.error('Failed to create conversation:', text)
        notifyError('assistant.errorConversationCreate')
      }
    } catch (err) {
      console.error('Failed to create conversation:', err)
      notifyError('assistant.errorConversationCreate')
    }
  }

  const handleSelectConversation = async (conversationId: string) => {
    if (conversationId === activeConversationId) return

    try {
      const res = await fetch(`/api/assistant/conversations/${conversationId}`, {
        credentials: 'include',
      })
      if (res.ok) {
        const data = await res.json()
        const backendMessages = data.messages || []
        // Store raw backend messages for historical rendering
        setHistoricalMessages(backendMessages)
        // Setting the conversation ID after messages triggers remount with loaded messages
        setActiveConversationId(conversationId)
      } else {
        console.error('Failed to load conversation:', await res.text())
        notifyError('assistant.errorConversationLoad')
      }
    } catch (err) {
      console.error('Failed to load conversation:', err)
      notifyError('assistant.errorConversationLoad')
    }
  }

  const handleDeleteConversation = async (conversationId: string, e: MouseEvent) => {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/assistant/conversations/${conversationId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        setConversations(prev => prev.filter(c => c.id !== conversationId))
        if (activeConversationId === conversationId) {
          setHistoricalMessages([])
          setActiveConversationId(null)
        }
      } else {
        console.error('Failed to delete conversation:', await res.text())
        notifyError('assistant.errorConversationDelete')
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err)
      notifyError('assistant.errorConversationDelete')
    }
  }

  const handleStartRename = (conversationId: string, currentTitle: string, e: MouseEvent) => {
    e.stopPropagation()
    setEditingConversationId(conversationId)
    setEditTitle(currentTitle)
  }

  const handleCancelRename = () => {
    setEditingConversationId(null)
    setEditTitle('')
  }

  const handleSaveRename = async (conversationId: string) => {
    if (!editTitle.trim()) {
      handleCancelRename()
      return
    }

    try {
      const res = await fetch(`/api/assistant/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: editTitle.trim() }),
      })
      if (res.ok) {
        setConversations(prev =>
          prev.map(c => c.id === conversationId ? { ...c, title: editTitle.trim() } : c)
        )
      } else {
        console.error('Failed to rename conversation:', await res.text())
        notifyError('assistant.errorConversationRename')
      }
    } catch (err) {
      console.error('Failed to rename conversation:', err)
      notifyError('assistant.errorConversationRename')
    }
    handleCancelRename()
  }

  return {
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
    refreshConversation,
    handleNewChat,
    handleSelectConversation,
    handleDeleteConversation,
    handleStartRename,
    handleCancelRename,
    handleSaveRename,
  }
}

export type AssistantChatState = ReturnType<typeof useAssistantChat>
