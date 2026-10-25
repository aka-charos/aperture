import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import {
  Box,
  Chip,
  IconButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import TuneIcon from '@mui/icons-material/Tune'
import { getProxiedImageUrl } from '@aperture/ui'
import { FALLBACK_TITLE_FIELDS, fieldLabelKey, type TitleCardAttrs } from './fields'
import { TitleFieldPicker } from './TitleFieldPicker'

function TitleCardView({ node, updateAttributes, deleteNode, selected, extension }: ReactNodeViewProps) {
  const { t } = useTranslation()
  const raw = node.attrs as TitleCardAttrs
  // A document saved by anything else may carry a malformed list; draw it as none.
  const attrs = { ...raw, fields: Array.isArray(raw.fields) ? raw.fields : [] }
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const available = (extension.options as { availableFields: () => string[] }).availableFields()
  const poster = attrs.posterUrl ? getProxiedImageUrl(attrs.posterUrl) : null

  return (
    <NodeViewWrapper data-drag-handle="" contentEditable={false}>
      <Box
        sx={{
          display: 'flex',
          gap: 1.5,
          alignItems: 'flex-start',
          my: 1.5,
          p: 1.5,
          borderRadius: 2,
          border: 1,
          borderColor: selected ? 'primary.main' : 'divider',
          bgcolor: 'action.hover',
          cursor: 'grab',
        }}
      >
        <Box
          sx={{
            width: 56,
            height: 84,
            flex: '0 0 auto',
            borderRadius: 1,
            bgcolor: 'action.selected',
            backgroundImage: poster ? `url("${poster}")` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: attrs.fields.includes('poster') ? 1 : 0.35,
          }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700} noWrap>
            {attrs.title}
            {attrs.year ? ` (${attrs.year})` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t(attrs.mediaType === 'series' ? 'newsletters.editor.series' : 'newsletters.editor.movie')}
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.75 }}>
            {attrs.fields.length === 0 ? (
              <Typography variant="caption" color="warning.main">
                {t('newsletters.editor.noFields')}
              </Typography>
            ) : (
              attrs.fields.map((field) => (
                <Chip
                  key={field}
                  size="small"
                  variant="outlined"
                  label={t(fieldLabelKey(field, attrs.mediaType))}
                />
              ))
            )}
          </Stack>
        </Box>
        <Stack direction="row">
          <Tooltip title={t('newsletters.editor.chooseFields')}>
            <IconButton size="small" onClick={(event) => setAnchor(event.currentTarget)}>
              <TuneIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('newsletters.editor.removeTitle')}>
            <IconButton size="small" onClick={() => deleteNode()}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ p: 2, width: 420, maxWidth: '90vw' }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t('newsletters.editor.fieldsFor', { title: attrs.title })}
          </Typography>
          <TitleFieldPicker
            fields={attrs.fields}
            available={available}
            mediaType={attrs.mediaType}
            onChange={(fields) => updateAttributes({ fields })}
          />
          {attrs.fields.includes('fullPlot') && (
            <Typography variant="caption" color="warning.main" component="p" sx={{ mt: 1 }}>
              {t('newsletters.editor.fullPlotWarning')}
            </Typography>
          )}
        </Box>
      </Popover>
    </NodeViewWrapper>
  )
}

/**
 * A library title inside the newsletter. An atom: the admin moves, removes and
 * configures it, but its text is not editable here — the email reads the
 * title's facts when it is built, in each reader's language.
 */
export const TitleCard = Node.create<{ availableFields: () => string[] }>({
  name: 'titleCard',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { availableFields: () => FALLBACK_TITLE_FIELDS }
  },

  // Each attribute says how it survives HTML, because copy and paste go
  // through it: left to the default, an attribute comes back as the string
  // its HTML attribute held, so `fields` would arrive as "poster,year".
  addAttributes() {
    const text = (name: string, fallback: string | null) => ({
      default: fallback,
      parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`) ?? fallback,
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes[name] == null ? {} : { [`data-${name}`]: String(attributes[name]) },
    })
    return {
      mediaType: {
        ...text('mediaType', 'movie'),
        parseHTML: (element: HTMLElement) => (element.getAttribute('data-mediaType') === 'series' ? 'series' : 'movie'),
      },
      id: text('id', null),
      title: text('title', ''),
      posterUrl: text('posterUrl', null),
      year: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const year = Number.parseInt(element.getAttribute('data-year') ?? '', 10)
          return Number.isFinite(year) ? year : null
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.year == null ? {} : { 'data-year': String(attributes.year) },
      },
      fields: {
        default: [],
        parseHTML: (element: HTMLElement) => {
          try {
            const value: unknown = JSON.parse(element.getAttribute('data-fields') ?? '[]')
            return Array.isArray(value) ? value.filter((f): f is string => typeof f === 'string') : []
          } catch {
            return []
          }
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-fields': JSON.stringify(Array.isArray(attributes.fields) ? attributes.fields : []),
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-title-card]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-title-card': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TitleCardView)
  },
})
