import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  FACET_RULES,
  MIN_SKEW_SCORE,
  facetIsCovered,
  formatTasteEvidence,
  rankFacetSkews,
  skewOf,
  summariseRatings,
  summariseSeriesProgress,
  type FacetCount,
  type RatedTitle,
  type SeriesProgress,
  type TasteEvidence,
  type TasteFacet,
} from './tasteEvidence.js'

function row(
  facet: TasteFacet,
  label: string,
  watched: number,
  available: number,
  examples: string[] = []
): FacetCount {
  return { facet, label, watched, available, examples }
}

function rated(
  title: string,
  year: number | null,
  rating: number,
  crowdRating: number | null,
  genres: string[] = [],
  keywords: string[] = []
): RatedTitle {
  return { title, year, rating, crowdRating, genres, keywords }
}

function show(
  title: string,
  watched: number,
  total: number,
  daysSinceLastPlay: number | null,
  airedByLastPlay: number | null = total,
  unfinishedSeason: number | null = null
): SeriesProgress {
  return { title, year: null, watched, total, daysSinceLastPlay, airedByLastPlay, unfinishedSeason }
}

function labels(items: { label: string }[]): string[] {
  return items.map((i) => i.label)
}

function titles(items: { title: string }[]): string[] {
  return items.map((i) => i.title)
}

const GENRE_TOTALS = { watched: 200, available: 10000 }

describe('skewOf', () => {
  it('reads exactly-as-offered as no skew', () => {
    const skew = skewOf(80, 4000, 200, 10000, 10)
    assert.ok(skew)
    assert.ok(Math.abs(skew.ratio - 1) < 1e-9)
    assert.ok(Math.abs(skew.score) < 1e-9)
  })

  it('gives more-than-offered and less-than-offered opposite signs', () => {
    assert.ok((skewOf(40, 800, 200, 10000, 10)?.score ?? 0) > 0)
    assert.ok((skewOf(4, 800, 200, 10000, 10)?.score ?? 0) < 0)
  })

  it('refuses to compare against nothing', () => {
    assert.equal(skewOf(1, 0, 200, 10000, 10), null)
    assert.equal(skewOf(1, 10, 0, 10000, 10), null)
    assert.equal(skewOf(1, 10, 200, 0, 10), null)
    assert.equal(skewOf(Number.NaN, 10, 200, 10000, 10), null)
  })
})

describe('rankFacetSkews', () => {
  it('does not mistake volume for preference', () => {
    // The identity that started this said "drama leads" for a viewer whose drama
    // share was simply the library's. Drama here is 40% of theirs and 40% of the
    // shelf, and must be in neither list.
    const rows = [
      row('genre', 'Drama', 80, 4000),
      row('genre', 'Crime', 40, 800),
      row('genre', 'Family', 2, 800),
      row('genre', 'Western', 0, 400),
    ]
    const { over, under } = rankFacetSkews('genre', rows, GENRE_TOTALS)
    assert.deepEqual(labels(over), ['Crime'])
    assert.deepEqual(labels(under), ['Family', 'Western'])
    for (const s of [...over, ...under]) assert.ok(Math.abs(s.score) >= MIN_SKEW_SCORE)
  })

  it('makes no avoidance claim from a thin history', () => {
    // Eight films, none of them westerns, in a library that is 10% western: they
    // would have been expected to watch less than one.
    const { under } = rankFacetSkews('genre', [row('genre', 'Western', 0, 1000)], {
      watched: 8,
      available: 10000,
    })
    assert.deepEqual(under, [])
  })

  it('makes the same avoidance claim once the history is deep enough to expect it', () => {
    const { under } = rankFacetSkews('genre', [row('genre', 'Western', 0, 1000)], {
      watched: 300,
      available: 10000,
    })
    assert.deepEqual(labels(under), ['Western'])
  })

  it('needs enough titles before calling a director a pattern', () => {
    const totals = { watched: 190, available: 9500 }
    assert.deepEqual(rankFacetSkews('director', [row('director', 'A', 2, 2)], totals).over, [])
    assert.deepEqual(
      labels(rankFacetSkews('director', [row('director', 'A', 3, 4)], totals).over),
      ['A']
    )
  })

  it('needs more choices before calling a production country a pattern', () => {
    // Co-producers and filming locations: measured live, a handful of productions
    // shot in one small country read as a preference for that country.
    const totals = { watched: 233, available: 12500 }
    assert.deepEqual(rankFacetSkews('country', [row('country', 'X', 4, 60)], totals).over, [])
    assert.deepEqual(
      labels(rankFacetSkews('country', [row('country', 'X', 5, 60)], totals).over),
      ['X']
    )
  })

  it('never reports avoiding a director, network or keyword', () => {
    const totals = { watched: 300, available: 10000 }
    for (const facet of ['director', 'network', 'keyword'] as const) {
      assert.equal(FACET_RULES[facet].underLimit, 0)
      assert.deepEqual(rankFacetSkews(facet, [row(facet, 'X', 0, 2000)], totals).under, [])
    }
  })

  it('caps each list and breaks ties by name, so the evidence is stable', () => {
    const rows = ['G', 'F', 'E', 'D', 'C', 'B', 'A'].map((l) => row('genre', l, 40, 800))
    const { over } = rankFacetSkews('genre', rows, GENRE_TOTALS)
    assert.equal(over.length, FACET_RULES.genre.overLimit)
    assert.deepEqual(labels(over), ['A', 'B', 'C', 'D', 'E'])
  })

  it('ignores rows belonging to another facet', () => {
    const { over } = rankFacetSkews('genre', [row('country', 'France', 40, 800)], GENRE_TOTALS)
    assert.deepEqual(over, [])
  })
})

