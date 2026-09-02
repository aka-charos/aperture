import { createTheme, type Theme } from '@mui/material/styles'

/**
 * Density and text scale for the chat thread.
 *
 * Both breakpoints query `assistantThread` — the thread viewport (see
 * Thread.tsx) — rather than the window, because the thread is squeezed by things
 * a media query cannot see: the conversation sidebar, the dock's width, a dialog
 * on a phone. A 620px thread on a 1600px monitor is exactly as cramped as one on
 * a tablet, and only the container knows how much room it actually got.
 *
 * Shared by Thread.tsx and the tool-ui cards, which sit inside the same
 * container. Kept in its own module because Thread.tsx imports tool-ui, so the
 * constants cannot live in either without a cycle.
 */

/**
 * Below this the avatar rail is dropped entirely.
 *
 * A 36px avatar plus its 12px gap takes 48px out of every row. On a 390px phone
 * that is a quarter of the line: the card inside it is left with a ~184px prose
 * column, under 30 characters, and the same 48px is charged again to the card's
 * own poster rail. Nothing depends on the avatars to tell the two speakers
 * apart — user messages are right-aligned indigo bubbles.
 */
export const NARROW_THREAD = '@container assistantThread (max-width: 480px)'

/**
 * Below this the thread tightens: smaller avatars, less padding inside every
 * bubble and card, less air between one answer's sections.
 *
 * The spacing above this width is tuned for a full-width thread, where generous
 * padding reads as calm. Under it the same values read as waste — chrome and gaps
 * start to outweigh the words and posters they surround.
 */
export const COMPACT_THREAD = '@container assistantThread (max-width: 720px)'

/**
 * How much larger chat text runs than the size each component declares.
 *
 * The chat is read rather than scanned — prose paragraphs, and a model-written
 * note on every card that exists nowhere else in the app — and at the app's
 * default sizes that text sits at the small end of comfortable. One number
 * moves the whole surface.
 *
 * It has to be applied two ways, because MUI variants and CSS inheritance do
 * not mix. `Typography variant="caption"` resolves to a rem value off the ROOT
 * font size, so a font-size on the thread's own box cannot touch it — Thread
 * mounts a nested theme (`scaleChatTypography`) for those. Markdown prose
 * declares nothing at all and simply inherits, so the thread viewport carries a
 * font-size for it. The two can never compound: a rem variant ignores its
 * parent, and inherited text has no variant. The handful of hardcoded px sizes
 * on the cards go through `chatText`.
 *
 * Deliberately text only. Avatars, posters, icons and padding are geometry —
 * scaling them too would be a different change (a denser or roomier chat),
 * not a more legible one.
 */
export const CHAT_TEXT_SCALE = 1.1

/** Scale one declared px size. Fractions are fine in CSS; a round number here would drift. */
export const chatText = (px: number) => Math.round(px * CHAT_TEXT_SCALE * 10) / 10

/** Variants a chat message can render text in. Headings are absent on purpose:
 *  `theme.ts` states h1–h6 as literal rem values, and a chat answer's headings
 *  come from markdown as plain HTML elements, which inherit instead. */
const SCALED_VARIANTS = [
  'body1',
  'body2',
  'caption',
  'subtitle1',
  'subtitle2',
  'button',
  'overline',
] as const

/**
 * The surrounding theme with its text variants scaled by `CHAT_TEXT_SCALE`.
 *
 * Sizes are read off the theme and multiplied rather than restated, so this
 * cannot drift from `theme.ts` or from MUI's own defaults. Only rem values are
 * touched — anything else passes through unchanged, which errs toward leaving a
 * size alone rather than guessing at its unit.
 */
export function scaleChatTypography(outer: Theme): Theme {
  const typography: Record<string, { fontSize: string }> = {}
  for (const variant of SCALED_VARIANTS) {
    const size = outer.typography[variant]?.fontSize
    if (typeof size !== 'string' || !size.endsWith('rem')) continue
    // Rounded because the multiply is binary float: 0.875 * 1.1 prints as
    // 0.9625000000000001, which is a correct size and an unreadable stylesheet.
    const scaled = Math.round(Number.parseFloat(size) * CHAT_TEXT_SCALE * 1e4) / 1e4
    typography[variant] = { fontSize: `${scaled}rem` }
  }
  return createTheme(outer, { typography })
}
