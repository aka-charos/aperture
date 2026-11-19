# Next from here

The admin side of [Next from here](../features/next-from-here.md): how many suggestions every title's page shows in its right column.

## Where It Lives

Admin console → **Recommendations** → **Next from here** (`/admin/recommendations/next-from-here`). One number:

**"Suggestions on a title page"**: 12 by default, from 1 to 50.

## What the Number Controls

Every movie and series page shows Next from here beside the title: the titles closest to it in feel that the viewer hasn't seen, films and shows together, each with the reason it was picked. This number is how many the page asks for. It doesn't change the full Next from here page, the map, or anything the recommender does.

The page lays its posters out in whole rows, so it can show a few fewer than you set. With 12 on a five-column grid it shows 10.

## Why It Stops at 50

Suggestions are ranked mostly by how close they feel to the title, and that closeness comes from a search of the 50 nearest titles in your library. Beyond those 50, the list could only go on with titles linked by their makers alone, ranked a different way, so a longer list would stop being "closest first" without saying so. A larger search isn't offered either: past 40 results, each search needs a slower kind of database scan.

At least one suggestion is always shown. No value turns the column off.

## What Changed from "Related"

Title pages used to show two tabs here: **Related Movies / Series** and **Next from here**. In measurements on a real library, about 92% of Next from here's titles of the same media type were also in Related's list. Next from here also left out what the viewer had already seen, mixed in films and shows, and gave a reason for each title. So Related was folded into it. The multi-hop similarity graph is still on [Explore](../features/explore.md).

---

**Related:** [Next from here (user doc)](../features/next-from-here.md) · [Movie detail](../features/movie-detail.md) · [Series detail](../features/series-detail.md)
