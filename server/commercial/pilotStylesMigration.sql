ALTER TABLE subtitle_projects
  ADD COLUMN IF NOT EXISTS subtitle_style jsonb CHECK (jsonb_typeof(subtitle_style) = 'object');

CREATE TABLE IF NOT EXISTS subtitle_presets (
  account_id uuid NOT NULL REFERENCES accounts(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 48),
  style jsonb NOT NULL CHECK (jsonb_typeof(style) = 'object'),
  PRIMARY KEY (account_id, name)
);
