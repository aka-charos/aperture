import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import type { UIMessage } from 'ai'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import CheckIcon from '@mui/icons-material/Check'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import SendIcon from '@mui/icons-material/Send'
import StopIcon from '@mui/icons-material/Stop'
import { getProxiedImageUrl } from '@aperture/ui'
import { readStreamError } from '../../../../components/assistant/streamErrors'
import {
  proposalFrom,
  reachFrom,
  titleCardNode,
  titleChoicesFrom,
  toolErrorFrom,
  type EditorNode,
  type NewsletterAssistantHost,
  type Proposal,
  type TitleChoice,
} from './assistantParts'
import { useNewsletterAssistant } from './useNewsletterAssistant'

const STARTERS = ['whatsNew', 'intro', 'subjects', 'hiddenGems'] as const
const CHOICES_SHOWN = 6

function Thumb({ url }: { url: string | null }) {
  const src = url ? getProxiedImageUrl(url) : null
  return (
    <Box
      sx={{
        width: 32,
        height: 48,
        flex: '0 0 auto',
        borderRadius: 0.5,
        bgcolor: 'action.selected',
        backgroundImage: src ? `url("${src}")` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    />
  )
}

function TitleChoices({ choices, host }: { choices: TitleChoice[]; host: NewsletterAssistantHost }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? choices : choices.slice(0, CHOICES_SHOWN)
  return (
    <Stack spacing={0.75} sx={{ my: 1 }}>
      {shown.map((choice) => {
        const added = host.titlesInNewsletter.has(`${choice.mediaType}:${choice.id}`)
        return (
          <Stack key={`${choice.mediaType}:${choice.id}`} direction="row" spacing={1} alignItems="center">
            <Thumb url={choice.posterUrl} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600} noWrap>
                {choice.title}
                {choice.year ? ` (${choice.year})` : ''}
              </Typography>
              {choice.subtitle && (
                <Typography variant="caption" color="text.secondary" noWrap component="p">
                  {choice.subtitle}
                </Typography>
              )}
            </Box>
            {added ? (
              <Chip size="small" icon={<CheckIcon />} label={t('admin.newsletters.assistant.inNewsletter')} />
            ) : (
              <Button
                size="small"
                startIcon={<AddIcon />}
                disabled={!host.editable}
                onClick={() => host.insertNodes([titleCardNode(choice, host.defaultFields)])}
              >
                {t('admin.newsletters.assistant.add')}
              </Button>
            )}
          </Stack>
        )
      })}
      {choices.length > CHOICES_SHOWN && (
        <Button size="small" onClick={() => setExpanded((v) => !v)} sx={{ alignSelf: 'flex-start' }}>
          {expanded
            ? t('admin.newsletters.assistant.showFewer')
            : t('admin.newsletters.assistant.showMore', { count: choices.length - CHOICES_SHOWN })}
        </Button>
      )}
    </Stack>
  )
}

/** Inline text of a node, its bold/italic/link marks drawn. */
function Inline({ nodes }: { nodes?: EditorNode[] }) {
  return (
    <>
      {(nodes ?? []).map((node, index) => {
        if (node.type === 'hardBreak') return <br key={index} />
        let out: ReactNode = node.text ?? ''
        for (const mark of node.marks ?? []) {
          if (mark.type === 'bold') out = <strong>{out}</strong>
          else if (mark.type === 'italic') out = <em>{out}</em>
          else if (mark.type === 'link') out = <Box component="span" sx={{ color: 'primary.main', textDecoration: 'underline' }}>{out}</Box>
        }
        return <span key={index}>{out}</span>
      })}
    </>
  )
}

function ProposalPreview({ nodes }: { nodes: EditorNode[] }) {
  return (
    <Box sx={{ '& > *': { my: 0.75 } }}>
      {nodes.map((node, index) => {
        switch (node.type) {
          case 'heading':
            return (
              <Typography key={index} variant={node.attrs?.level === 3 ? 'subtitle2' : 'subtitle1'} fontWeight={700}>
                <Inline nodes={node.content} />
              </Typography>
            )
          case 'paragraph':
            return (
              <Typography key={index} variant="body2">
                <Inline nodes={node.content} />
              </Typography>
            )
          case 'bulletList':
          case 'orderedList':
            return (
              <Box key={index} component={node.type === 'bulletList' ? 'ul' : 'ol'} sx={{ ps: 2.5, my: 0 }}>
                {(node.content ?? []).map((item, i) => (
                  <Typography key={i} component="li" variant="body2">
                    {(item.content ?? []).map((p, j) => (
                      <Inline key={j} nodes={p.content} />
                    ))}
                  </Typography>
                ))}
              </Box>
            )
          case 'blockquote':
            return (
              <Typography
                key={index}
                variant="body2"
                color="text.secondary"
                sx={{ borderInlineStart: 3, borderColor: 'divider', ps: 1.5 }}
              >
                {(node.content ?? []).map((p, j) => (
                  <Inline key={j} nodes={p.content} />
                ))}
              </Typography>
            )
          case 'horizontalRule':
            return <Box key={index} component="hr" sx={{ border: 0, borderTop: 1, borderColor: 'divider' }} />
          case 'titleCard':
            return (
              <Stack
                key={index}
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ p: 0.75, borderRadius: 1, border: 1, borderColor: 'divider' }}
              >
                <Thumb url={typeof node.attrs?.posterUrl === 'string' ? node.attrs.posterUrl : null} />
                <Typography variant="body2" fontWeight={600}>
                  {String(node.attrs?.title ?? '')}
                  {typeof node.attrs?.year === 'number' ? ` (${node.attrs.year})` : ''}
                </Typography>
              </Stack>
            )
          default:
            return null
        }
      })}
    </Box>
  )
}