describe('facetIsCovered', () => {
  it('refuses a facet carried by too little of the library or of the viewer', () => {
    // Measured live: production countries on 269 of 986 series.
    assert.equal(facetIsCovered({ watched: 59, available: 269 }, 81, 986), false)
    assert.equal(facetIsCovered({ watched: 20, available: 900 }, 81, 986), false)
    assert.equal(facetIsCovered({ watched: 233, available: 12524 }, 238, 12609), true)
    assert.equal(facetIsCovered({ watched: 10, available: 10 }, 0, 986), false)
  })
})

describe('summariseRatings', () => {
  const ratings: RatedTitle[] = [
    rated('Heat', 1995, 10, 8.3),
    rated('Zodiac', 2007, 9, 7.7),
    rated('Obscure', 2012, 9, 5.9),
    rated('Middling', 2000, 5, 6.0),
    rated('Hyped', 2014, 3, 8.1),
    rated('Unrated Elsewhere', 2010, 2, null),
  ]

  it('lists liked and disliked titles by the shared rating bands', () => {
    const summary = summariseRatings(ratings)
    assert.equal(summary.count, 6)
    assert.deepEqual(titles(summary.highest), ['Heat', 'Obscure', 'Zodiac'])
    assert.deepEqual(titles(summary.lowest), ['Unrated Elsewhere', 'Hyped'])
  })

  it('names disagreements with IMDb and never invents one from a missing rating', () => {
    const summary = summariseRatings(ratings)
    assert.deepEqual(titles(summary.aboveCrowd), ['Obscure'])
    // 'Unrated Elsewhere' has no crowd rating. Read as 0 it would be rated well
    // ABOVE the crowd; it must appear in neither list.
    assert.deepEqual(titles(summary.belowCrowd), ['Hyped'])
  })

  it('averages only when there is enough to average', () => {
    const summary = summariseRatings(ratings)
    assert.ok(summary.mean != null && Math.abs(summary.mean - 38 / 6) < 1e-9)
    assert.ok(summary.versusCrowd)
    assert.equal(summary.versusCrowd.count, 5)
    assert.ok(Math.abs(summary.versusCrowd.theirs - 7.2) < 1e-9)
    assert.ok(Math.abs(summary.versusCrowd.crowd - 7.2) < 1e-9)

    const thin = summariseRatings(ratings.slice(0, 4))
    assert.equal(thin.mean, null)
    assert.equal(thin.versusCrowd, null)
  })
})

