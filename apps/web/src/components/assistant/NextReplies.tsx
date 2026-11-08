import { useEffect, useState } from 'react'
import { Box, Chip } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { useComposerRuntime, useThread } from '@assistant-ui/react'
import { nextRepliesTarget } from './nextRepliesTarget'
import { NARROW_THREAD, COMPACT_THREAD } from './density'

/**
 * Suggested replies under the newest answer (`POST …/conversations/:id/suggestions`).
 * Tapping one puts it in the message box as a draft to edit or send; nothing
 * is sent by the tap. Asked once per answer, after it has finished; a failed
 * request, or one answered after the reader moved on, shows nothing.
 */
export function NextReplies({ conversationId }: { conversationId: string | null }) {
  const { t } = useTranslation()
  const composer = useComposerRuntime()
  const target = useThread((s) => nextRepliesTarget(s.messages, s.isRunning))
  const [shown, setShown] = useState<{ for: string; replies: string[] } | null>(null)

  useEffect(() => {
    if (!target || !conversationId) return
    const controller = new AbortController()
    fetch(`/api/assistant/conversations/${encodeURIComponent(conversationId)}/suggestions`, {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { suggestions?: unknown } | null) => {
        const replies = Array.isArray(body?.suggestions)
          ? body.suggestions.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
          : []
        setShown({ for: target, replies })
      })
      .catch(() => {})
    return () => controller.abort()
  }, [target, conversationId])

  // Only for the answer they were written for: a new question clears them.
  if (!target || shown?.for !== target || shown.replies.length === 0) return null

  return (
    <Box
      role="group"
      aria-label={t('assistant.nextReplies.label')}
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        // In line with the answer text: past the avatar (36px) and the row gap.
        pl: 'calc(36px + 12px)',
        pb: 1.5,
        [COMPACT_THREAD]: { pl: 'calc(28px + 8px)', pb: 0.75 },
        [NARROW_THREAD]: { pl: 0 },
      }}
    >
      {shown.replies.map((reply) => (
        <Chip
          key={reply}
          label={reply}
          variant="outlined"
          clickable
          onClick={() => composer.setText(reply)}
          title={t('assistant.nextReplies.hint')}
          sx={{
            height: 'auto',
            maxWidth: '100%',
            py: 0.5,
            '& .MuiChip-label': { whiteSpace: 'normal', textAlign: 'start' },
          }}
        />
      ))}
    </Box>
  )
}
