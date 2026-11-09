CREATE TABLE auth_peer_sessions (
  session_nonce text PRIMARY KEY,
  identity_key text,
  authenticated boolean NOT NULL,
  authorization_ready boolean NOT NULL,
  last_update bigint NOT NULL,
  expires_at bigint NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX auth_peer_identity ON auth_peer_sessions(identity_key);
CREATE INDEX auth_peer_expiry ON auth_peer_sessions(expires_at);
CREATE TABLE auth_message_nonces (
  session_nonce text NOT NULL REFERENCES auth_peer_sessions(session_nonce) ON DELETE CASCADE,
  nonce text NOT NULL,
  PRIMARY KEY (session_nonce, nonce)
);
CREATE TABLE auth_initial_nonces (
  identity_key text NOT NULL,
  nonce text NOT NULL,
  claimed_at bigint NOT NULL,
  PRIMARY KEY (identity_key, nonce)
);
CREATE INDEX auth_initial_expiry ON auth_initial_nonces(claimed_at);
