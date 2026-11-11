ALTER TABLE inputs
  ALTER COLUMN content DROP NOT NULL,
  ADD COLUMN expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '24 hours';

ALTER TABLE jobs
  ADD COLUMN artifacts_removed_at timestamptz,
  DROP CONSTRAINT jobs_check1,
  ADD CONSTRAINT jobs_result_lifecycle CHECK ((state = 'succeeded' AND artifacts_removed_at IS NULL) = (result IS NOT NULL));
