-- Apply in a transaction under the deployment migration lock. Additive; safe to repeat.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_state_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_state_check CHECK (state IN ('queued','running','succeeded','failed','cancelled','unknown'));
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS reconciliation_ref text CHECK (length(reconciliation_ref) BETWEEN 1 AND 500);
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS create_return_url text;
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS create_started_at timestamptz;
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS create_lease uuid;
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS approval_url text;
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS create_request_key text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS unknown_attempt_id uuid;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quarantined_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS input_sha256 text CHECK (input_sha256 ~ '^[a-f0-9]{64}$');
-- PostgreSQL's built-in SHA-256 needs no extension. Expired/deleted bytes stay absent.
UPDATE jobs j SET input_sha256=encode(sha256(i.content),'hex') FROM inputs i
WHERE j.input_id=i.id AND j.account_id=i.account_id AND j.input_sha256 IS NULL AND i.content IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS checkout_create_key ON checkout_orders(account_id,create_request_key) WHERE create_request_key IS NOT NULL;
