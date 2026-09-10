# Title Analysis

*Film Analysis* on a movie page, *Series Analysis* on a series page — a section near the bottom of the details column.

Every title's detail page can carry a **grounded critical analysis**: a short essay about the work itself — how it was made, what its makers were attempting, where it sits, and what critics argue about.

It is deliberately different from the **Recommended For You / How This Fits Your Taste** panel above it:

| | Insights panel | Title analysis |
|---|---|---|
| About | You — why this was picked *for you* | The work — how it was made and received |
| Written from | Your recommender's measured output | Published writing on the web |
| Same for every user | No | Yes |

The feature must be configured by an administrator (a dedicated AI model role and a web-search source); if it isn't, the section simply doesn't appear. See [AI Providers](../admin/ai-providers.md).

---

## Reading an analysis

The section is **collapsed by default** — expand it when you want to read. Inside:

- **Section headings** such as *Form and Style*, *Narrative Structure*, *Lineage and Influence*, *Critical Debate*, *Stated Intent*, and *Production Context*. The essay's paragraphs are indexed as they are written, so a heading only appears when there is substance under it.
- A **Sources** chip showing how much published writing the analysis is grounded in, with a grade: **Well documented**, **Reviews only**, or **Sparse sources**.

### Spoiler stance

The analysis is written to answer **pre-viewing questions** — how it was made, what it tries to do, where it sits — rather than what happens in it. It is collapsed by default for the same reason. No disclaimer is perfect, so treat any critical essay as one that may brush against the ending.

---

## The three states

The section is always in exactly one of three states:

1. **An analysis exists** — it is rendered.
2. **Someone asked, and there was nothing to write** — a plain reason is shown instead, e.g. *"There is too little published writing about this title to say anything grounded."* or *"Nothing substantive to report about how this one was made."* An empty result is an answer, not an error.
3. **Nobody has asked yet** — a **"Write an analysis"** button is offered. While it works you'll see *"Reading what critics wrote…"*.

---

## Rewriting

- **Rewrite this analysis** — reads the sources again and writes the text fresh with the currently configured model. If the existing text was written with an older version of the prompt, the section says so.
- **Administrators** additionally get a re-run control showing the source count, how much text was read, the prompt version, and which search mode produced it (self-hosted search or Google grounding).
