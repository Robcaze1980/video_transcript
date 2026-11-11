CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  available integer NOT NULL DEFAULT 0 CHECK (available >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  consumed integer NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  credited integer NOT NULL DEFAULT 0 CHECK (credited = available + reserved + consumed)
);

CREATE TABLE pilot_language_requests (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_id text NOT NULL,
  target_id text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, source_id, target_id)
);

CREATE TABLE checkout_orders (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  provider_order_id text UNIQUE,
  currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  amount integer NOT NULL CHECK (amount > 0),
  credits integer NOT NULL CHECK (credits > 0),
  capture_requested_at timestamptz,
  next_attempt_at timestamptz,
  fulfilled_at timestamptz
);

CREATE TABLE purchases (
  payment_ref text PRIMARY KEY,
  checkout_order_id uuid UNIQUE REFERENCES checkout_orders(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  credits integer NOT NULL CHECK (credits > 0)
);

CREATE INDEX checkout_due ON checkout_orders (next_attempt_at, id)
  WHERE fulfilled_at IS NULL AND next_attempt_at IS NOT NULL;

CREATE TABLE inputs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  private_upload_id uuid,
  content bytea CHECK (octet_length(content) BETWEEN 1 AND 1048576),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '24 hours',
  UNIQUE (account_id, id)
);

CREATE TABLE subtitle_projects (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  duration double precision NOT NULL CHECK (duration > 0 AND duration <= 600),
  draft text NOT NULL CONSTRAINT subtitle_projects_draft_size CHECK (octet_length(draft) <= 65536),
  original_draft text CHECK (octet_length(original_draft) BETWEEN 1 AND 65536),
  highlights jsonb NOT NULL DEFAULT '{}'::jsonb,
  subtitle_style jsonb CHECK (jsonb_typeof(subtitle_style) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (account_id, id) REFERENCES inputs(account_id, id)
);

CREATE INDEX subtitle_projects_recent ON subtitle_projects (account_id, updated_at DESC, id);

CREATE TABLE subtitle_presets (
  account_id uuid NOT NULL REFERENCES accounts(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 48),
  style jsonb NOT NULL CHECK (jsonb_typeof(style) = 'object'),
  PRIMARY KEY (account_id, name)
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  input_id uuid NOT NULL,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 200),
  service text NOT NULL,
  options jsonb NOT NULL,
  price integer NOT NULL CHECK (price > 0),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  ready_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempt_id uuid,
  lease_until timestamptz,
  result bytea,
  original_result bytea CHECK (original_result IS NULL OR (octet_length(original_result) BETWEEN 1 AND 65536 AND result IS NOT NULL)),
  artifacts_removed_at timestamptz,
  UNIQUE (account_id, request_key),
  FOREIGN KEY (account_id, input_id) REFERENCES inputs(account_id, id),
  CHECK ((state = 'running' AND attempt_id IS NOT NULL AND lease_until IS NOT NULL)
      OR (state <> 'running' AND attempt_id IS NULL AND lease_until IS NULL)),
  CONSTRAINT jobs_result_lifecycle CHECK ((state = 'succeeded' AND artifacts_removed_at IS NULL) = (result IS NOT NULL)),
  CHECK (result IS NULL OR octet_length(result) BETWEEN 1 AND 1048576)
);

CREATE INDEX jobs_ready ON jobs (ready_at, id) WHERE state = 'queued';
CREATE INDEX jobs_expired ON jobs (lease_until, id) WHERE state = 'running';

CREATE FUNCTION clear_job_original_subtitles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.original_result := NULL;
  RETURN NEW;
END $$;

CREATE TRIGGER jobs_clear_original_subtitles BEFORE UPDATE OF result ON jobs
  FOR EACH ROW WHEN (NEW.result IS NULL AND NEW.original_result IS NOT NULL)
  EXECUTE FUNCTION clear_job_original_subtitles();

CREATE TABLE credit_movements (
  kind text NOT NULL CHECK (kind IN ('purchase', 'reserve', 'capture', 'release')),
  reference text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  credits integer NOT NULL CHECK (credits > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (kind, reference)
);

CREATE UNIQUE INDEX one_terminal_movement ON credit_movements(reference)
  WHERE kind IN ('capture', 'release');
