-- Scheduling metadata only; retained header history is unchanged.
ALTER TABLE header_cache ADD COLUMN warm_checked_at timestamptz;
ALTER TABLE header_cache ADD COLUMN warm_error text;
ALTER TABLE header_cache ADD COLUMN tip_height integer;
-- Backfill progress once, rather than reading the JSON history on every poll.
UPDATE header_cache SET tip_height=(snapshot->'headers'->-1->>'height')::integer WHERE snapshot IS NOT NULL;
