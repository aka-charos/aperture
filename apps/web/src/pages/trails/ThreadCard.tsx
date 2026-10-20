import { useTranslation } from 'react-i18next'
import { Box, Button, CircularProgress, Paper, Typography } from '@mui/material'
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore'
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess'
import { TitleTile } from './TitleTile'
import { EntityAvatar } from './LinkCard'
import { KIND_COLOR, rarityText } from './labels'
import { useTrailText } from './useTrailText'
import type { Thread, ThreadMember, TrailTitle } from './types'

/** A thread opened in full: loading, its whole list, or a failure. */
export type OpenedThread = { status: 'loading' } | { status: 'open'; members: ThreadMember[] } | { status: 'failed' }

interface ThreadCardProps {
  thread: Thread
  /** The thread's full list when it has been opened; absent while closed. */
  opened?: OpenedThread
  onOpenAll: () => void
  onClose: () => void
  onOpen: (title: TrailTitle) => void
  onFollow: (title: TrailTitle, member: ThreadMember) => void
}

/**
 * One thread out of the current title: who or what it is, what it is here,
 * how many titles carry it, and the titles it leads to. Where it leads to more
 * than fit, "Show all" opens the whole list (a director's whole filmography
 * here) as a grid in place of the strip.
 */
export function ThreadCard({ thread, opened, onOpenAll, onClose, onOpen, onFollow }: ThreadCardProps) {
  const { t } = useTranslation()
  const { hereText } = useTrailText()
  const rarity = rarityText(thread.titleCount)
  const all = opened?.status === 'open' ? opened.members : null
  const members = all ?? thread.others
  const total = thread.others.length + thread.more

  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, borderInlineStart: 3, borderInlineStartColor: KIND_COLOR[thread.kind] }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.25, minWidth: 0 }}>
        <EntityAvatar entity={thread} size={36} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography fontWeight={600} noWrap>
            {thread.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {hereText(thread.kind, thread.roles)}
            {' · '}
            {rarity.key === 'trails.rarity.onlyTwo' ? t(rarity.key) : t(rarity.key, { count: rarity.count })}
          </Typography>
        </Box>
        {thread.more > 0 &&
          (all ? (
            <Button size="small" startIcon={<UnfoldLessIcon />} onClick={onClose} sx={{ flexShrink: 0 }}>
              {t('trails.thread.showFewer')}
            </Button>
          ) : (
            <Button
              size="small"
              startIcon={opened?.status === 'loading' ? <CircularProgress size={14} /> : <UnfoldMoreIcon />}
              disabled={opened?.status === 'loading'}
              onClick={onOpenAll}
              sx={{ flexShrink: 0 }}
            >
              {t('trails.thread.showAll', { count: total })}
            </Button>
          ))}
      </Box>
      {opened?.status === 'failed' && (
        <Typography variant="caption" color="warning.main" component="div" sx={{ mb: 1 }}>
          {t('trails.thread.loadFailed')}
        </Typography>
      )}
      <Box
        sx={
          all
            ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 1.5 }
            : { display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1, alignItems: 'flex-start' }
        }
      >
        {members.map((member) => (
          <TitleTile
            key={member.title.ref}
            title={member.title}
            onOpen={onOpen}
            onFollow={(title) => onFollow(title, member)}
            width={all ? '100%' : 104}
          />
        ))}
        {!all && thread.more > 0 && (
          <Box sx={{ alignSelf: 'center', px: 1, flexShrink: 0 }}>
            <Typography variant="body2" color="text.secondary">
              {t('trails.threads.more', { count: thread.more })}
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  )
}
