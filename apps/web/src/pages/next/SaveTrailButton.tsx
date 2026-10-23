import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@mui/material'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd'
import { CreatePlaylistDialog } from '@/components/CreatePlaylistDialog'
import type { TrailTitle } from './types'

interface SaveTrailButtonProps {
  /** The trail's titles, in the order it reads. */
  titles: readonly TrailTitle[]
}

/**
 * A trail as a playlist on the media server, through the same dialog (and the
 * same graph-playlist route) the Explore graph saves with, so naming, the AI
 * name and description and the playlist page all behave as they do there.
 */
export function SaveTrailButton({ titles }: SaveTrailButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (titles.length < 2) return null
  const first = titles[0]
  return (
    <>
      <Button size="small" startIcon={<PlaylistAddIcon />} onClick={() => setOpen(true)}>
        {t('next.actions.savePlaylist')}
      </Button>
      <CreatePlaylistDialog
        open={open}
        onClose={() => setOpen(false)}
        nodes={titles.map((title) => ({
          id: title.id,
          title: title.title,
          year: title.year,
          type: title.type,
          poster_url: title.posterUrl,
        }))}
        sourceItemId={first.id}
        sourceItemType={first.type}
        onSuccess={() => setOpen(false)}
      />
    </>
  )
}
