CREATE TABLE IF NOT EXISTS pilot_language_requests (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_id text NOT NULL,
  target_id text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, source_id, target_id)
);
