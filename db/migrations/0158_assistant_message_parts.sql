-- Migration: 0158_assistant_message_parts
-- Description: Remember the ORDER an assistant answer was produced in.
--
-- An answer is a sequence: a line of prose, a tool call and its cards, another
-- line, more cards, a closing note. The save path flattened that into
-- `content` (every text part joined with a blank line) and `tool_invocations`
-- (a bare array), which destroys both the boundaries between text parts and
-- their positions relative to the tool calls. A reloaded answer could then only
-- ever be rendered prose-first, so the live renderer was made to hoist its text
-- above its cards to match — meaning a sentence written after the cards
-- appeared above them, and mid-stream each new sentence shoved the cards down
-- the page.
--
-- `parts` keeps the sequence so both renderers can show what actually happened.
-- Nullable and not backfilled, because the order of an existing row was never
-- recorded and cannot be recovered: rows without it keep rendering the old way.
-- `content` and `tool_invocations` stay authoritative for everything else that
-- reads a message (conversation history for the model, suggestion refresh).

ALTER TABLE assistant_messages
ADD COLUMN parts JSONB;

COMMENT ON COLUMN assistant_messages.parts IS
  'Ordered message parts as produced: [{type:"text",text} | {type:"tool",toolCallId,toolName,args,result}]. NULL on rows written before 0158, which render prose-then-cards.';
