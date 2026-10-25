import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  TextField,
  Tooltip,
} from '@mui/material'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined'
import StrikethroughSIcon from '@mui/icons-material/StrikethroughS'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered'
import FormatQuoteIcon from '@mui/icons-material/FormatQuote'
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule'
import LinkIcon from '@mui/icons-material/Link'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import UndoIcon from '@mui/icons-material/Undo'
import RedoIcon from '@mui/icons-material/Redo'
import MovieIcon from '@mui/icons-material/Movie'
import { TitleCard } from './TitleCardNode'
import { TitlePickerDialog } from './TitlePickerDialog'
import type { TitleCardAttrs } from './fields'

/** http(s) only, like the email renderer; anything else is refused before it is stored. */
function normalizeLink(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function Toolbar({ editor, onInsertTitle }: { editor: Editor; onInsertTitle: () => void }) {
  const { t } = useTranslation()
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      link: e.isActive('link'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })

  const button = (label: string, icon: ReactNode, active: boolean, run: () => void, disabled = false) => (
    <Tooltip title={label} key={label}>
      <span>
        <IconButton
          size="small"
          disabled={disabled}
          onClick={run}
          color={active ? 'primary' : 'default'}
          sx={{ borderRadius: 1, bgcolor: active ? 'action.selected' : undefined }}
          aria-pressed={active}
          aria-label={label}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  )
  const textButton = (label: string, text: string, active: boolean, run: () => void) => (
    <Tooltip title={label} key={label}>
      <Button
        size="small"
        onClick={run}
        color={active ? 'primary' : 'inherit'}
        sx={{ minWidth: 36, px: 0.75, bgcolor: active ? 'action.selected' : undefined, fontWeight: 700 }}
        aria-pressed={active}
      >
        {text}
      </Button>
    </Tooltip>
  )
  const chain = () => editor.chain().focus()

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 0.25,
          p: 0.75,
          borderBottom: 1,
          borderColor: 'divider',
          position: 'sticky',
          top: 0,
          zIndex: 1,
          bgcolor: 'background.paper',
        }}
      >
        {textButton(t('newsletters.toolbar.heading'), 'H2', state.h2, () => chain().toggleHeading({ level: 2 }).run())}
        {textButton(t('newsletters.toolbar.subheading'), 'H3', state.h3, () => chain().toggleHeading({ level: 3 }).run())}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        {button(t('newsletters.toolbar.bold'), <FormatBoldIcon fontSize="small" />, state.bold, () => chain().toggleBold().run())}
        {button(t('newsletters.toolbar.italic'), <FormatItalicIcon fontSize="small" />, state.italic, () =>
          chain().toggleItalic().run()
        )}
        {button(t('newsletters.toolbar.underline'), <FormatUnderlinedIcon fontSize="small" />, state.underline, () =>
          chain().toggleUnderline().run()
        )}
        {button(t('newsletters.toolbar.strike'), <StrikethroughSIcon fontSize="small" />, state.strike, () =>
          chain().toggleStrike().run()
        )}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        {button(t('newsletters.toolbar.bulletList'), <FormatListBulletedIcon fontSize="small" />, state.bullet, () =>
          chain().toggleBulletList().run()
        )}
        {button(t('newsletters.toolbar.orderedList'), <FormatListNumberedIcon fontSize="small" />, state.ordered, () =>
          chain().toggleOrderedList().run()
        )}
        {button(t('newsletters.toolbar.quote'), <FormatQuoteIcon fontSize="small" />, state.quote, () =>
          chain().toggleBlockquote().run()
        )}
        {button(t('newsletters.toolbar.rule'), <HorizontalRuleIcon fontSize="small" />, false, () =>
          chain().setHorizontalRule().run()
        )}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        {button(t('newsletters.toolbar.link'), <LinkIcon fontSize="small" />, state.link, () => {
          setLinkValue((editor.getAttributes('link').href as string | undefined) ?? '')
          setLinkOpen(true)
        })}
        {button(t('newsletters.toolbar.unlink'), <LinkOffIcon fontSize="small" />, false, () => chain().unsetLink().run(), !state.link)}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        {button(t('newsletters.toolbar.undo'), <UndoIcon fontSize="small" />, false, () => chain().undo().run(), !state.canUndo)}
        {button(t('newsletters.toolbar.redo'), <RedoIcon fontSize="small" />, false, () => chain().redo().run(), !state.canRedo)}
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" startIcon={<MovieIcon />} onClick={onInsertTitle}>
          {t('newsletters.toolbar.insertTitle')}
        </Button>
      </Box>
      <Dialog open={linkOpen} onClose={() => setLinkOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('newsletters.toolbar.link')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            margin="dense"
            placeholder="https://"
            value={linkValue}
            onChange={(event) => setLinkValue(event.target.value)}
            error={linkValue.trim() !== '' && normalizeLink(linkValue) === null}
            helperText={t('newsletters.toolbar.linkHelp')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={normalizeLink(linkValue) === null}
            onClick={() => {
              const href = normalizeLink(linkValue)
              if (href) chain().extendMarkRange('link').setLink({ href }).run()
              setLinkOpen(false)
            }}
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

/** The newsletter body: rich text plus library title cards. */
export function NewsletterBodyEditor({
  initialContent,
  availableFields,
  defaultFields,
  onChange,
}: {
  /** Read once, when the editor mounts; remount (a `key`) to load another document. */
  initialContent: Record<string, unknown>
  availableFields: string[]
  defaultFields: string[]
  onChange: (doc: Record<string, unknown>) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  // The node view reads the field list through a getter, so options arriving
  // after the editor mounted still reach every card.
  const fieldsRef = useRef(availableFields)
  fieldsRef.current = availableFields

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true, protocols: ['http', 'https'] },
      }),
      TitleCard.configure({ availableFields: () => fieldsRef.current }),
    ],
    content: initialContent,
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as Record<string, unknown>),
  })

  if (!editor) return null
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Toolbar editor={editor} onInsertTitle={() => setPickerOpen(true)} />
      <Box
        onClick={() => editor.commands.focus()}
        sx={{
          minHeight: 360,
          cursor: 'text',
          '& .ProseMirror': {
            outline: 'none',
            minHeight: 340,
            px: 2.5,
            py: 2,
            fontSize: 15,
            lineHeight: 1.6,
            '& p': { my: 0.75 },
            '& h2': { fontSize: 20, fontWeight: 700, mt: 2, mb: 0.75 },
            '& h3': { fontSize: 17, fontWeight: 700, mt: 1.5, mb: 0.5 },
            '& blockquote': { borderInlineStart: 3, borderColor: 'divider', ps: 2, ms: 0, color: 'text.secondary' },
            '& a': { color: 'primary.main' },
            '& hr': { border: 0, borderTop: 1, borderColor: 'divider', my: 2 },
          },
        }}
      >
        <EditorContent editor={editor} />
      </Box>
      <TitlePickerDialog
        open={pickerOpen}
        availableFields={availableFields}
        defaultFields={defaultFields}
        onClose={() => setPickerOpen(false)}
        onInsert={(attrs: TitleCardAttrs) => {
          editor.chain().focus().insertContent({ type: 'titleCard', attrs }).run()
          setPickerOpen(false)
        }}
      />
    </Paper>
  )
}
