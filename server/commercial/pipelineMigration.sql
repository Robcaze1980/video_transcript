-- Step A pipeline schema. Additive, idempotent, separate from commercial jobs. Snapshot-only immutability trigger. No changes to jobs/accounts/credit balances.

CREATE TABLE IF NOT EXISTS pipeline_snapshots (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL, project_id uuid NOT NULL, revision integer NOT NULL CHECK (revision > 0), snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'), draft text NOT NULL CHECK (octet_length(draft) <= 65536), original_draft text CHECK (original_draft IS NULL OR octet_length(original_draft) BETWEEN 1 AND 65536), duration double precision NOT NULL CHECK (duration > 0 AND duration <= 600), highlights jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(highlights)='object'), style jsonb CHECK (style IS NULL OR jsonb_typeof(style) = 'object'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, project_id, revision, snapshot_hash), UNIQUE(account_id,id,project_id,revision,snapshot_hash),
  FOREIGN KEY (account_id, project_id) REFERENCES inputs(account_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES subtitle_projects(id) ON DELETE CASCADE );
 
CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL, input_id uuid NOT NULL, project_id uuid NOT NULL, snapshot_id uuid NOT NULL, request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 200), stage text NOT NULL CHECK (stage IN ('transcript','translation','narration','render')), state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','succeeded','failed','cancelled','unknown')), config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'), revision integer NOT NULL CHECK (revision > 0), snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'), attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0), max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0), attempt_id uuid, lease_until timestamptz, error_code text CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 100), error_message text CHECK (error_message IS NULL OR octet_length(error_message) <= 2000), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, id, revision), UNIQUE (account_id, id, snapshot_id),
  UNIQUE (account_id, request_key),
  FOREIGN KEY (account_id, input_id) REFERENCES inputs(account_id, id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, project_id) REFERENCES inputs(account_id, id) ON DELETE CASCADE,
  FOREIGN KEY (account_id,snapshot_id,project_id,revision,snapshot_hash) REFERENCES pipeline_snapshots(account_id,id,project_id,revision,snapshot_hash) ON DELETE CASCADE, CHECK (input_id=project_id), CHECK ((state = 'running' AND attempt_id IS NOT NULL AND lease_until IS NOT NULL) OR (state <> 'running' AND attempt_id IS NULL AND lease_until IS NULL)) );
 
CREATE TABLE IF NOT EXISTS pipeline_artifacts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL, job_id uuid NOT NULL, attempt_id uuid NOT NULL, revision integer NOT NULL CHECK (revision > 0), kind text NOT NULL CHECK (kind IN ('transcript_es','translation_en','subtitle_srt_en','voice_preview_en','voice_full_en','render_mp4_en')), state text NOT NULL DEFAULT 'staged' CHECK (state IN ('staged','ready','failed')), mime_type text NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 100), byte_size bigint CHECK (byte_size IS NULL OR byte_size > 0), duration_ms integer CHECK (duration_ms IS NULL OR duration_ms > 0), sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'), storage_key text CHECK (storage_key IS NULL OR length(storage_key) BETWEEN 1 AND 200), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), ready_at timestamptz, expires_at timestamptz NOT NULL,
  UNIQUE (account_id, job_id, kind, revision),
  FOREIGN KEY (account_id, job_id, revision) REFERENCES pipeline_jobs(account_id, id, revision) ON DELETE CASCADE, CHECK ((state = 'ready' AND ready_at IS NOT NULL) OR (state <> 'ready' AND ready_at IS NULL)), CHECK (state <> 'ready' OR (byte_size IS NOT NULL AND sha256 IS NOT NULL AND storage_key IS NOT NULL)) );
 CREATE INDEX IF NOT EXISTS pipeline_jobs_due ON pipeline_jobs (created_at, id) WHERE state = 'queued';
 CREATE INDEX IF NOT EXISTS pipeline_jobs_lease ON pipeline_jobs (lease_until, id) WHERE state = 'running';
 CREATE INDEX IF NOT EXISTS pipeline_jobs_account_recent ON pipeline_jobs (account_id, created_at DESC, id);
 CREATE INDEX IF NOT EXISTS pipeline_snapshots_project ON pipeline_snapshots (account_id, project_id, revision);
 CREATE INDEX IF NOT EXISTS pipeline_artifacts_job ON pipeline_artifacts (account_id, job_id, revision, kind);

CREATE TABLE IF NOT EXISTS pipeline_dependencies (
  account_id uuid NOT NULL,
  job_id uuid NOT NULL,
  parent_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  PRIMARY KEY(job_id,parent_id),
  CHECK(job_id<>parent_id),
  FOREIGN KEY(account_id,job_id,snapshot_id) REFERENCES pipeline_jobs(account_id,id,snapshot_id) ON DELETE CASCADE,
  FOREIGN KEY(account_id,parent_id,snapshot_id) REFERENCES pipeline_jobs(account_id,id,snapshot_id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION pipeline_immutable_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Pipeline snapshots are immutable';
END;
$$;
DROP TRIGGER IF EXISTS pipeline_snapshot_immutable ON pipeline_snapshots;
CREATE TRIGGER pipeline_snapshot_immutable BEFORE UPDATE ON pipeline_snapshots
  FOR EACH ROW EXECUTE FUNCTION pipeline_immutable_snapshot();