function ProposalCard({ proposal, host }: { proposal: Proposal; host: NewsletterAssistantHost }) {
  const { t } = useTranslation()
  const [done, setDone] = useState<'inserted' | 'replaced' | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [used, setUsed] = useState<{ subject?: boolean; preheader?: boolean }>({})

  if (proposal.problem) {
    return (
      <Alert severity="warning" sx={{ my: 1 }}>
        {t('admin.newsletters.assistant.proposalRefused', { reason: proposal.problem })}
      </Alert>
    )
  }

  const line = (kind: 'subject' | 'preheader', value: string, apply: (v: string) => void) => (
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
        <strong>{t(`admin.newsletters.editor.${kind}`)}:</strong> {value}
      </Typography>
      <Button
        size="small"
        disabled={!host.editable || used[kind]}
        startIcon={used[kind] ? <CheckIcon /> : undefined}
        onClick={() => {
          apply(value)
          setUsed((u) => ({ ...u, [kind]: true }))
        }}
      >
        {used[kind] ? t('admin.newsletters.assistant.used') : t('admin.newsletters.assistant.use')}
      </Button>
    </Stack>
  )

  return (
    <Paper variant="outlined" sx={{ my: 1, p: 1.5, borderRadius: 2, borderColor: 'primary.main' }}>
      <Typography variant="overline" color="primary" sx={{ lineHeight: 1.5 }}>
        {t('admin.newsletters.assistant.proposal')}
      </Typography>
      {proposal.subject && line('subject', proposal.subject, host.setSubject)}
      {proposal.preheader && line('preheader', proposal.preheader, host.setPreheader)}
      {proposal.content.length > 0 && (
        <>
          <Box sx={{ maxHeight: 360, overflowY: 'auto', my: 1, pe: 0.5 }}>
            <ProposalPreview nodes={proposal.content} />
          </Box>
          {proposal.droppedCount > 0 && (
            <Typography variant="caption" color="warning.main" component="p" sx={{ mb: 1 }}>
              {t('admin.newsletters.assistant.dropped', { count: proposal.droppedCount })}
            </Typography>
          )}
          {done ? (
            <Chip
              size="small"
              color="success"
              icon={<CheckIcon />}
              label={t(done === 'inserted' ? 'admin.newsletters.assistant.inserted' : 'admin.newsletters.assistant.replaced')}
            />
          ) : confirmReplace ? (
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="body2" sx={{ flex: 1, minWidth: 160 }}>
                {t('admin.newsletters.assistant.replaceConfirm')}
              </Typography>
              <Button size="small" onClick={() => setConfirmReplace(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                size="small"
                color="warning"
                variant="contained"
                onClick={() => {
                  host.replaceContent(proposal.content)
                  setDone('replaced')
                }}
              >
                {t('admin.newsletters.assistant.replace')}
              </Button>
            </Stack>
          ) : (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                size="small"
                variant="contained"
                disabled={!host.editable}
                onClick={() => {
                  host.insertNodes(proposal.content)
                  setDone('inserted')
                }}
              >
                {t('admin.newsletters.assistant.insert')}
              </Button>
              <Button size="small" disabled={!host.editable} onClick={() => setConfirmReplace(true)}>
                {t('admin.newsletters.assistant.replace')}
              </Button>
            </Stack>
          )}
        </>
      )}
    </Paper>
  )
}

type ToolPart = { type: string; state?: string; output?: unknown }

function ToolPartView({ part, host }: { part: ToolPart; host: NewsletterAssistantHost }) {
  const { t } = useTranslation()
  const name = part.type.slice('tool-'.length)
  if (part.state === 'output-error') {
    return <Chip size="small" color="warning" variant="outlined" label={t('admin.newsletters.assistant.toolFailed')} sx={{ my: 0.5 }} />
  }
  if (part.state !== 'output-available') {
    return (
      <Chip
        size="small"
        variant="outlined"
        icon={<CircularProgress size={12} />}
        label={t(`admin.newsletters.assistant.tools.${name}`, { defaultValue: t('admin.newsletters.assistant.tools.other') })}
        sx={{ my: 0.5 }}
      />
    )
  }
  const failure = toolErrorFrom(part.output)
  if (failure) {
    return (
      <Typography variant="caption" color="warning.main" component="p" sx={{ my: 0.5 }}>
        {failure}
      </Typography>
    )
  }
  if (name === 'proposeDraft') {
    const proposal = proposalFrom(part.output)
    return proposal ? <ProposalCard proposal={proposal} host={host} /> : null
  }
  if (name === 'checkAudienceReach') {
    const reach = reachFrom(part.output)
    if (!reach) return null
    return (
      <Box sx={{ my: 1 }}>
        {reach.note && (
          <Typography variant="caption" color="text.secondary" component="p">
            {reach.note}
          </Typography>
        )}
        {reach.rows.map((row) => (
          <Typography
            key={row.id}
            variant="body2"
            color={row.canOpen < row.of ? 'warning.main' : 'text.secondary'}
          >
            {t('admin.newsletters.assistant.reach', { title: row.title, count: row.canOpen, of: row.of })}
          </Typography>
        ))}
      </Box>
    )
  }
  const choices = titleChoicesFrom(part.output)
  if (choices.length > 0) return <TitleChoices choices={choices} host={host} />
  return (
    <Chip
      size="small"
      variant="outlined"
      icon={<CheckIcon />}
      label={t(`admin.newsletters.assistant.tools.${name}`, { defaultValue: t('admin.newsletters.assistant.tools.other') })}
      sx={{ my: 0.5, color: 'text.secondary' }}
    />
  )
}

function MessageView({ message, host }: { message: UIMessage; host: NewsletterAssistantHost }) {
  if (message.role === 'user') {
    const text = message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('')
    return (
      <Box sx={{ alignSelf: 'flex-end', maxWidth: '85%', bgcolor: 'action.selected', borderRadius: 2, px: 1.5, py: 1 }}>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {text}
        </Typography>
      </Box>
    )
  }
  return (
    <Box
      sx={{
        '& p': { my: 0.75 },
        '& ul, & ol': { my: 0.5, ps: 2.5 },
        fontSize: 14,
        lineHeight: 1.55,
      }}
    >
      {message.parts.map((part, index) => {
        if (part.type === 'text') {
          return part.text.trim() ? <ReactMarkdown key={index}>{part.text}</ReactMarkdown> : null
        }
        if (part.type.startsWith('tool-')) return <ToolPartView key={index} part={part as ToolPart} host={host} />
        return null
      })}
    </Box>
  )
}

/** The newsletter writing assistant, beside the editor. */
export default function NewsletterAssistantPanel({ host }: { host: NewsletterAssistantHost }) {
  const { t } = useTranslation()
  const { messages, running, phase, error, send, stop, reset } = useNewsletterAssistant(host.getDraft)
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Follow the answer as it arrives.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, running])

  const submit = (text: string) => {
    if (!text.trim() || running) return
    void send(text)
    setInput('')
  }

  const failure = error ? readStreamError(error) : null
  const phaseText = phase
    ? t(`admin.newsletters.assistant.status.${phase}`, {
        defaultValue: t(`assistant.status.${phase}`, { defaultValue: t('assistant.status.working') }),
      })
    : null

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <AutoAwesomeIcon fontSize="small" color="primary" />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          {t('admin.newsletters.assistant.title')}
        </Typography>
        <Tooltip title={t('admin.newsletters.assistant.newConversation')}>
          <span>
            <IconButton size="small" onClick={reset} disabled={messages.length === 0} aria-label={t('admin.newsletters.assistant.newConversation')}>
              <RestartAltIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Box ref={scrollRef} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1.5, py: 1.5 }}>
        {messages.length === 0 ? (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {t('admin.newsletters.assistant.intro')}
            </Typography>
            {!host.editable && <Alert severity="info">{t('admin.newsletters.assistant.readOnly')}</Alert>}
            <Stack direction="row" gap={1} flexWrap="wrap">
              {STARTERS.map((key) => (
                <Chip
                  key={key}
                  label={t(`admin.newsletters.assistant.starters.${key}`)}
                  onClick={() => submit(t(`admin.newsletters.assistant.starters.${key}`))}
                  variant="outlined"
                  clickable
                />
              ))}
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            {messages.map((message) => (
              <MessageView key={message.id} message={message} host={host} />
            ))}
          </Stack>
        )}
        {running && phaseText && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5, color: 'text.secondary' }}>
            <CircularProgress size={14} />
            <Typography variant="caption">{phaseText}</Typography>
          </Stack>
        )}
        {failure && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {t(failure.key)}
            {failure.detail && (
              <Typography variant="caption" component="pre" sx={{ whiteSpace: 'pre-wrap', m: 0, mt: 0.5, fontFamily: 'monospace' }}>
                {failure.detail}
              </Typography>
            )}
          </Alert>
        )}
      </Box>

      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault()
          submit(input)
        }}
        sx={{ display: 'flex', gap: 1, alignItems: 'flex-end', p: 1, borderTop: 1, borderColor: 'divider' }}
      >
        <TextField
          fullWidth
          size="small"
          multiline
          maxRows={6}
          placeholder={t('admin.newsletters.assistant.placeholder')}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit(input)
            }
          }}
        />
        {running ? (
          <IconButton onClick={stop} color="primary" aria-label={t('admin.newsletters.assistant.stop')}>
            <StopIcon />
          </IconButton>
        ) : (
          <IconButton type="submit" color="primary" disabled={!input.trim()} aria-label={t('admin.newsletters.assistant.send')}>
            <SendIcon />
          </IconButton>
        )}
      </Box>
    </Paper>
  )
}
