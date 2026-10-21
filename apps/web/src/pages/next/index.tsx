import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Alert, Box, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import SkipNextOutlinedIcon from '@mui/icons-material/SkipNextOutlined'
import { PageHeading } from '@/components/PageHeading'
import { MediaDetailModalProvider } from '@/hooks/MediaDetailModalProvider'
import { useOpenMedia } from '@/hooks/useOpenMedia'
import { TitlePicker } from '../trails/TitlePicker'
import { TitleTile } from '../trails/TitleTile'
import { roleKey } from '../trails/labels'
import type { TrailTitle } from '../trails/types'
import { orderReasons, readStartParam, reasonText, type ReasonText } from './reasons'
import type { NextFromHereResponse, NextItem } from './types'

/** Reasons shown under each title; the rest are not more convincing. */
const REASONS_SHOWN = 3

/**
 * Next from here: what to watch after a title. Two lists — titles close in
 * feel to it, and titles sharing its people in a different feel — each title
 * with the reasons it is there, in the viewer's own terms (people they keep
 * coming back to, networks they finish more of than most). The work is the
 * API's; this page states it.
 */
export function NextFromHerePage() {
  return (
    <MediaDetailModalProvider>
      <NextFromHere />
    </MediaDetailModalProvider>
  )
}

type Load = { status: 'loading' } | { status: 'error'; notFound: boolean } | { status: 'ready'; data: NextFromHereResponse }

function NextFromHere() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const openMedia = useOpenMedia()
  const startRef = readStartParam(params)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoad({ status: 'loading' })
    const query = startRef ? `?${new URLSearchParams({ title: startRef }).toString()}` : ''
    fetch(`/api/next-from-here${query}`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          setLoad({ status: 'error', notFound: response.status === 404 })
          return
        }
        setLoad({ status: 'ready', data: (await response.json()) as NextFromHereResponse })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoad({ status: 'error', notFound: false })
      })
    return () => controller.abort()
  }, [startRef, attempt])

  const goFrom = useCallback((title: TrailTitle) => setParams({ title: title.ref }), [setParams])
  const open = useCallback((title: TrailTitle) => openMedia(title.type, title.id), [openMedia])

  const data = load.status === 'ready' ? load.data : null
  const start = data?.start ?? null

  return (
    <Box>
      <PageHeading
        title={t('next.title')}
        description={t('next.description')}
        icon={<SkipNextOutlinedIcon sx={{ color: 'primary.main', fontSize: 32 }} />}
      />

      <Stack spacing={1.5} sx={{ mb: 3 }}>
        <Box sx={{ maxWidth: 480 }}>
          <TitlePicker label={t('next.picker.label')} value={start} onChange={(title) => title && goFrom(title)} />
        </Box>
        {data && data.starts.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
              {t('next.picker.recent')}
            </Typography>
            {data.starts.map((title) => (
              <Chip
                key={title.ref}
                label={title.year ? `${title.title} (${title.year})` : title.title}
                size="small"
                color={title.ref === start?.ref ? 'primary' : 'default'}
                variant={title.ref === start?.ref ? 'filled' : 'outlined'}
                onClick={() => goFrom(title)}
              />
            ))}
          </Box>
        )}
      </Stack>

      {load.status === 'loading' && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {load.status === 'error' && (
        <Alert
          severity={load.notFound ? 'info' : 'warning'}
          action={
            load.notFound ? undefined : (
              <Chip label={t('next.actions.retry')} size="small" onClick={() => setAttempt((n) => n + 1)} />
            )
          }
        >
          {load.notFound ? t('next.errors.notFound') : t('next.errors.load')}
        </Alert>
      )}

      {data && !start && <Alert severity="info">{t('next.empty.noStart')}</Alert>}

      {data && start && (
        <>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 3 }}>
            <TitleTile title={start} onOpen={open} width={84} emphasised />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="overline" color="text.secondary">
                {t('next.after')}
              </Typography>
              <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
                {start.title}
                {start.year ? ` (${start.year})` : ''}
              </Typography>
            </Box>
          </Box>

          {data.close.length === 0 && data.different.length === 0 && (
            <Alert severity="info">{t('next.empty.nothing', { title: start.title })}</Alert>
          )}

          <Section
            title={t('next.sections.close.title')}
            description={t('next.sections.close.description')}
            items={data.close}
            start={start}
            onOpen={open}
            onFrom={goFrom}
          />
          <Section
            title={t('next.sections.different.title')}
            description={t('next.sections.different.description')}
            items={data.different}
            start={start}
            onOpen={open}
            onFrom={goFrom}
          />
        </>
      )}
    </Box>
  )
}

