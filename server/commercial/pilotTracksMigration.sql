ALTER TABLE subtitle_projects
  ADD COLUMN IF NOT EXISTS original_draft text CHECK (octet_length(original_draft) BETWEEN 1 AND 65536);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'subtitle_projects'::regclass AND conname = 'subtitle_projects_draft_check'
  ) THEN
    ALTER TABLE subtitle_projects DROP CONSTRAINT subtitle_projects_draft_check,
      ADD CONSTRAINT subtitle_projects_draft_size CHECK (octet_length(draft) <= 65536);
  END IF;
END $$;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS original_result bytea
    CHECK (original_result IS NULL OR (octet_length(original_result) BETWEEN 1 AND 65536 AND result IS NOT NULL));

CREATE OR REPLACE FUNCTION clear_job_original_subtitles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.original_result := NULL;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER jobs_clear_original_subtitles BEFORE UPDATE OF result ON jobs
  FOR EACH ROW WHEN (NEW.result IS NULL AND NEW.original_result IS NOT NULL)
  EXECUTE FUNCTION clear_job_original_subtitles();
