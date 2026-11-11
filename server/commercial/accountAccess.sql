CREATE TABLE IF NOT EXISTS commercial_identities (
  email text PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS commercial_email_codes (
  email text PRIMARY KEY,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS commercial_sessions (
  digest text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS commercial_session_expiry ON commercial_sessions(expires_at);

CREATE TABLE IF NOT EXISTS commercial_firebase_identities (
  firebase_uid text PRIMARY KEY CHECK (length(firebase_uid) BETWEEN 1 AND 128),
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS commercial_supabase_identities (
  user_id uuid PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS commercial_password_resets (
  digest text PRIMARY KEY,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
