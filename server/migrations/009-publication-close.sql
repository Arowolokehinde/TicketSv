-- Closing instant computed in Node at publication; listings compare timestamps
-- and never ask Postgres to interpret stored timezone names.
ALTER TABLE event_publications ADD COLUMN requests_close_at timestamptz;
