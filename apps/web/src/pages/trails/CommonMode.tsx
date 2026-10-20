import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Box, Button, CircularProgress, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import AltRouteIcon from '@mui/icons-material/AltRoute'
import { getProxiedImageUrl } from '@aperture/ui'
import { TitlePicker } from './TitlePicker'
import { TitleTile } from './TitleTile'
import { EntityAvatar } from './LinkCard'
import { fetchTrails, isAbort, useAnswers } from './api'
import { KIND_COLOR, rarityText } from './labels'
import { useTrailText } from './useTrailText'
import type { CommonResponse, TrailTitle } from './types'

interface CommonModeProps {
  titles: string[]
  cards: ReadonlyMap<string, TrailTitle>
  remember: (titles: readonly TrailTitle[]) => void
  onChange: (titles: string[]) => void
  /** The API's limit, once known. */
  maxTitles: number | null
  onOpen: (title: TrailTitle) => void
  onFollow: (title: TrailTitle) => void
  /** Look for the trail between two titles that share nothing. */
  onConnect: (from: string, to: string) => void
}


/**
 * What several titles have in common: the people, franchises, companies and
 * keywords at least two of them share, shared by more of them first, rarer
 * first among those.
 */
export function CommonMode({ titles, cards, remember, onChange, maxTitles, onOpen, onFollow, onConnect }: CommonModeProps) {
  const { t } = useTranslation()
  const { role } = useTrailText()
  const { answers, hasAnswer, store, failure, fail, clearFailure } = useAnswers<CommonResponse>()
  const key = titles.length >= 2 ? titles.join(',') : null
  const failedHere = key != null && failure?.key === key

  useEffect(() => {
    if (!key || hasAnswer(key) || failedHere) return
    const controller = new AbortController()
    clearFailure()
    fetchTrails<CommonResponse>(`common?titles=${encodeURIComponent(key)}`, controller.signal)
      .then((response) => {
        remember(response.titles)
        store(key, response)
      })
      .catch((caught) => {
        if (isAbort(caught)) return
        fail(key, t('trails.errors.load'))
      })
    return () => controller.abort()
  }, [key, hasAnswer, failedHere, remember, store, fail, clearFailure, t])

  const full = maxTitles != null && titles.length >= maxTitles
  const response = key ? (answers.get(key) ?? null) : null
  const error = failure != null && failure.key === key ? failure.message : null
  const chosen = titles.map((ref) => cards.get(ref)).filter((card): card is TrailTitle => card != null)

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TitlePicker
          label={t('trails.common.add')}
          value={null}
          clearOnPick
          exclude={titles}
          disabled={full}
          onChange={(picked) => {
            if (!picked || titles.includes(picked.ref)) return
            remember([picked])
            onChange([...titles, picked.ref])
          }}
        />
        {maxTitles != null && (
          <Typography variant="caption" color="text.secondary">
            {t('trails.common.max', { count: maxTitles })}
          </Typography>
        )}
      </Box>

      {chosen.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {chosen.map((card) => (
            <Box key={card.ref} sx={{ position: 'relative' }}>
              <TitleTile title={card} onOpen={onOpen} onFollow={onFollow} width={104} />
              <Tooltip title={t('trails.common.remove', { title: card.title })}>
                <IconButton
                  size="small"
                  aria-label={t('trails.common.remove', { title: card.title })}
                  onClick={() => onChange(titles.filter((ref) => ref !== card.ref))}
                  sx={{
                    position: 'absolute',
                    top: -10,
                    insetInlineEnd: -10,
                    bgcolor: 'background.paper',
                    border: 1,
                    borderColor: 'divider',
                    '&:hover': { bgcolor: 'error.main', color: 'common.white' },
                  }}
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Box>
      )}

      {titles.length < 2 && (
        <Typography color="text.secondary" sx={{ maxWidth: 640 }}>
          {t('trails.common.empty')}
        </Typography>
      )}

      {error && <Alert severity="warning">{error}</Alert>}

      {key && !response && !error && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {response && response.titles.length < 2 && (
        <Alert severity="info">{t('trails.common.tooFew')}</Alert>
      )}

      {response && response.links.length === 0 && response.titles.length >= 2 && (
        <Alert
          severity="info"
          action={
            <Button
              color="inherit"
              size="small"
              startIcon={<AltRouteIcon />}
              onClick={() => onConnect(response.titles[0].ref, response.titles[1].ref)}
            >
              {t('trails.common.connectPair')}
            </Button>
          }
        >
          {t('trails.common.none')}
        </Alert>
      )}

      {response && response.links.length > 0 && (
        <Stack spacing={1.5}>
          {response.links.map((link) => {
            const rarity = rarityText(link.titleCount)
            return (
              <Paper
                key={`${link.kind}:${link.name}`}
                variant="outlined"
                sx={{
                  p: 1.25,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 1.5,
                  alignItems: 'center',
                  borderInlineStart: 3,
                  borderInlineStartColor: KIND_COLOR[link.kind],
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 200, flex: 1 }}>
                  <EntityAvatar entity={link} size={36} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography fontWeight={600} noWrap>
                      {link.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {t('trails.common.sharedBy', { count: link.carriers.length, total: response.titles.length })}
                      {' · '}
                      {rarity.key === 'trails.rarity.onlyTwo' ? t(rarity.key) : t(rarity.key, { count: rarity.count })}
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {link.carriers.map((carrier) => {
                    const card = cards.get(carrier.ref)
                    if (!card) return null
                    const roleName = link.kind === 'person' || link.kind === 'company' ? role(carrier.roles[0] ?? 'actor') : null
                    return (
                      <Tooltip key={carrier.ref} title={roleName ? `${card.title} · ${roleName}` : card.title}>
                        <Box
                          component="button"
                          type="button"
                          onClick={() => onOpen(card)}
                          aria-label={t('trails.actions.open', { title: card.title })}
                          sx={{
                            p: 0,
                            border: 0,
                            bgcolor: 'transparent',
                            cursor: 'pointer',
                            borderRadius: 1,
                            overflow: 'hidden',
                            width: 36,
                            height: 54,
                          }}
                        >
                          <Box
                            component="img"
                            src={getProxiedImageUrl(card.posterUrl)}
                            alt=""
                            loading="lazy"
                            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', bgcolor: 'grey.900' }}
                          />
                        </Box>
                      </Tooltip>
                    )
                  })}
                </Box>
              </Paper>
            )
          })}
        </Stack>
      )}
    </Stack>
  )
}
