/**
 * Finding the element a tour step points at.
 *
 * Several elements can carry the same anchor — the sidebar is drawn twice
 * (the phone's overlay menu and the desktop rail), and only one is on screen —
 * so the first one actually showing wins. A box is not enough to say so: the
 * phone's closed menu stays mounted, slid off the screen with
 * `visibility: hidden`, and still reports a full-size box. None showing means
 * the step is shown centred.
 */
export function findTourAnchor(anchor: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(anchor)}"]`)
  for (const node of nodes) {
    if (isShowing(node)) return node
  }
  return null
}

function isShowing(node: HTMLElement): boolean {
  const box = node.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return false
  // Off the side of the screen (a drawer slid away). Above or below is fine:
  // the tour scrolls a step's element into view.
  if (box.right <= 0 || box.left >= window.innerWidth) return false
  const check = (node as HTMLElement & { checkVisibility?: (options?: object) => boolean }).checkVisibility
  if (check && !check.call(node, { visibilityProperty: true, opacityProperty: true })) return false
  return true
}
