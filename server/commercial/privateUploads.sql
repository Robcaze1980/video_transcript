CREATE TABLE IF NOT EXISTS private_uploads (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 200),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  size bigint NOT NULL CHECK (size > 0),
  offset_bytes bigint NOT NULL DEFAULT 0 CHECK (offset_bytes >= 0 AND offset_bytes <= size),
  state text NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading', 'ready', 'deleting', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  metadata jsonb,
  UNIQUE (account_id, request_key),
  CHECK (expires_at > created_at),
  CHECK (state <> 'ready' OR (offset_bytes = size AND metadata IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS private_uploads_expiry ON private_uploads(expires_at, id) WHERE state <> 'deleted';
CREATE INDEX IF NOT EXISTS private_uploads_account ON private_uploads(account_id, state);
