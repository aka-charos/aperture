-- Migration: 0198_text_language
-- Description: aperture_text_language(text, fallback) — the language a stored
-- synopsis or analysis is written in, told from its alphabet.
--
-- WHY. Synopsis translation assumed every text was in one configured source
-- language (English by default). A Greek film's plot often arrives from the
-- media server in GREEK (measured: 303 of 12,613 films carry Greek letters in
-- their overview, no series do), and the job then asked for "this English text
-- into Greek": the model returned it unchanged, the echo check refused it, and
-- it was retried at the back of the queue on every run, forever — while English
-- readers, the source language being no translation target, were shown the
-- Greek with nothing translating it. Measured on Index-Translate the same day:
-- the Greek plot labelled correctly as Greek translates cleanly into English.
--
-- THE RULE. Count the letters of each non-Latin script an app locale is written
-- in, and of the Latin alphabet. The script with the most letters wins when it
-- has MORE letters than Latin; otherwise the text is in `fallback` (the
-- configured source language). So an English plot naming a Greek village stays
-- English, and a Greek plot carrying an English title is Greek. Japanese and
-- Chinese share the Han characters: a text with any kana is Japanese (kana +
-- Han counted together), one with none is Chinese. Ties break by language code,
-- so the answer is stable.
--
-- WHAT IT CANNOT DO: tell Latin-script languages apart. A French plot reads as
-- the fallback (the model, measured, translates a mislabelled source correctly
-- anyway); telling those apart needs a language-identification library, which
-- nothing here has needed yet.
--
-- ONE DEFINITION, every reader. The pending check, the job's selection (which
-- returns the language it sends in the prompt), the status counts and the
-- detail read all call this, in core translation/pending.ts — the same reason
-- source_hash is md5 of one shared expression: two copies would disagree about
-- which texts are pending. IMMUTABLE and plain SQL: regexp_replace and length
-- are pg_catalog, so an empty search_path (a pg_dump restore) is harmless.
-- The cheap gate comes first: a text with no non-Latin letter at all — almost
-- every row — costs one regex match and returns the fallback.

CREATE OR REPLACE FUNCTION aperture_text_language(t text, fallback text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $func$
  SELECT CASE
    WHEN t IS NULL THEN NULL
    WHEN t !~ '[Ͱ-Ͽἀ-῿Ѐ-ӿ؀-ۿݐ-ݿऀ-ॿ가-힣ᄀ-ᇿ㄰-㆏぀-ヿ一-鿿]' THEN fallback
    ELSE COALESCE((
      SELECT s.lang
        FROM (SELECT length(regexp_replace(t, '[^A-Za-zÀ-ɏ]', '', 'g')) AS latin,
                     length(regexp_replace(t, '[^぀-ヿ]', '', 'g')) AS kana,
                     length(regexp_replace(t, '[^一-鿿]', '', 'g')) AS han) c
        CROSS JOIN LATERAL (VALUES
          ('el', length(regexp_replace(t, '[^Ͱ-Ͽἀ-῿]', '', 'g'))),
          ('ru', length(regexp_replace(t, '[^Ѐ-ӿ]', '', 'g'))),
          ('ar', length(regexp_replace(t, '[^؀-ۿݐ-ݿ]', '', 'g'))),
          ('hi', length(regexp_replace(t, '[^ऀ-ॿ]', '', 'g'))),
          ('ko', length(regexp_replace(t, '[^가-힣ᄀ-ᇿ㄰-㆏]', '', 'g'))),
          ('ja', CASE WHEN c.kana > 0 THEN c.kana + c.han ELSE 0 END),
          ('zh', CASE WHEN c.kana > 0 THEN 0 ELSE c.han END)
        ) AS s(lang, n)
       WHERE s.n > c.latin
       ORDER BY s.n DESC, s.lang
       LIMIT 1
    ), fallback)
  END
$func$;

COMMENT ON FUNCTION aperture_text_language(text, text) IS 'The language a text is written in, told from its alphabet: the non-Latin script with the most letters when it outnumbers Latin, else the fallback. Shared by every synopsis/analysis translation reader (core translation/pending.ts).';