describe('summariseSeriesProgress', () => {
  it('places each started show once, and only where the data supports it', () => {
    const summary = summariseSeriesProgress([
      show('The Wire', 60, 60, 400),
      show('Over Count', 62, 60, 10),
      show('Silo', 8, 20, 5, 10),
      show('Lost', 100, 120, 300, 110, 5),
      show('Dropped', 2, 40, 200, 40, 1),
      show('Middle', 15, 30, 200, 30, 2),
      // 3 of 30 today, but only 6 had aired when they stopped: half of what existed.
      show('Short Season', 3, 30, 200, 6, 1),
      // No last play: "stopped" is a claim about time, so this goes nowhere.
      show('Unknown Recency', 2, 40, null, null),
      // Undated episodes: airing unknowable, so neither stopped nor caught up.
      show('Unknown Airing', 2, 40, 200, null),
      show('No Episodes', 3, 0, 10, 0),
    ])
    assert.deepEqual(titles(summary.finished), ['Over Count', 'The Wire'])
    assert.deepEqual(titles(summary.inProgress), ['Silo'])
    assert.deepEqual(titles(summary.caughtUp), [])
    assert.deepEqual(titles(summary.seasonsDone), [])
    assert.deepEqual(titles(summary.mostly), ['Lost'])
    assert.deepEqual(titles(summary.leftEarly), ['Dropped'])
    assert.deepEqual(titles(summary.leftPartway), ['Middle', 'Short Season'])
  })

  it('calls a show caught up, not stopped, when later episodes aired after the last watch', () => {
    // Measured live: 9 of 16 and 18 of 19, each everything that existed at the time.
    const summary = summariseSeriesProgress([
      show('The Last of Us', 9, 16, 1235, 9),
      show('Severance', 18, 19, 550, 18),
    ])
    assert.deepEqual(titles(summary.caughtUp), ['Severance', 'The Last of Us'])
  })

  it('calls finished seasons finished, not stopped, when later seasons had aired', () => {
    // Measured live: 8 of 24 with every season aired -- one complete season on a
    // server that may simply have got the rest later. A mid-season stop is still
    // a stop, since a library acquires seasons whole.
    const summary = summariseSeriesProgress([
      show('Reacher', 8, 24, 522, 24, null),
      show('Bridgerton', 10, 32, 169, 32, 2),
    ])
    assert.deepEqual(titles(summary.seasonsDone), ['Reacher'])
    assert.deepEqual(titles(summary.leftPartway), ['Bridgerton'])
  })
})

function movieEvidence(overrides: Partial<TasteEvidence> = {}): TasteEvidence {
  return {
    mediaType: 'movie',
    watchedTotal: 238,
    libraryTotal: 12584,
    facets: [
      row('genre', 'Drama', 80, 4000),
      row('genre', 'Crime', 40, 800, ['Heat', 'Zodiac']),
      row('genre', 'Family', 2, 800),
      row('genre', 'Western', 0, 400),
      row('director', 'Jean-Pierre Melville', 7, 9),
      row('keyword', 'neo-noir', 21, 300, ['Le Samouraï']),
    ],
    facetTotals: {
      genre: GENRE_TOTALS,
      director: { watched: 190, available: 9500 },
      keyword: { watched: 180, available: 9000 },
    },
    rated: [],
    crowd: {
      watchedMedianVotes: 48000,
      libraryMedianVotes: 12000,
      watchedMeanRating: 7.14,
      libraryMeanRating: 6.4,
    },
    unfinished: { count: 2, examples: ['Solaris', 'Stalker'] },
    progress: null,
    ...overrides,
  }
}

