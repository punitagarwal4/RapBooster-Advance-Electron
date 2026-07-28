-- Real interactive templates (REQUIREMENTS §7.9).
--
-- `buttons` keeps its column and its JSON encoding, but the elements become
-- objects ({ type, label, value? }) instead of bare label strings. Existing rows
-- are read leniently in code rather than rewritten here: a data migration that
-- guesses at intent is harder to undo than a parser that accepts both shapes.
ALTER TABLE "Template" ADD COLUMN "footer" TEXT;
ALTER TABLE "Template" ADD COLUMN "listButtonText" TEXT;
