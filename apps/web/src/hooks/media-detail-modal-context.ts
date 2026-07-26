import { createContext } from 'react'
import type { MediaType } from '../pages/media-detail/types'

/** Show a library item's detail view without leaving the current page. */
export type OpenMediaDetail = (mediaType: MediaType, id: string) => void

/**
 * Null when no modal host is mounted — consumers then fall back to routing to
 * the item's page, which is the right behaviour anywhere the surface they sit in
 * survives navigation (the docked assistant, ordinary library pages).
 */
export const MediaDetailModalContext = createContext<OpenMediaDetail | null>(null)
