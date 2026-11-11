ALTER TABLE inputs ADD COLUMN IF NOT EXISTS private_upload_id uuid;
ALTER TABLE subtitle_projects DROP CONSTRAINT IF EXISTS subtitle_projects_duration_check;
ALTER TABLE subtitle_projects ADD CONSTRAINT subtitle_projects_duration_check CHECK(duration>0 AND duration<=600);
