import { useIsPhone } from '@/hooks/useIsPhone'

/**
 * The narrowest a dashboard carousel poster may get. The carousel fits a whole
 * number of posters to the row and stretches them to fill it (`fitItems`), so
 * this sets how many share a row: at 210px a 1040px pane shows four rather
 * than six. A phone keeps two to a row, since one poster the width of the
 * screen leaves nothing to browse.
 */
export function useDashboardPosterMinWidth(): number {
  return useIsPhone() ? 140 : 210
}

/** Thumbnail size in the Recent Watches and Recent Ratings lists. */
export const LIST_THUMB_WIDTH = 64
export const LIST_THUMB_HEIGHT = 96
