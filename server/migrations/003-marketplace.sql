CREATE TABLE event_publications (
 event_id uuid PRIMARY KEY REFERENCES organiser_events(id),
 owner_key text NOT NULL,
 revision integer NOT NULL,
 details jsonb NOT NULL,
 published boolean NOT NULL DEFAULT true,
 published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE attendee_requests (
 id uuid PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES organiser_events(id),
 attendee_key text NOT NULL,
 venue_key text NOT NULL,
 event_revision integer NOT NULL,
 event_details jsonb NOT NULL,
 proof jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id, attendee_key)
);
CREATE INDEX attendee_requests_owner ON attendee_requests(attendee_key, created_at DESC);
ALTER TABLE venue_issuances ADD COLUMN attendee_request_id uuid UNIQUE REFERENCES attendee_requests(id);
