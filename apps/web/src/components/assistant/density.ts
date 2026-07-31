/**
 * Density breakpoints for the chat thread.
 *
 * Both query `assistantThread` — the thread viewport (see Thread.tsx) — rather
 * than the window, because the thread is squeezed by things a media query cannot
 * see: the conversation sidebar, the dock's width, a dialog on a phone. A 620px
 * thread on a 1600px monitor is exactly as cramped as one on a tablet, and only
 * the container knows how much room it actually got.
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
