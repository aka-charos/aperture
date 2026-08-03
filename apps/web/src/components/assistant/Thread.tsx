import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Box, Paper, Typography, Avatar, CircularProgress, TextField, IconButton, Button, Tooltip, Checkbox, FormControlLabel, Fab } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import SendIcon from '@mui/icons-material/Send'
import StopIcon from '@mui/icons-material/Stop'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import ReplayIcon from '@mui/icons-material/Replay'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import PersonIcon from '@mui/icons-material/Person'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ActionBarPrimitive,
  useAssistantState,
  useComposerRuntime,
  useMessage,
  useThread,
} from '@assistant-ui/react'
import type { TextMessagePartProps, ToolCallMessagePartProps } from '@assistant-ui/react'
import {
  ContentCarousel,
  ContentDetail,
  PersonResult,
  StatsDisplay,
  StudiosDisplay,
  getToolSkeleton,
  type ContentCarouselData,
  type ContentDetailData,
  type PersonResultData,
  type StatsData,
  type StudiosData,
} from './tool-ui'
import { ToolResultError } from './ToolResultError'
import { useUnwatchedOnly, setUnwatchedOnly } from './unwatchedPreference'
import { useStatusPhase, setStatusPhase } from './assistantStatus'
import { NARROW_THREAD, COMPACT_THREAD } from './density'
import { gradients, extraColors } from '@/theme'

/** Shared avatar geometry; it shrinks on a compact thread and goes on a narrow one. */
const avatarSx = {
  width: 36,
  height: 36,
  flexShrink: 0,
  [COMPACT_THREAD]: { width: 28, height: 28 },
  // Listed after the compact rule on purpose: both match below 480px, and the
  // later one wins.
  [NARROW_THREAD]: { display: 'none' },
}

/**
 * Bubbles cap their width so a wide panel doesn't hand the reader 200-character
 * lines. On a narrow one that cap is pure loss, so it lifts.
 */
const bubbleSx = (cap: string) => ({
  maxWidth: cap,
  p: 2,
  [COMPACT_THREAD]: { p: 1.5 },
  [NARROW_THREAD]: { maxWidth: '100%', p: 1.5 },
})

/**
 * One message's row. The gutter between rows is most of what a chat spends its
 * height on, so it closes up along with everything else.
 */
const messageRowSx = {
  display: 'flex',
  gap: 1.5,
  py: 1.5,
  [COMPACT_THREAD]: { gap: 1, py: 0.75 },
}

/** Air below a text bubble or a card block, before the next one. */
const partGapSx = { mb: 2, [COMPACT_THREAD]: { mb: 1.25 } }

