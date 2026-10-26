-- Do critics appear in the answers that are supposed to speak in our own voice?
--
-- WHY THIS EXISTS. ATTRIBUTION_RULE opens: "The first answers speak in your own
-- voice: state facts, what is on screen and what it does to a viewer plainly,
-- with nobody attached, even where a critic is who you read it from." So the
-- tradition, work and making answers should carry no critic at all - named or
-- anonymous - and a judgement of quality or a claim about meaning belongs in
-- reception with a holder. The bench scores this as `spill`, but the bench only
-- ever runs on two or three answers at a time; nothing has ever asked the
-- library.
--
-- It also checks the OTHER half of the same rule: "NAME AT MOST ONE WRITER OR
-- PUBLICATION IN THE WHOLE PIECE, counting a critic and the paper they wrote
-- for alike." Section 4 counts name-shaped attributions per article, so an
-- article over the ceiling is visible.
--
-- WHAT IT MEASURES, AND WHAT IT CANNOT. Section 1-3 match critic NOUNS, which
-- is the clean part of the signal. A publication name with no noun beside it
-- ("Film Comment judges", "Senses of Cinema framed") is caught only by section
-- 4's name shape, and a critic referred to with neither - an opinion simply
-- asserted - is caught by nothing here. So every count is a FLOOR.
--
-- Deliberately NOT matching "viewer"/"viewers": the prompt asks throughout for
-- what a choice "does to a viewer", so that noun is the permitted form and
-- counting it is the mistake this repo has already made once, when `spill` read
-- 7 on an answer whose every hit was the phrase the prompt requested.
--
-- RUN IT (Windows Docker host, cmd.exe):
--   docker cp scripts\probe-critic-spill.sql aperture-db:/tmp/probe-spill.sql
--   docker exec aperture-db psql -U app -d aperture -f /tmp/probe-spill.sql
--
-- Reads only.

\pset pager off

\set critic '\\y(critics?|reviewers?|scholars?|commentators?|essayists?)\\y'
\set namedattrib '\\y[A-Z][a-z]+(\\s+[A-Z][a-z]+)?\\s+(notes|argues|calls|called|writes|wrote|found|finds|reads|read|places|placed|singles|singled|judged|judges|describes|described|observed|observes|praised|faulted|rated|graded|dismissed|insisted)\\y'

CREATE TEMP VIEW spill_rows AS
SELECT
  ta.media_type, ta.media_id, ta.prompt_version, ta.model,
  COALESCE(m.title, s.title) AS title,
  ta.analysis, ta.paragraph_map
FROM title_analysis ta
LEFT JOIN movies m ON ta.media_type = 'movie' AND m.id = ta.media_id
LEFT JOIN series s ON ta.media_type = 'series' AND s.id = ta.media_id
WHERE ta.analysis IS NOT NULL AND btrim(ta.analysis) <> ''
  AND ta.paragraph_map IS NOT NULL;

CREATE TEMP VIEW spill_paras AS
SELECT
  r.*,
  p.idx AS para_no,
  p.txt AS para,
  (
    SELECT string_agg(q.value, '+' ORDER BY q.value)
    FROM jsonb_array_elements(r.paragraph_map) AS e,
         jsonb_array_elements_text(e -> 'questions') AS q(value)
    WHERE (e ->> 'paragraph')::int = p.idx
  ) AS question
FROM spill_rows r,
     LATERAL regexp_split_to_table(r.analysis, '(\r?\n){2,}') WITH ORDINALITY AS p(txt, idx);

-- The outer group is the sentence; the noun alternation is non-capturing, or
-- regexp_matches hands back the matched word instead of the sentence around it.
CREATE TEMP VIEW spill_hits AS
SELECT
  pa.media_type, pa.media_id, pa.prompt_version, pa.title,
  pa.para_no, pa.question,
  btrim(h.m[1]) AS sentence
FROM spill_paras pa,
     LATERAL regexp_matches(pa.para, '([^.!?]*(?:' || :'critic' || ')[^.!?]*[.!?])', 'g') AS h(m)
WHERE pa.question IS NOT NULL
  AND pa.question NOT LIKE '%reception%'
  AND pa.question NOT LIKE '%dispute%'   -- version 8's name for the same answer
  AND btrim(h.m[1]) <> '';

\echo ''
\echo '=== 1. HEADLINE: articles naming a critic OUTSIDE the reception answer ==='
\echo '    ATTRIBUTION_RULE: the first answers speak in your own voice, nobody attached.'
\echo ''

SELECT
  r.prompt_version AS version,
  count(*) AS mapped_articles,
  count(*) FILTER (WHERE h.media_id IS NOT NULL) AS with_spill,
  round(100.0 * count(*) FILTER (WHERE h.media_id IS NOT NULL) / NULLIF(count(*), 0), 1) AS pct
FROM spill_rows r
LEFT JOIN (SELECT DISTINCT media_type, media_id FROM spill_hits) h
  ON h.media_type = r.media_type AND h.media_id = r.media_id
GROUP BY ROLLUP (r.prompt_version)
ORDER BY r.prompt_version NULLS LAST;

\echo ''
\echo '=== 2. WHICH ANSWER IS LEAKING ==='
\echo ''

SELECT question, count(*) AS hits, count(DISTINCT (media_type, media_id)) AS articles
FROM spill_hits
GROUP BY question
ORDER BY hits DESC;

\echo ''
\echo '=== 3. THE SENTENCES (current version only; read them) ==='
\echo ''

\pset format unaligned
\pset fieldsep ' | '
\pset tuples_only on

SELECT 'v' || prompt_version || '  [' || question || ']  ' || title || E'\n    ' || sentence
FROM spill_hits
WHERE prompt_version >= 17
ORDER BY question, title, para_no;

\pset tuples_only off
\pset format aligned

\echo ''
\echo '=== 4. THE ONE-NAME CEILING: name-shaped attributions per article ==='
\echo '    "NAME AT MOST ONE WRITER OR PUBLICATION IN THE WHOLE PIECE."'
\echo '    A maker named for a choice is fine and will appear here too, so read'
\echo '    the matches: what counts is writers and publications, not directors.'
\echo ''

SELECT
  r.prompt_version AS version,
  r.title,
  count(*) AS name_attributions,
  string_agg(DISTINCT btrim(n.m[1]), '; ') AS matches
FROM spill_rows r,
     LATERAL regexp_matches(r.analysis, '(' || :'namedattrib' || ')', 'g') AS n(m)
WHERE r.prompt_version >= 18
GROUP BY r.prompt_version, r.title
HAVING count(*) > 1
ORDER BY count(*) DESC, r.title
LIMIT 40;
