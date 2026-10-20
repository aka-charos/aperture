/**
 * When a navigation must close the item detail dialog. Pure, pinned by
 * mediaDetailNavigation.test.ts.
 *
 * Any move to another page closes it: a link inside the dialog (a cast name,
 * a studio, the franchise) routes the page underneath, and left open the
 * dialog would cover the very page the reader asked for. A change of query
 * alone closes it too, unless it REPLACED the entry: a link to the same page
 * with other parameters (Follow a trail from a title opened over Trails)
 * is a request for that page, while a page writing its own state back into
 * the address in place (Explore's focus, Browse's filters) is not, and may
 * happen while the dialog is open.
 */
/** react-router's navigation type: 'POP', 'PUSH' or 'REPLACE'. */
export type NavigationKind = 'POP' | 'PUSH' | 'REPLACE' | (string & {})

export interface DialogLocation {
  pathname: string
  search: string
}

export function navigationClosesDialog(
  previous: DialogLocation,
  next: DialogLocation,
  kind: NavigationKind
): boolean {
  if (previous.pathname !== next.pathname) return true
  return previous.search !== next.search && kind !== 'REPLACE'
}
