-- Ticket IDs are unique per organiser, not across organisers, so creating a
-- ticket never reveals whether another organiser already uses that ID.
ALTER TABLE venue_issuances DROP CONSTRAINT venue_issuances_pkey, ADD PRIMARY KEY (owner_key, id);
