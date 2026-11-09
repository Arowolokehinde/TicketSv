CREATE TABLE venue_issuances (
 id uuid PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES organiser_events(id),
 owner_key text NOT NULL,
 event_revision integer NOT NULL,
 event_details jsonb NOT NULL,
 request jsonb NOT NULL,
 status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','pending','complete')),
 txid text,
 package jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_unresolved_issuance_per_event ON venue_issuances(event_id) WHERE status <> 'complete';
CREATE INDEX venue_issuances_owner_event ON venue_issuances(owner_key,event_id,created_at);
