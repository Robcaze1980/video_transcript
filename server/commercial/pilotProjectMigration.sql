CREATE TABLE IF NOT EXISTS subtitle_projects (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  duration double precision NOT NULL CHECK (duration > 0 AND duration <= 30),
  draft text NOT NULL CHECK (octet_length(draft) BETWEEN 1 AND 65536),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (account_id, id) REFERENCES inputs(account_id, id)
);

CREATE INDEX IF NOT EXISTS subtitle_projects_recent
  ON subtitle_projects (account_id, updated_at DESC, id);
