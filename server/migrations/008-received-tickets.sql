-- Immutable evidence snapshots. Wallet fields are recipient-reported history,
-- never server assertions of ownership, mining, unspentness or admission.
CREATE TABLE received_ticket_archives (
 owner_key text NOT NULL,
 id text NOT NULL CHECK (id ~ '^[0-9a-f]{64}$'),
 txid text NOT NULL CHECK (txid ~ '^[0-9a-f]{64}$'),
 output_index bigint NOT NULL CHECK (output_index BETWEEN 0 AND 4294967295),
 binding text NOT NULL,
 evidence jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_key,id)
);
CREATE INDEX received_ticket_archives_owner ON received_ticket_archives(owner_key,created_at DESC,id);
CREATE INDEX received_ticket_archives_output ON received_ticket_archives(owner_key,txid,output_index);
