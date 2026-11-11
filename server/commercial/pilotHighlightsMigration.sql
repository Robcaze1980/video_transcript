ALTER TABLE subtitle_projects
  ADD COLUMN IF NOT EXISTS highlights jsonb NOT NULL DEFAULT '{}'::jsonb;