// Custom link renderer for markdown (needs hooks for i18n)
function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const { t } = useTranslation()
  const theme = useTheme()
  const text = String(children)
  // The backend tags media-server play URLs with aperturePlay=1 (see api
  // helpers/mediaServer.ts). Text sniffing stays as a fallback for links in
  // conversations saved before the marker existed — it only matches English.
  const isPlayLink =
    href?.includes('aperturePlay=1') ||
    text.toLowerCase().includes('play') ||
    text.includes('▶️')

  if (isPlayLink && href) {
    return (
      <Button
        variant="contained"
        size="small"
        startIcon={<PlayArrowIcon />}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        sx={{
          mt: 1,
          background: gradients.primaryToSecondary,
          textTransform: 'none',
          '&:hover': {
            background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.secondary.dark} 100%)`,
          },
        }}
      >
        {t('assistant.playOnEmby')}
      </Button>
    )
  }

  return (
    <a
      href={href}
      target={href?.startsWith('/') ? undefined : '_blank'}
      rel={href?.startsWith('/') ? undefined : 'noopener noreferrer'}
      style={{
        color: theme.palette.primary.light,
        textDecoration: 'none',
      }}
    >
      {children}
    </a>
  )
}

// Render tool result based on tool name
function renderToolResult(toolName: string, result: unknown): React.ReactNode {
  if (!result || typeof result !== 'object') return null
  
  const data = result as Record<string, unknown>
  
  // Check if result has an error
  if ('error' in data && typeof data.error === 'string') {
    return <ToolResultError message={data.error} />
  }

  // Multi-carousel result (discovery: web "Recommendations" + embeddings "Also worth checking")
  if ('carousels' in data && Array.isArray(data.carousels)) {
    return (
      <>
        {(data.carousels as ContentCarouselData[]).map((c) => (
          <ContentCarousel key={c.id} data={c} />
        ))}
      </>
    )
  }

  // Content carousel tools (search, similar, recommendations, history, ratings, unwatched, top rated)
  if ('items' in data && Array.isArray(data.items)) {
    return <ContentCarousel data={data as unknown as ContentCarouselData} />
  }

  // Content detail tool
  if ('contentId' in data && 'actions' in data) {
    return <ContentDetail data={data as unknown as ContentDetailData} />
  }

  // Person search results
  if ('people' in data && Array.isArray(data.people)) {
    return <PersonResult data={data as unknown as PersonResultData} />
  }

  // Library stats
  if ('movieCount' in data && 'seriesCount' in data) {
    return <StatsDisplay data={data as unknown as StatsData} />
  }

  // Studios/networks
  if (('studios' in data && Array.isArray(data.studios)) || ('networks' in data && Array.isArray(data.networks))) {
    return <StudiosDisplay data={data as unknown as StudiosData} />
  }

  // Fallback - don't render anything for unrecognized tool results
  return null
}

// Tool UI component for rendering tool results (or skeleton while loading)
function ToolUI({ toolName, result }: { toolName: string; result: unknown }) {
  // Show skeleton if result is undefined (tool still running)
  if (result === undefined) {
    return <>{getToolSkeleton(toolName)}</>
  }
  return <>{renderToolResult(toolName, result)}</>
}

// User message component
function UserMessage() {
  const theme = useTheme()
  return (
    <MessagePrimitive.Root>
      <Box sx={{ ...messageRowSx, justifyContent: 'flex-end' }}>
        <Paper
          sx={{
            ...bubbleSx('80%'),
            bgcolor: theme.palette.primary.main,
            borderRadius: 2,
            borderStartEndRadius: 0,
          }}
        >
          <Typography variant="body1" sx={{ color: '#fff' }}>
            <MessagePrimitive.Content />
          </Typography>
        </Paper>
        <Avatar sx={{ ...avatarSx, bgcolor: extraColors.subtleBorder }}>
          <PersonIcon fontSize="small" />
        </Avatar>
      </Box>
    </MessagePrimitive.Root>
  )
}

// Backend stream errors arrive as "AI_ERROR:<code>:<detail>" (see api
// helpers/errors.ts). Map each stable code to localized copy; anything
// unparseable falls back to the generic message with the raw text as detail.
const STREAM_ERROR_KEYS: Record<string, string> = {
  not_configured: 'assistant.streamErrorNotConfigured',
  provider_auth: 'assistant.streamErrorProviderAuth',
  provider_quota: 'assistant.streamErrorProviderQuota',
  provider_model: 'assistant.streamErrorProviderModel',
  provider_unreachable: 'assistant.streamErrorProviderUnreachable',
  db_unavailable: 'assistant.streamErrorDbUnavailable',
}

// Shown inside the assistant message when its run failed (message status
// incomplete/error) — the regenerate button in the action bar stays available.
function AssistantMessageError() {
  const { t } = useTranslation()
  const status = useMessage((m) => m.status)
  if (status?.type !== 'incomplete' || status.reason !== 'error') return null

  const raw =
    typeof status.error === 'string'
      ? status.error
      : status.error instanceof Error
        ? status.error.message
        : ''
  const match = /^AI_ERROR:([a-z_]+):?([\s\S]*)$/.exec(raw)
  const key = match ? STREAM_ERROR_KEYS[match[1]] : undefined
  const detail = (match ? match[2] : raw).trim()

  return (
    <Box
      sx={{
        bgcolor: 'rgba(26, 26, 26, 0.7)',
        borderRadius: 2,
        my: 1,
        ...bubbleSx('90%'),
        borderInlineStart: '3px solid',
        borderColor: 'error.main',
      }}
    >
      <Typography variant="body2" sx={{ color: 'error.light' }}>
        {t(key ?? 'assistant.streamErrorGeneric')}
      </Typography>
      {detail && (
        <Typography
          variant="caption"
          color="text.secondary"
          component="pre"
          sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', m: 0, mt: 0.5 }}
        >
          {detail}
        </Typography>
      )}
    </Box>
  )
}

// Action bar under an assistant message: copy + regenerate.
// Auto-hides on non-last messages and while the thread is running.
function AssistantActionBar() {
  const { t } = useTranslation()
  const theme = useTheme()

  const iconButtonSx = {
    color: 'text.secondary',
    '&:hover': { color: theme.palette.primary.light },
  }

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      style={{ display: 'flex', gap: 4, marginTop: 4 }}
    >
      <Tooltip title={t('assistant.tooltipCopy')}>
        <ActionBarPrimitive.Copy asChild>
          <IconButton size="small" aria-label={t('assistant.tooltipCopy')} sx={iconButtonSx}>
            <MessagePrimitive.If copied>
              <CheckIcon sx={{ fontSize: 16 }} />
            </MessagePrimitive.If>
            <MessagePrimitive.If copied={false}>
              <ContentCopyIcon sx={{ fontSize: 16 }} />
            </MessagePrimitive.If>
          </IconButton>
        </ActionBarPrimitive.Copy>
      </Tooltip>
      <Tooltip title={t('assistant.tooltipRegenerate')}>
        <ActionBarPrimitive.Reload asChild>
          <IconButton size="small" aria-label={t('assistant.tooltipRegenerate')} sx={iconButtonSx}>
            <ReplayIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </ActionBarPrimitive.Reload>
      </Tooltip>
    </ActionBarPrimitive.Root>
  )
}

/**
 * Marks the outer row of an assistant answer. The scroll controls need to find
 * where the last answer starts, and both the live and the reloaded renderers
 * carry it so a mixed thread behaves the same either way.
 */
const ANSWER_MARKER_PROP = { 'data-aperture-answer': '' }

// Renderers live at module scope so MessagePrimitive.PartByIndex's memo (which
// compares component identity) survives the re-render every streamed token
// causes.
function AssistantTextPart({ text }: TextMessagePartProps) {
  const theme = useTheme()
  // Don't render empty text parts
  if (!text || !text.trim()) return null
  return (
    <Paper
      sx={{
        ...bubbleSx('90%'),
        ...partGapSx,
        bgcolor: 'rgba(26, 26, 26, 0.7)',
        borderRadius: 2,
        borderStartStartRadius: 0,
      }}
    >
      <Box
        sx={{
          '& p': { my: 1.5 },
          '& p:first-of-type': { mt: 0 },
          '& p:last-of-type': { mb: 0 },
          '& ul, & ol': { pl: 2, my: 1.5 },
          '& li': { mb: 0.75 },
          '& strong': { color: theme.palette.primary.light },
          '& code': {
            bgcolor: theme.palette.divider,
            px: 0.5,
            py: 0.25,
            borderRadius: 0.5,
            fontFamily: 'monospace',
          },
          '& img': {
            maxWidth: 120,
            height: 'auto',
            borderRadius: 1,
            display: 'block',
            my: 1.5,
          },
          '& hr': {
            border: 'none',
            borderTop: `1px solid ${extraColors.subtleBorder}`,
            my: 2.5,
          },
          '& blockquote': {
            borderInlineStart: `3px solid ${theme.palette.primary.main}`,
            pl: 2,
            my: 1.5,
            color: '#a1a1aa',
            fontStyle: 'italic',
          },
          '& h1, & h2, & h3, & h4': {
            mt: 2,
            mb: 1,
            color: '#e4e4e7',
          },
        }}
      >
        <ReactMarkdown components={{ a: MarkdownLink as Components['a'] }}>{text}</ReactMarkdown>
      </Box>
    </Paper>
  )
}

function AssistantToolPart({ toolName, result }: ToolCallMessagePartProps) {
  return (
    <Box sx={{ maxWidth: '100%', overflow: 'hidden', ...partGapSx }}>
      <ToolUI toolName={toolName} result={result} />
    </Box>
  )
}

const ASSISTANT_PART_COMPONENTS = {
  Text: AssistantTextPart,
  tools: { Fallback: AssistantToolPart },
}

/**
 * Renders the message's parts with every text part hoisted above everything else.
 *
 * The model calls its tools before it writes a word, so the parts arrive
 * tool-first and a live answer used to show its cards above its prose. The same
 * answer reloaded from the database showed prose first, because the save path
 * splits a message into a text column and a tool_invocations column and
 * HistoricalAssistantMessage renders them in that order. One answer, two
 * layouts, depending only on whether you had just asked for it.
 *
 * Reordering the indices rather than reordering with CSS `order` keeps the DOM
 * in reading order, so selection, copy and screen readers agree with the page.
 * Parts within each group keep their relative order.
 *
 * The part list MUST come from `useAssistantState` — the same store
 * `MessagePrimitive.PartByIndex` resolves an index against. `useMessage` is a
 * second, independent `useSyncExternalStore` subscription (over the legacy
 * message runtime), and there is no ordering guarantee between two stores: mid-
 * stream this component handed out an index the api store's part map did not
 * hold yet, `PartByIndex` threw "Resource not found for lookup" during render,
 * and with no boundary above it that unmounted the entire app.
 */
function OrderedMessageParts() {
  const parts = useAssistantState(({ message }) => message.parts)

  const order = useMemo(() => {
    const text: number[] = []
    const rest: number[] = []
    parts.forEach((part, index) => {
      ;(part.type === 'text' ? text : rest).push(index)
    })
    return [...text, ...rest]
  }, [parts])

  return (
    <>
      {order.map((index) => (
        <MessagePrimitive.PartByIndex key={index} index={index} components={ASSISTANT_PART_COMPONENTS} />
      ))}
    </>
  )
}

// Assistant message component
function AssistantMessage() {
  return (
    <MessagePrimitive.Root>
      <Box
        {...ANSWER_MARKER_PROP}
        sx={{
          ...messageRowSx,
          // Hide the entire row if content area is empty (no visible children)
          '&:has(.assistant-content:empty)': {
            display: 'none',
          },
        }}
      >
        <Avatar
          sx={{
            ...avatarSx,
            background: gradients.primaryToSecondary,
          }}
        >
          <SmartToyIcon fontSize="small" />
        </Avatar>
        <Box className="assistant-content" sx={{ flex: 1, minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}>
          <OrderedMessageParts />
          <AssistantMessageError />
          <AssistantActionBar />
        </Box>
      </Box>
    </MessagePrimitive.Root>
  )
}

// Thread welcome screen
function ThreadWelcome({ suggestions }: { suggestions: string[] }) {
  const { t } = useTranslation()
  const theme = useTheme()
  const composerRuntime = useComposerRuntime()

  const defaultSuggestions = [
    t('assistant.suggestion1'),
    t('assistant.suggestion2'),
    t('assistant.suggestion3'),
    t('assistant.suggestion4'),
  ]

  const displaySuggestions = suggestions.length > 0 ? suggestions : defaultSuggestions

  const handleSuggestionClick = (suggestion: string) => {
    composerRuntime.setText(suggestion)
    composerRuntime.send()
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        textAlign: 'center',
        p: 4,
      }}
    >
      <Avatar
        sx={{
          width: 64,
          height: 64,
          mb: 2,
          background: gradients.primaryToSecondary,
        }}
      >
        <SmartToyIcon sx={{ fontSize: 36 }} />
      </Avatar>
      <Typography variant="h5" sx={{ mb: 1, fontWeight: 600 }}>
        {t('assistant.welcomeTitle')}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 400 }}>
        {t('assistant.welcomeBody')}
      </Typography>
      <Box sx={{ mt: 3, display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
        {displaySuggestions.map((suggestion) => (
          <Paper
            key={suggestion}
            component="button"
            type="button"
            onClick={() => handleSuggestionClick(suggestion)}
            sx={{
              px: 2,
              py: 1,
              bgcolor: 'rgba(26, 26, 26, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 2,
              cursor: 'pointer',
              transition: 'all 0.2s',
              '&:hover': {
                bgcolor: '#252525',
                borderColor: theme.palette.primary.main,
              },
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {suggestion}
            </Typography>
          </Paper>
        ))}
      </Box>
    </Box>
  )
}

/**
 * How long one phase may sit before the line falls back to a neutral "Still
 * working…". The server's phases are real signals, but a few are genuinely long
 * (candidate gathering backs off on a provider rate limit), and a line that
 * hasn't moved in this long reads as a hang.
 */
const PHASE_STALL_MS = 12_000

// Loading indicator — shows the server's current work phase, or "Thinking…"
function LoadingIndicator() {
  const { t } = useTranslation()
  const phase = useStatusPhase()
  const [stalled, setStalled] = useState(false)

  // Restart the stall clock whenever the phase advances.
  useEffect(() => {
    setStalled(false)
    const timer = setTimeout(() => setStalled(true), PHASE_STALL_MS)
    return () => clearTimeout(timer)
  }, [phase])

  // This component is mounted only while the thread is running, so unmounting is
  // the end of the turn — drop the phase so the next one opens on "Thinking…"
  // rather than the previous answer's last step.
  useEffect(() => () => setStatusPhase(null), [])

  // defaultValue: a phase the server has added but this locale hasn't picked up
  // yet degrades to "Thinking…" instead of rendering a raw key.
  const label = stalled
    ? t('assistant.status.stillWorking')
    : phase
      ? t(`assistant.status.${phase}`, { defaultValue: t('assistant.thinking') })
      : t('assistant.thinking')

  return (
    <Box sx={messageRowSx}>
      <Avatar
        sx={{
          ...avatarSx,
          background: gradients.primaryToSecondary,
        }}
      >
        <SmartToyIcon fontSize="small" />
      </Avatar>
      <Paper
        sx={{
          ...bubbleSx('80%'),
          bgcolor: 'rgba(26, 26, 26, 0.7)',
          borderRadius: 2,
          borderStartStartRadius: 0,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
          <CircularProgress size={16} />
          <Typography variant="body2">{label}</Typography>
        </Box>
      </Paper>
    </Box>
  )
}

// Composer component
function Composer() {
  const { t } = useTranslation()
  const theme = useTheme()
  const composerRuntime = useComposerRuntime()
  const unwatchedOnly = useUnwatchedOnly()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    composerRuntime.send()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      composerRuntime.send()
    }
  }

  return (
    <ComposerPrimitive.Root>
      <Box sx={{ px: 1.5, py: 1.25, borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
        {/* Applies to every message in every conversation until turned off —
            it is a standing preference, not a per-message option. */}
        <Tooltip title={t('assistant.unwatchedOnlyHint')} placement="top-start">
          <FormControlLabel
            sx={{ ml: 0, mb: 0.25 }}
            control={
              <Checkbox
                size="small"
                checked={unwatchedOnly}
                onChange={(e) => setUnwatchedOnly(e.target.checked)}
                sx={{ p: 0.5, mr: 0.75, color: '#71717a', '&.Mui-checked': { color: theme.palette.primary.main } }}
              />
            }
            label={
              <Typography variant="caption" sx={{ color: unwatchedOnly ? '#a5b4fc' : '#a1a1aa' }}>
                {t('assistant.unwatchedOnly')}
              </Typography>
            }
          />
        </Tooltip>
        <form onSubmit={handleSubmit} style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <ComposerPrimitive.Input asChild>
            <TextField
              fullWidth
              multiline
              maxRows={4}
              placeholder={t('assistant.placeholder')}
              onKeyDown={handleKeyDown}
              sx={{
                '& .MuiOutlinedInput-root': {
                  bgcolor: 'rgba(26, 26, 26, 0.7)',
                  borderRadius: 3,
                  '& fieldset': {
                    borderColor: theme.palette.divider,
                  },
                  '&:hover fieldset': {
                    borderColor: extraColors.subtleBorder,
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: theme.palette.primary.main,
                  },
                },
                '& .MuiInputBase-input': {
                  py: 1.25,
                },
              }}
            />
          </ComposerPrimitive.Input>
          <ThreadPrimitive.If running={false}>
            <ComposerPrimitive.Send asChild>
              <IconButton
                type="submit"
                sx={{
                  bgcolor: theme.palette.primary.main,
                  color: '#fff',
                  width: 40,
                  height: 40,
                  '&:hover': {
                    bgcolor: theme.palette.primary.dark,
                  },
                  '&:disabled': {
                    bgcolor: extraColors.subtleBorder,
                    color: '#666',
                  },
                }}
              >
                <SendIcon />
              </IconButton>
            </ComposerPrimitive.Send>
          </ThreadPrimitive.If>
          <ThreadPrimitive.If running>
            <ComposerPrimitive.Cancel asChild>
              <IconButton
                type="button"
                aria-label={t('assistant.tooltipStop')}
                sx={{
                  bgcolor: theme.palette.primary.main,
                  color: '#fff',
                  width: 40,
                  height: 40,
                  '&:hover': {
                    bgcolor: theme.palette.primary.dark,
                  },
                }}
              >
                <StopIcon />
              </IconButton>
            </ComposerPrimitive.Cancel>
          </ThreadPrimitive.If>
        </form>
      </Box>
    </ComposerPrimitive.Root>
  )
}

// Historical message type (from backend)
interface HistoricalMessage {
  id: string
  role: string
  content: string
  tool_invocations?: Array<{
    toolCallId: string
    toolName: string
    args: unknown
    result?: unknown
  }>
}

// Render a historical user message
function HistoricalUserMessage({ message }: { message: HistoricalMessage }) {
  const theme = useTheme()
  return (
    <Box sx={{ ...messageRowSx, justifyContent: 'flex-end' }}>
      <Paper
        sx={{
          ...bubbleSx('80%'),
          bgcolor: theme.palette.primary.main,
          borderRadius: 2,
          borderStartEndRadius: 0,
        }}
      >
        <Typography variant="body1" sx={{ color: '#fff' }}>
          {message.content}
        </Typography>
      </Paper>
      <Avatar sx={{ ...avatarSx, bgcolor: extraColors.subtleBorder }}>
        <PersonIcon fontSize="small" />
      </Avatar>
    </Box>
  )
}

// Render a historical assistant message
function HistoricalAssistantMessage({ message }: { message: HistoricalMessage }) {
  return (
    <Box {...ANSWER_MARKER_PROP} sx={messageRowSx}>
      <Avatar
        sx={{
          ...avatarSx,
          background: gradients.primaryToSecondary,
        }}
      >
        <SmartToyIcon fontSize="small" />
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}>
        {/* Render text content */}
        {message.content && (
          <Paper
            sx={{
              ...bubbleSx('90%'),
              ...partGapSx,
              bgcolor: 'rgba(26, 26, 26, 0.7)',
              borderRadius: 2,
              borderStartStartRadius: 0,
            }}
          >
            <Box
              sx={{
                '& p': { my: 1.5 },
                '& p:first-of-type': { mt: 0 },
                '& p:last-of-type': { mb: 0 },
              }}
            >
              <ReactMarkdown components={{ a: MarkdownLink as Components['a'] }}>{message.content}</ReactMarkdown>
            </Box>
          </Paper>
        )}
        {/* Render tool results */}
        {message.tool_invocations?.map((invocation) => (
          <Box key={invocation.toolCallId} sx={{ maxWidth: '100%', overflow: 'hidden', ...partGapSx }}>
            <ToolUI toolName={invocation.toolName} result={invocation.result} />
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/** Treat this close to the bottom of the viewport as "at the bottom". */
const AT_BOTTOM_SLOP = 8
/**
 * How far the last answer's top edge must sit above the viewport before the
 * "back to the answer" control appears — enough slop that it doesn't flicker on
 * when the answer is already essentially in view.
 */
const ANSWER_ABOVE_SLOP = 24
/** Breathing room left above the answer when jumping to it. */
const ANSWER_SCROLL_PADDING = 12

/**
 * Floating scroll controls for the thread, plus the anchor that usually makes
 * them unnecessary.
 *
 * An answer's prose is one screen; its cards are several. Classic chat pins the
 * viewport to the bottom, which used to be where the prose was — now that it
 * renders first (see OrderedMessageParts) that pin leaves the reader staring at
 * the tail of a card list while the actual answer is written far above them.
 *
 * So once per turn we scroll the start of the answer to the top of the viewport:
 * the moment prose appears, or when the turn ends if it never does. The text
 * then streams downward in full view and the cards follow it, which is the
 * order it all wants to be read in. The anchor is skipped if the reader has
 * scrolled away — scrolling is how someone says they're steering, and we don't
 * take the wheel back.
 *
 * The controls then cover what the anchor can't: re-reading an older answer, or
 * returning to the newest one after wandering up the thread.
 */
function ThreadScrollControls({ viewportRef }: { viewportRef: RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation()
  const theme = useTheme()
  const isRunning = useThread((s) => s.isRunning)
  // Boolean, not the message — this re-evaluates on every streamed token and
  // must only re-render the controls when the answer first finds its words.
  const answerHasText = useThread((s) => {
    const last = s.messages[s.messages.length - 1]
    if (last?.role !== 'assistant') return false
    return last.content.some((part) => part.type === 'text' && part.text.trim().length > 0)
  })
  const [{ answerAbove, atBottom }, setPosition] = useState({ answerAbove: false, atBottom: true })

  /** Pixels the viewport must scroll for the last answer to start at its top. */
  const answerDelta = useCallback((): number | null => {
    const viewport = viewportRef.current
    if (!viewport) return null
    const answers = viewport.querySelectorAll('[data-aperture-answer]')
    for (let i = answers.length - 1; i >= 0; i--) {
      const rect = answers[i].getBoundingClientRect()
      // An answer whose parts haven't arrived yet is display:none (see
      // AssistantMessage) and reports an empty box at the origin — jumping to
      // that would be a jump to nowhere. Fall back to the last real one.
      if (rect.height > 0) return rect.top - viewport.getBoundingClientRect().top
    }
    return null
  }, [viewportRef])

  const scrollToAnswer = useCallback(() => {
    const viewport = viewportRef.current
    const delta = answerDelta()
    if (!viewport || delta === null) return
    viewport.scrollTo({ top: viewport.scrollTop + delta - ANSWER_SCROLL_PADDING, behavior: 'smooth' })
  }, [answerDelta, viewportRef])

  const scrollToLatest = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
  }, [viewportRef])

  // Content only grows while the viewport is pinned to the bottom, and pinning
  // scrolls — so a scroll listener catches every change that matters. The
  // isRunning dependency re-measures across a turn boundary, where the last
  // answer changes identity without anything scrolling.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    let frame = 0
    const measure = () => {
      frame = 0
      const delta = answerDelta()
      const next = {
        answerAbove: delta !== null && delta < -ANSWER_ABOVE_SLOP,
        atBottom: viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < AT_BOTTOM_SLOP,
      }
      setPosition((prev) =>
        prev.answerAbove === next.answerAbove && prev.atBottom === next.atBottom ? prev : next
      )
    }
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }

    measure()
    viewport.addEventListener('scroll', schedule, { passive: true })
    return () => {
      viewport.removeEventListener('scroll', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [answerDelta, viewportRef, isRunning])

  // Starts latched so opening a conversation lands where it always has — at the
  // bottom — rather than yanking the last saved answer up on arrival. Only a
  // fresh turn unlatches it.
  const anchored = useRef(true)
  useEffect(() => {
    if (isRunning) anchored.current = false
  }, [isRunning])

  useEffect(() => {
    if (anchored.current) return
    // Still mid-turn with nothing written yet: there's no answer to anchor to.
    if (isRunning && !answerHasText) return

    const viewport = viewportRef.current
    if (!viewport) return
    if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight >= AT_BOTTOM_SLOP) return

    const delta = answerDelta()
    // Only ever scroll up: an answer short enough to already fit needs nothing.
    if (delta === null || delta >= -ANSWER_ABOVE_SLOP) return

    anchored.current = true
    scrollToAnswer()
  }, [isRunning, answerHasText, answerDelta, scrollToAnswer, viewportRef])

  // Mid-turn, before a word is written, the newest thing above the reader is the
  // *previous* answer — offering to jump there would be answering a question
  // nobody asked. Down-to-latest stays available throughout.
  const showAnswerButton = answerAbove && (!isRunning || answerHasText)
  if (!showAnswerButton && atBottom) return null

  const fabSx = {
    bgcolor: 'rgba(26, 26, 26, 0.92)',
    color: 'text.secondary',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    '&:hover': { bgcolor: '#252525', color: theme.palette.primary.light },
  }

  return (
    <Box
      sx={{
        position: 'absolute',
        insetInlineEnd: 16,
        bottom: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        zIndex: 2,
      }}
    >
      {showAnswerButton && (
        <Tooltip title={t('assistant.scrollToAnswer')} placement="left">
          <Fab size="small" onClick={scrollToAnswer} aria-label={t('assistant.scrollToAnswer')} sx={fabSx}>
            <ArrowUpwardIcon fontSize="small" />
          </Fab>
        </Tooltip>
      )}
      {!atBottom && (
        <Tooltip title={t('assistant.scrollToLatest')} placement="left">
          <Fab size="small" onClick={scrollToLatest} aria-label={t('assistant.scrollToLatest')} sx={fabSx}>
            <ArrowDownwardIcon fontSize="small" />
          </Fab>
        </Tooltip>
      )}
    </Box>
  )
}

// Props for Thread component
interface ThreadProps {
  historicalMessages?: HistoricalMessage[]
  suggestions?: string[]
}

// Main Thread component
export function Thread({ historicalMessages = [], suggestions = [] }: ThreadProps) {
  const hasHistoricalMessages = historicalMessages.length > 0
  const viewportRef = useRef<HTMLDivElement | null>(null)

  return (
    <ThreadPrimitive.Root
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'transparent',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      {/* The scroll controls float over the viewport, so they need a positioned
          box that is not the viewport itself — the viewport scrolls, and its
          container-type makes it the containing block for anything inside it. */}
      <Box sx={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>
        {/* Messages */}
        <ThreadPrimitive.Viewport
          ref={viewportRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            // A plain value rather than a responsive one: this element *is* the
            // query container, and a container cannot style itself off its own
            // width. The rows inside it carry the density instead.
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            minWidth: 0,
            // Query target for NARROW_THREAD. The thread is squeezed by things the
            // viewport knows nothing about — the dock's width, a dialog on a phone
            // — so its own box is the only honest source for "how narrow are we".
            containerName: 'assistantThread',
            containerType: 'inline-size',
          }}
        >
          {/* Show welcome only if no historical messages */}
          {!hasHistoricalMessages && (
            <ThreadPrimitive.Empty>
              <ThreadWelcome suggestions={suggestions} />
            </ThreadPrimitive.Empty>
          )}

          {/* Render historical messages manually */}
          {historicalMessages.map((msg) => (
            msg.role === 'user'
              ? <HistoricalUserMessage key={msg.id} message={msg} />
              : <HistoricalAssistantMessage key={msg.id} message={msg} />
          ))}

          {/* Runtime handles new messages */}
          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              AssistantMessage,
            }}
          />

          <ThreadPrimitive.If running>
            <LoadingIndicator />
          </ThreadPrimitive.If>
        </ThreadPrimitive.Viewport>

        <ThreadScrollControls viewportRef={viewportRef} />
      </Box>

      {/* Composer */}
      <Composer />
    </ThreadPrimitive.Root>
  )
}
