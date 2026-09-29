import { useMediaQuery } from '@mui/material'

/**
 * The one test for "this pointer can hover". Layout's rail flyout used it
 * first; everything that reveals a control on hover must ask the same thing, or
 * a phone gets a control it cannot reach — or, for an `opacity: 0` control that
 * still takes pointer events, one it presses without seeing.
 */
export const CAN_HOVER_QUERY = '(hover: hover) and (pointer: fine)'

/** Inverse of {@link CAN_HOVER_QUERY}, for use as an sx media key. */
export const NO_HOVER_MEDIA = '@media (hover: none), (pointer: coarse)'

/**
 * Spread into the sx of a control that is `opacity: 0` until its card is
 * hovered: on a touch screen it is simply always shown.
 */
export const SHOW_WITHOUT_HOVER = {
  [NO_HOVER_MEDIA]: { opacity: 1, pointerEvents: 'auto' },
} as const

export function useCanHover(): boolean {
  return useMediaQuery(CAN_HOVER_QUERY, { noSsr: true })
}
