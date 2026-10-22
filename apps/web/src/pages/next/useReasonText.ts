import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { roleKey } from '../trails/labels'
import type { ReasonText } from './reasons'

/** A decided reason (reasons.ts) as a sentence in the reader's language. */
export function useReasonText() {
  const { t, i18n } = useTranslation()
  return useCallback(
    (text: ReasonText): string => {
      const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value)
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
        case 'next.reason.themes':
          return t(text.key, {
            names: new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(text.names),
            count: text.names.length,
          })
      }
    },
    [t, i18n.language]
  )
}
