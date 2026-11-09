CREATE TABLE login_challenges (
  token_hash text PRIMARY KEY,
  nonce text NOT NULL,
  cancellation_hash text NOT NULL,
  origin text NOT NULL,
  expires_at bigint NOT NULL
);
CREATE TABLE login_sessions (
  token_hash text PRIMARY KEY,
  identity_key text NOT NULL,
  cancellation_hash text NOT NULL,
  origin text NOT NULL,
  expires_at bigint NOT NULL
);
CREATE INDEX login_sessions_expiry ON login_sessions(expires_at);
CREATE INDEX login_challenges_expiry ON login_challenges(expires_at);
CREATE TABLE organiser_events (
  id uuid PRIMARY KEY,
  owner_key text NOT NULL,
  request_id uuid NOT NULL,
  creation_details jsonb NOT NULL,
  UNIQUE(owner_key, request_id),
  details jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organiser_events_owner ON organiser_events(owner_key, updated_at DESC);
