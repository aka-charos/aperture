/**
 * Whether a title page's heading can be set in Studio's condensed capitals.
 *
 * Barlow Condensed draws Latin and nothing else, and a title's script does not
 * follow the UI language: a browser falls back letter by letter, so a Greek or
 * Japanese title in that stack comes out in some other face, and one with a
 * Latin word in it mixes two. Those titles keep the theme's reading face, which
 * looks ordinary rather than broken.
 */
const ONLY_LATIN_LETTERS = /^(?:\p{Script=Latin}|[^\p{L}])*$/u

export function heroTitleInCondensedFace(title: string): boolean {
  return ONLY_LATIN_LETTERS.test(title)
}
