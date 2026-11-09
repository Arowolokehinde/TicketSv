CREATE TABLE header_cache (
 cache_key text PRIMARY KEY,
 target integer NOT NULL,
 snapshot jsonb,
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','collecting','ready','retrying','blocked')),
 error text,
 retry_at timestamptz,
 checked_at timestamptz
);