interface SectionProps {
  title: string
  description: string
  items: NextItem[]
  start: TrailTitle
  onOpen: (title: TrailTitle) => void
  onFrom: (title: TrailTitle) => void
}

function Section({ title, description, items, start, onOpen, onFrom }: SectionProps) {
  if (items.length === 0) return null
  return (
    <Box component="section" sx={{ mb: 4 }}>
      <Typography variant="h6">{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {description}
      </Typography>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
        {items.map((item) => (
          <ItemCard key={item.title.ref} item={item} start={start} onOpen={onOpen} onFrom={onFrom} />
        ))}
      </Box>
    </Box>
  )
}

function ItemCard({
  item,
  start,
  onOpen,
  onFrom,
}: {
  item: NextItem
  start: TrailTitle
  onOpen: (title: TrailTitle) => void
  onFrom: (title: TrailTitle) => void
}) {
  const { t } = useTranslation()
  const say = useReasonText()
  const reasons = useMemo(
    () => orderReasons(item.reasons).slice(0, REASONS_SHOWN),
    [item.reasons]
  )
  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
      <TitleTile
        title={item.title}
        onOpen={onOpen}
        onFollow={onFrom}
        followLabel={t('next.actions.from', { title: item.title.title })}
        width={92}
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="subtitle2" sx={{ lineHeight: 1.3 }}>
          {item.title.title}
          {item.title.year ? (
            <Typography component="span" variant="body2" color="text.secondary">
              {` (${item.title.year})`}
            </Typography>
          ) : null}
        </Typography>
        <Box component="ul" sx={{ m: 0, mt: 0.75, pl: 2.25, display: 'grid', gap: 0.5 }}>
          {reasons.map((reason, index) => (
            <Typography
              key={index}
              component="li"
              variant="body2"
              color={index === 0 ? 'text.primary' : 'text.secondary'}
            >
              {say(reasonText(reason, start.title, item.title.type))}
            </Typography>
          ))}
        </Box>
      </Box>
    </Paper>
  )
}

/** A decided reason (reasons.ts) as a sentence in the reader's language. */
function useReasonText() {
  const { t, i18n } = useTranslation()
  return useCallback(
    (text: ReasonText): string => {
      const number = (value: number) =>
        new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value)
      switch (text.key) {
        case 'next.reason.feelClosestMovie':
        case 'next.reason.feelClosestSeries':
          return t(text.key, { start: text.start })
        case 'next.reason.franchise':
          return t(text.key, { name: text.name })
        case 'next.reason.feelMovie':
        case 'next.reason.feelSeries':
          return t(text.key, { start: text.start, rank: text.rank })
        case 'next.reason.sharedSame':
          return t(text.key, { name: text.name, role: t(roleKey(text.role)) })
        case 'next.reason.sharedDiffers':
          return t(text.key, {
            name: text.name,
            start: text.start,
            there: t(roleKey(text.there)),
            here: t(roleKey(text.here)),
          })
        case 'next.reason.favouriteRated':
          return t(text.key, {
            name: text.name,
            role: t(roleKey(text.role)),
            count: text.count,
            average: number(text.average),
          })
        case 'next.reason.favourite':
          return t(text.key, { name: text.name, role: t(roleKey(text.role)), count: text.count })
        case 'next.reason.companyMovies':
        case 'next.reason.companySeries':
          return t(text.key, { name: text.name, ratio: number(text.ratio), count: text.count })
      }
    },
    [t, i18n.language]
  )
}
