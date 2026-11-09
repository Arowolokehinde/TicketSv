CREATE TABLE header_cache_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cache_key text NOT NULL REFERENCES header_cache(cache_key),
 observed_at timestamptz NOT NULL DEFAULT now(),
 detail jsonb NOT NULL
);
