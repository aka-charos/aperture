import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
} from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { useServerDisplayName } from '@/hooks/useServerDisplayName'

/**
 * The bands the API offers, newest first.
 *
 * A hand copy of core's `WATCH_DATE_BANDS` — the web bundle never imports
 * core. The API sends the *decided* list for a given title, so this type only
 * has to name them for translation; which ones are possible is never worked
 * out here.
 */
export type WatchDateBand =
  | 'thisMonth'
  | 'lastMonth'
  | 'earlierThisYear'
  | 'lastYear'
  | 'longerAgo'

export interface WatchDatePromptRequest {
  movieId: string
  title: string
  bands: WatchDateBand[]
}

interface WatchDatePromptProps {
  request: WatchDatePromptRequest | null
  onClose: () => void
}

/**
 * "When did you watch {title}?" — asked once, after rating something the media
 * server says was never played.
 *
 * Two shapes, decided by how many bands survived the title's release date. With
 * several it is a ladder. With one — a film released days ago, where the only
 * possible answer is "this month" — it degenerates to a yes/no, because
 * silently marking it watched would be writing to someone's media server off
 * the back of a rating, which is not what they asked for.
 *
 * "I haven't seen it" is deliberately *not* a sixth rung. It is not a when, and
 * mixing it into a list of times turns a half-second choice into something
 * people stop and read. It sits below as the named dismissal instead: the same
 * click cost as closing the dialog, but a durable answer rather than a shrug.
 */
export function WatchDatePrompt({ request, onClose }: WatchDatePromptProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const serverName = useServerDisplayName()
  const [busy, setBusy] = useState(false)

  const open = request !== null
  const singleBand = request?.bands.length === 1

  // Every outcome closes the dialog, including a failure. The rating — the
  // thing they actually asked for — is already saved, so a media-server
  // hiccup must not trap them in a follow-up question they never wanted.
  const finish = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } catch (error) {
      console.error('Failed to record watch date:', error)
    } finally {
      setBusy(false)
      onClose()
    }
  }

  const choose = (band: WatchDateBand) =>
    finish(async () => {
      if (!request || !user) return
      await fetch(`/api/users/${user.id}/watch-history/movies/${request.movieId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ band }),
      })
    })

  const declineSeen = () =>
    finish(async () => {
      if (!request) return
      await fetch(`/api/ratings/movie/${request.movieId}/not-watched`, {
        method: 'POST',
        credentials: 'include',
      })
    })

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {singleBand
          ? t('watchDate.confirmTitle', { title: request?.title })
          : t('watchDate.title', { title: request?.title })}
      </DialogTitle>
      <DialogContent sx={{ pb: 1 }}>
        <DialogContentText variant="body2">
          {serverName
            ? t('watchDate.descriptionNamed', { serverName })
            : t('watchDate.description')}
        </DialogContentText>
        {!singleBand && (
          <List sx={{ mt: 1 }}>
            {request?.bands.map((band) => (
              <ListItemButton
                key={band}
                disabled={busy}
                onClick={() => choose(band)}
                sx={{ borderRadius: 1 }}
              >
                <ListItemText primary={t(`watchDate.bands.${band}`)} />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      {/* The two dismissals are not the same thing and must not look alike.
          "Not now" leaves the question open; "I haven't seen it" answers it and
          stops it being asked again. */}
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Stack
          direction={{ xs: 'column-reverse', sm: 'row' }}
          spacing={1}
          sx={{ width: '100%', justifyContent: 'space-between', alignItems: 'stretch' }}
        >
          <Button color="inherit" size="small" disabled={busy} onClick={declineSeen}>
            {t('watchDate.notSeen')}
          </Button>
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button color="inherit" size="small" disabled={busy} onClick={onClose}>
              {t('watchDate.notNow')}
            </Button>
            {singleBand && request && (
              <Button
                variant="contained"
                size="small"
                disabled={busy}
                onClick={() => choose(request.bands[0])}
              >
                {t('watchDate.confirmAction')}
              </Button>
            )}
          </Stack>
        </Stack>
      </DialogActions>
    </Dialog>
  )
}
