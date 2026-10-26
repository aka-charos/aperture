-- How often does a stored analysis tell a reader how the film ends?
--
-- WHY THIS EXISTS. Four versions of the prompt have attacked the spoiler class
-- with instructions and each held for a bench or two. Every one of those
-- decisions was made on two to six answers across one or two titles. Draft 18's
-- best change came from reading 42 stored rows instead, and this is the same
-- move for the ending rule: measure the rate on the library before changing a
-- word of SPOILER_RULE.
--
-- WHAT IT MEASURES, AND WHAT IT CANNOT. The test is a SHAPE, not a judgement:
-- a positional word ("final act", "the ending", "climax", "resolves") sitting
-- in a sentence about the film. That is lexical, so it is countable. It is
-- deliberately PARTIAL and the partiality is known: on the qwen bench it
-- catches "The final act borrows a chase through ruins" and "resolves into a
-- rallying cry" and MISSES "the road trip to the countryside shifts the setting
-- to open ruins", which discloses the ending carrying no positional word at
-- all. So section 3's sentence list is the measurement and the counts are only
-- a screen: read the sentences. A low rate here is not proof of safety.
--
-- It also prints which QUESTION each hit sits under, which is the thing the
-- counts alone cannot say. The hypothesis under test is that there are three
-- doors - the tradition question (an antecedent whose ending maps onto this
-- one), the work question (a choice that happens to be the last one) and the
-- reception question (a critic's verdict, which SPOILER_RULE permits) - and
-- that only the first has a guard inside its own question text.
--
-- RUN IT (Windows Docker host, cmd.exe):
--   docker cp scripts\probe-ending-disclosure.sql aperture-db:/tmp/probe-ending.sql
--   docker exec aperture-db psql -U app -d aperture -f /tmp/probe-ending.sql
--
-- Reads only. Nothing here writes.

\pset pager off

-- The shape. Bounded by sentence terminators so a hit prints as a readable
-- span, and \y so "finale" is a word rather than a substring. Every entry is a
-- positional marker: it says WHERE in the film something sits, which is the
-- one thing a pre-viewing article has no reason to say.
\set shape '\\y(final|last|closing|concluding)\\y[^.!?]{0,40}\\y(acts?|scenes?|sequences?|images?|shots?|moments?|third|stretch|pursuit|chase|half|hour|minutes|quarter)\\y|\\ythe ending\\y|\\y(film|movie|story|it)\\s+ends\\y|\\yends\\s+(with|on|in)\\y|\\y(climax|climactic|finale|denouement)\\y|\\y(by|at|in)\\s+the\\s+end\\y|\\yresolv(es|ed|ing)\\y|\\yresolution\\y|\\ythird act\\y|\\ywraps up\\y'

CREATE TEMP VIEW probe_rows AS
SELECT
  ta.media_type,
  ta.media_id,
  ta.prompt_version,
  ta.model,
  COALESCE(m.title, s.title) AS title,
  ta.analysis,
  ta.paragraph_map
FROM title_analysis ta
LEFT JOIN movies m ON ta.media_type = 'movie' AND m.id = ta.media_id
LEFT JOIN series s ON ta.media_type = 'series' AND s.id = ta.media_id
WHERE ta.analysis IS NOT NULL AND btrim(ta.analysis) <> '';

-- Paragraphs, 1-based into the blank-line split, exactly as paragraph_map is
-- indexed. Two line breaks required, or a single wrapped line would split.
CREATE TEMP VIEW probe_paras AS
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
FROM probe_rows r,
     LATERAL regexp_split_to_table(r.analysis, '(\r?\n){2,}') WITH ORDINALITY AS p(txt, idx);

-- SECOND STAGE, and it is the one that matters. Validated on the four Sacred
-- Fig answers: the positional shape alone flags 8 sentences of which only 3
-- disclose anything - the other 5 are critic verdicts, which SPOILER_RULE
-- PERMITS and which are always phrased positionally ("the final act is
-- simplistic"). So the shape cannot be a rule; it is a screen.
--
-- What separates them is SPOILER_RULE's own line - how it LANDS is a judgement,
-- how it BEHAVES is the ending itself. A sentence naming film CONTENT near the
-- positional word (a chase, ruins, a pursuit, another film by name) is the
-- forbidden half; one carrying only judgement words is the permitted half.
-- That split was correct on 8 of 8, including the two qwen sentences that
-- launder a disclosure THROUGH an attribution - which a plain "is it attributed
-- to a critic" test calls safe and is exactly the live failure.
--
-- It is a HINT for sorting what to read, never a verdict. Read both columns.
\set content '\\y(chase|chases|pursuit|pursues|ruins|escape|escapes|flees|dies|death|kills|shoots|shot dead|survives|returns|confrontation|reveal|reveals|turns out|rallying|unmasks|betrays|arrest|arrested)\\y'

CREATE TEMP VIEW probe_hits AS
SELECT
  pa.media_type,
  pa.media_id,
  pa.prompt_version,
  pa.title,
  pa.para_no,
  COALESCE(pa.question, '(unlabelled)') AS question,
  CASE
    WHEN btrim(h.m[1]) ~* :'content' THEN 'CONTENT'
    -- The antecedent shape (The Shining, Oedipus Rex): a named work beside a
    -- positional word, where the ending travels on the other film's reputation
    -- rather than on anything stated here. A comparison verb is REQUIRED, or a
    -- correctly-named critic in an ordinary verdict trips it - which version 17
    -- rows are full of, since the naming ban only arrived at 18.
    WHEN btrim(h.m[1]) ~ '\y[A-Z][a-z]+\s+[A-Z][a-z]+'
     AND btrim(h.m[1]) ~* '\y(cite|cites|citing|echo|echoes|recall|recalls|borrows?|compared|reminiscent|in the (manner|vein|mould) of|model of|nods? to)\y'
      THEN 'CONTENT'
    ELSE 'judgement'
  END AS likely,
  btrim(h.m[1]) AS sentence
-- THE OUTER GROUP IS THE WHOLE SENTENCE AND THE SHAPE IS NON-CAPTURING.
-- regexp_matches returns CAPTURE GROUPS, never the whole match, so wrapping
-- the shape in parentheses returns the positional phrase alone - "the ending",
-- "climax" - and the content test above then runs on three words that cannot
-- possibly hold "chase" or a film title. The first run of this probe did
-- exactly that and reported 1 CONTENT hit in 399 articles, which measured
-- nothing. The sentence is what both the classifier and the reader need.
FROM probe_paras pa,
     LATERAL regexp_matches(pa.para, '([^.!?]*(?:' || :'shape' || ')[^.!?]*[.!?])', 'gi') AS h(m)
WHERE btrim(h.m[1]) <> '';

\echo ''
\echo '=== 1. HEADLINE: how many stored articles carry an ending-positional sentence ==='
\echo ''

SELECT
  r.prompt_version AS version,
  count(*) AS articles,
  count(*) FILTER (WHERE h.any_hit) AS any_positional,
  count(*) FILTER (WHERE h.content_hit) AS content_hit,
  round(100.0 * count(*) FILTER (WHERE h.content_hit) / NULLIF(count(*), 0), 1) AS pct_content
FROM probe_rows r
LEFT JOIN (
  SELECT media_type, media_id,
         true AS any_hit,
         bool_or(likely = 'CONTENT') AS content_hit
  FROM probe_hits GROUP BY media_type, media_id
) h ON h.media_type = r.media_type AND h.media_id = r.media_id
GROUP BY ROLLUP (r.prompt_version)
ORDER BY r.prompt_version NULLS LAST;

\echo ''
\echo '=== 2. WHICH DOOR: hits by the question the paragraph answers ==='
\echo '    (tradition = an antecedent; work = a choice that is the last one;'
\echo '     reception = a critic verdict, which SPOILER_RULE permits)'
\echo ''

SELECT
  question,
  likely,
  count(*) AS hits,
  count(DISTINCT (media_type, media_id)) AS articles
FROM probe_hits
GROUP BY question, likely
ORDER BY likely, hits DESC;

\echo ''
\echo '=== 2b. SECOND DOOR CHECK: a named film beside a positional word ==='
\echo '    (the Incendies/Oedipus and The Shining shape - an antecedent named'
\echo '     for what the work borrows in its LAST act rather than its method)'
\echo ''

SELECT
  prompt_version AS version,
  title,
  question,
  sentence
FROM probe_hits
WHERE sentence ~ '\y[A-Z][a-z]+'
  AND sentence ~* '\y(cite|cites|citing|quot|echo|echoes|recall|recalls|borrow|borrows|nods? to|after the manner of|like\s+[A-Z])'
ORDER BY version, title;

\echo ''
\echo '=== 3. THE SENTENCES. This is the measurement; sections 1-2 are a screen ==='
\echo '    Read them. A positional word is not automatically a disclosure:'
\echo '    "the final act" about a critic verdict may be fine, "ends with" is not.'
\echo ''

\pset format unaligned
\pset fieldsep ' | '
\pset tuples_only on

SELECT
  likely || '  v' || prompt_version || '  [' || question || ']  ' || title
    || E'\n    ' || sentence
FROM probe_hits
ORDER BY likely, prompt_version, title, para_no;

\pset tuples_only off
\pset format aligned

\echo ''
\echo '=== 4. CONTROL: articles with NO positional word at all ==='
\echo '    Sample a few of these by hand. If any of them still discloses an'
\echo '    ending, the shape test is too narrow to base a rule on - which is'
\echo '    the qwen "road trip to the countryside" case.'
\echo ''

SELECT
  r.prompt_version AS version,
  r.title
FROM probe_rows r
LEFT JOIN (SELECT DISTINCT media_type, media_id FROM probe_hits) h
  ON h.media_type = r.media_type AND h.media_id = r.media_id
-- NEWEST VERSIONS FIRST, RANDOMISED WITHIN. Ordered by version ascending with
-- a LIMIT, this only ever returned v5-v7 rows - the versions nobody is
-- deciding anything about - and never sampled the current one at all.
WHERE h.media_id IS NULL
ORDER BY r.prompt_version DESC, random()
LIMIT 25;

\echo ''
\echo '=== 5. SCOPE: what the library actually holds ==='
\echo ''

SELECT
  prompt_version AS version,
  media_type,
  model,
  count(*) AS rows,
  count(paragraph_map) AS mapped,
  round(avg(array_length(regexp_split_to_array(analysis, '(\r?\n){2,}'), 1)), 1) AS avg_paras
FROM probe_rows
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;
