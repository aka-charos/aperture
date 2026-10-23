import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Link, Paper, Typography } from '@mui/material'
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore'
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess'
import { franchisePath, personPath, studioPath } from '../media-detail/helpers'
import { EntityAvatar } from './EntityAvatar'
import { TitleTile } from './TitleTile'
import { KIND_COLOR } from './trail'
import { useTrailText } from './useTrailText'
import type { TrailEntity, TrailTitle } from './types'
import { franchiseIdFromKey, rowMembers, rowNote, type RowNote } from './reasons'
import type { NextPeopleRow, NextRowMember } from './types'

/** Titles in the strip before "Show all" opens the rest in place. */
const STRIP_TITLES = 8

interface PeopleRowProps {
  row: NextPeopleRow
  /** The start's media type: what a company's skew was measured in. */
  startType: 'movie' | 'series'
  hideSeen: boolean
  onOpen: (title: TrailTitle) => void
  onStep: (row: NextPeopleRow, member: NextRowMember) => void
}

/** Where a row's name leads: the person's, studio's or franchise's own page. */
function entityPage(entity: TrailEntity): string | null {
  switch (entity.kind) {
    case 'person':
      return personPath(entity.name)
    case 'company':
      return studioPath(entity.name)
    case 'franchise': {
      const id = franchiseIdFromKey(entity.key)
      return id ? franchisePath(id) : null
    }
    default:
      return null
  }
}

/**
 * One of the people behind the start (or its franchise, or a studio or network
 * the viewer favours): their part in the start, what the viewer's record says
 * of them, and what else of theirs is in the library, unseen first. Seen titles
 * stay in the row, faded, so "you've seen four of his six" can be read off it.
 */
export function PeopleRow({ row, startType, hideSeen, onOpen, onStep }: PeopleRowProps) {
  const { t, i18n } = useTranslation()
  const { hereText } = useTrailText()
  const [expanded, setExpanded] = useState(false)
  const members = rowMembers(row, hideSeen)
  const shown = expanded ? members : members.slice(0, STRIP_TITLES)
  const page = entityPage(row.entity)
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value)
  const note = noteText(rowNote(row, startType), t, number)
  const leftOut = hideSeen ? row.moreUnseen : row.more

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderInlineStart: 3, borderInlineStartColor: KIND_COLOR[row.entity.kind] }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.25, minWidth: 0 }}>
        <EntityAvatar entity={row.entity} size={36} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography fontWeight={600} noWrap>
            {page ? (
              <Link component={RouterLink} to={page} color="inherit" underline="hover">
                {row.entity.name}
              </Link>
            ) : (
              row.entity.name
            )}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {hereText(row.entity.kind, row.rolesThere)}
            {' · '}
            <Box component="span" sx={{ color: row.favourite || row.company ? 'success.main' : undefined }}>
              {note}
            </Box>
          </Typography>
        </Box>
        {members.length > STRIP_TITLES && (
          <Button
            size="small"
            startIcon={expanded ? <UnfoldLessIcon /> : <UnfoldMoreIcon />}
            onClick={() => setExpanded((open) => !open)}
            sx={{ flexShrink: 0 }}
          >
            {expanded ? t('next.row.showFewer') : t('next.row.showAll', { count: members.length })}
          </Button>
        )}
      </Box>
      {members.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('next.row.allSeen')}
        </Typography>
      ) : (
        <Box
          sx={
            expanded
              ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 1.5 }
              : { display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1, alignItems: 'flex-start' }
          }
        >
          {shown.map((member) => (
            <Box key={member.title.ref} sx={{ opacity: member.seen ? 0.55 : 1, flexShrink: 0 }}>
              <TitleTile
                title={member.title}
                onOpen={onOpen}
                onFollow={() => onStep(row, member)}
                followLabel={t('next.actions.from', { title: member.title.title })}
                width={expanded ? '100%' : 104}
              />
            </Box>
          ))}
          {leftOut > 0 && (expanded || members.length <= STRIP_TITLES) && (
            <Box sx={{ alignSelf: 'center', px: 1, flexShrink: 0 }}>
              <Typography variant="body2" color="text.secondary">
                {t('next.row.more', { count: leftOut })}
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Paper>
  )
}

function noteText(
  note: RowNote,
  t: ReturnType<typeof useTranslation>['t'],
  number: (value: number) => string
): string {
  switch (note.key) {
    case 'next.row.favouriteRated':
      return t(note.key, { count: note.count, average: number(note.average) })
    case 'next.row.favourite':
      return t(note.key, { count: note.count })
    case 'next.row.companyMovies':
    case 'next.row.companySeries':
      return t(note.key, { ratio: number(note.ratio), count: note.count })
    case 'next.row.seenSome':
      return t(note.key, { seen: note.seen, count: note.total })
    case 'next.row.seenNone':
      return t(note.key, { count: note.total })
  }
}