describe('formatTasteEvidence', () => {
  it('counts played titles, franchises once, and says so', () => {
    const doc = formatTasteEvidence(movieEvidence())
    assert.ok(doc.includes('Watched: 238 of the 12,584 films'))
    assert.ok(doc.includes('only titles the media server marks as played'))
    assert.ok(doc.includes('a franchise counts once'))
  })

  it('states skews against the library with titles, and leaves proportional genres out', () => {
    const doc = formatTasteEvidence(movieEvidence())
    assert.ok(
      doc.includes(
        '- Crime: 20% of their films vs 8% of the library (2.5×) — e.g. "Heat", "Zodiac"'
      )
    )
    assert.ok(doc.includes('- Family: 1% of their films vs 8% of the library (0.1×)'))
    assert.ok(doc.includes('- Western: none of their films vs 4% of the library'))
    assert.ok(!doc.split('\n').some((line) => line.startsWith('- Drama')))
    assert.ok(doc.includes('- Jean-Pierre Melville: 7 of 9'))
    assert.ok(doc.includes('- neo-noir:'))
    assert.ok(doc.includes('Median IMDb vote count: 48,000 for their films vs 12,000'))
  })

  it('leaves out a facet too few titles carry', () => {
    const doc = formatTasteEvidence(
      movieEvidence({
        facets: [...movieEvidence().facets, row('country', 'France', 40, 300)],
        facetTotals: { ...movieEvidence().facetTotals, country: { watched: 60, available: 3000 } },
      })
    )
    assert.ok(!doc.includes('Production countries'))
    assert.ok(!doc.includes('- France:'))
  })

  it('spreads example titles across patterns instead of repeating one favourite', () => {
    // Measured live: examples are ordered by the viewer's own rating, so a single
    // 10/10 film led the examples of every facet.
    const lines = formatTasteEvidence(
      movieEvidence({
        facets: [
          row('genre', 'Crime', 40, 800, ['Heat', 'Zodiac']),
          row('keyword', 'neo-noir', 21, 300, ['Heat', 'Le Samouraï']),
          row('keyword', 'heist', 20, 280, ['Heat', 'Zodiac']),
        ],
        facetTotals: { genre: GENRE_TOTALS, keyword: { watched: 180, available: 9000 } },
      })
    ).split('\n')

    assert.ok(lines.some((l) => l.startsWith('- Crime:') && l.endsWith('e.g. "Heat", "Zodiac"')))
    assert.ok(lines.some((l) => l.startsWith('- neo-noir:') && l.endsWith('e.g. "Le Samouraï"')))
    // Every candidate already shown: one is still given, so no pattern is left bare.
    assert.ok(lines.some((l) => l.startsWith('- heist:') && l.endsWith('e.g. "Heat"')))
  })

  it('carries none of the lookup-table phrases the old analyzer invented', () => {
    const doc = formatTasteEvidence(movieEvidence()).toLowerCase()
    for (const phrase of [
      'heartwarming',
      'comfort rewatch',
      'emotionally engaged',
      'fast-paced',
      'plot-twisting',
      'world-building',
      'rewatch rate',
      'favorite rate',
      'eclectic',
    ]) {
      assert.ok(!doc.includes(phrase), `evidence should not contain "${phrase}"`)
    }
  })

  it('says when no genre stands out, rather than leaving room to invent one', () => {
    const doc = formatTasteEvidence(
      movieEvidence({
        facets: [row('genre', 'Drama', 80, 4000), row('genre', 'Comedy', 60, 3000)],
        facetTotals: { genre: GENRE_TOTALS },
      })
    )
    assert.ok(doc.includes('no genre stands out'))
  })

  it('says when there are no ratings, and says what each rated title is when there are', () => {
    assert.ok(formatTasteEvidence(movieEvidence()).includes('Their own ratings: none recorded.'))

    const lines = formatTasteEvidence(
      movieEvidence({
        rated: [
          rated(
            'Heat',
            1995,
            10,
            8.3,
            ['Crime', 'Thriller', 'Drama', 'Action'],
            ['heist', 'los angeles', 'cat and mouse', 'bank robbery', 'police', 'obsession']
          ),
          rated('Hyped', 2014, 3, 8.1, ['Drama']),
        ],
      })
    ).split('\n')

    assert.ok(lines.includes('- Rated highest:'))
    assert.ok(
      lines.includes(
        '  - "Heat" (1995) 10/10 — Crime, Thriller, Drama; keywords: heist, los angeles, cat and mouse, bank robbery, police'
      )
    )
    assert.ok(lines.includes('  - "Hyped" (2014) 3/10 — Drama'))
    // A title in two lists is described once, so the evidence does not repeat itself.
    assert.ok(lines.includes('  - "Hyped" (2014) 3/10 vs IMDb 8.1'))
  })

  it('keeps film-only and TV-only sections to their own media type', () => {
    const movieDoc = formatTasteEvidence(movieEvidence())
    assert.ok(movieDoc.includes('Started but not finished'))
    assert.ok(!movieDoc.includes('How far they get'))

    const seriesDoc = formatTasteEvidence({
      mediaType: 'series',
      watchedTotal: 45,
      libraryTotal: 980,
      facets: [row('network', 'HBO', 8, 40)],
      facetTotals: { network: { watched: 45, available: 980 } },
      rated: [],
      crowd: null,
      unfinished: null,
      progress: [
        { ...show('The Wire', 60, 60, 400), year: 2002 },
        show('The Last of Us', 9, 16, 1235, 9),
        show('Reacher', 8, 24, 522, 24, null),
        show('Dropped', 2, 40, 200, 40, 1),
      ],
    })
    assert.ok(seriesDoc.includes('a show counts once any episode has been played'))
    assert.ok(!seriesDoc.includes('a franchise counts once'))
    assert.ok(seriesDoc.includes("Networks they return to (their shows / the library's shows):"))
    assert.ok(seriesDoc.includes('- HBO: 8 of 40'))
    assert.ok(seriesDoc.includes('- Finished every episode: 1 — e.g. "The Wire" (60 of 60)'))
    assert.ok(
      seriesDoc.includes(
        '- Caught up when they last watched; more episodes have arrived since: 1 — e.g. "The Last of Us" (9 of 16)'
      )
    )
    assert.ok(
      seriesDoc.includes(
        '- Finished every season they started, and have not begun the next: 1 — e.g. "Reacher" (8 of 24)'
      )
    )
    assert.ok(seriesDoc.includes('"Dropped" (2 of 40 aired by then; left season 1 unfinished)'))
    assert.ok(!seriesDoc.includes('Started but not finished'))
  })
})
