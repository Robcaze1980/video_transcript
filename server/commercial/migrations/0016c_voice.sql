-- LV-016.C - English narration audio kept outside PostgreSQL.
-- Ambient assumptions: \"accounts\" and \"pipeline_jobs\" already exist from earlier increments.

CREATE TABLE IF NOT EXISTS pipeline_narrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  job_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  voice_id text NOT NULL CHECK (voice_id IN ('Kore', 'Charon')),
  voice_gender text NOT NULL CHECK (voice_gender IN ('female', 'male')),
  storage_id uuid NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 33554432),
  duration_ms integer NOT NULL CHECK (duration_ms BETWEEN 1 AND 600000),
  sample_rate integer NOT NULL CHECK (sample_rate = 24000),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pipeline_narrations_gender CHECK (
    (voice_id = 'Kore' AND voice_gender = 'female')
    OR (voice_id = 'Charon' AND voice_gender = 'male')
  ),
  CONSTRAINT pipeline_narrations_storage UNIQUE (storage_id),
  CONSTRAINT pipeline_narrations_job UNIQUE (account_id, job_id),
  CONSTRAINT pipeline_narrations_job_fk FOREIGN KEY (account_id,job_id,revision) REFERENCES pipeline_jobs(account_id,id,revision) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pipeline_narrations_expiry
  ON pipeline_narrations (expires_at);
CREATE INDEX IF NOT EXISTS pipeline_narrations_account_project
  ON pipeline_narrations (account_id, project_id, revision);

-- In-flight reservations are the crash-recovery staging record: the storage UUID exists
-- before any byte touches disk, and reconcile() can remove partial files from here alone.
CREATE TABLE IF NOT EXISTS pipeline_voice_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  job_id uuid NOT NULL,
  storage_id uuid NOT NULL,
  reserved_bytes bigint NOT NULL CHECK (reserved_bytes BETWEEN 1 AND 33554432),
  used_bytes bigint CHECK (used_bytes IS NULL OR used_bytes BETWEEN 1 AND 33554432),
  state text NOT NULL CHECK (state IN ('reserved', 'committed', 'released')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pipeline_voice_reservations_storage UNIQUE (storage_id),
  CONSTRAINT pipeline_voice_reservations_commit CHECK (state <> 'committed' OR used_bytes IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS pipeline_voice_reservations_account_state
  ON pipeline_voice_reservations (account_id, state);
CREATE INDEX IF NOT EXISTS pipeline_voice_reservations_expiry
  ON pipeline_voice_reservations (expires_at);

-- Deletion intent lives in PostgreSQL; the worker owns the filesystem side.
CREATE TABLE IF NOT EXISTS pipeline_voice_tombstones (
  storage_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS pipeline_voice_tombstones_created
  ON pipeline_voice_tombstones (created_at);

CREATE OR REPLACE FUNCTION pipeline_voice_reserve(
  p_account_id uuid,
  p_job_id uuid,
  p_storage_id uuid,
  p_bytes bigint,
  p_expires_at timestamptz
) RETURNS uuid AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_reserved bigint;
BEGIN
  IF p_bytes IS NULL OR p_bytes < 1 OR p_bytes > 33554432 THEN
    RAISE EXCEPTION 'voice reservation size out of range' USING ERRCODE = 'check_violation';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'voice reservation already expired' USING ERRCODE = 'check_violation';
  END IF;

  -- Serialize account quota decisions, including concurrent worker processes.
  PERFORM pg_advisory_xact_lock(hashtext('lv-voice:' || p_account_id::text));
  IF NOT EXISTS(SELECT 1 FROM pipeline_jobs WHERE id=p_job_id AND account_id=p_account_id) THEN
    RAISE EXCEPTION 'voice job owner mismatch' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(reserved_bytes), 0) INTO v_reserved
    FROM pipeline_voice_reservations
    WHERE account_id = p_account_id;

  IF v_reserved + p_bytes > 67108864 THEN
    RAISE EXCEPTION 'voice quota exceeded' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO pipeline_voice_reservations(id, account_id, job_id, storage_id, reserved_bytes, state, expires_at)
  VALUES (v_id, p_account_id, p_job_id, p_storage_id, p_bytes, 'reserved', p_expires_at);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pipeline_voice_commit(
  p_account_id uuid,
  p_storage_id uuid,
  p_bytes bigint
) RETURNS void AS $$
BEGIN
  IF p_bytes IS NULL OR p_bytes < 1 OR p_bytes > 33554432 THEN
    RAISE EXCEPTION 'voice commit size out of range' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE pipeline_voice_reservations
    SET state = 'committed', reserved_bytes = p_bytes, used_bytes = p_bytes, updated_at = clock_timestamp()
    WHERE account_id = p_account_id AND storage_id = p_storage_id AND state = 'reserved' AND expires_at > clock_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'voice reservation missing for commit' USING ERRCODE = 'no_data_found';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pipeline_voice_release(
  p_account_id uuid,
  p_storage_id uuid
) RETURNS void AS $$
BEGIN
  UPDATE pipeline_voice_reservations
    SET state = 'released', updated_at = clock_timestamp()
    WHERE account_id = p_account_id AND storage_id = p_storage_id;
END;
$$ LANGUAGE plpgsql;

-- A narration row that disappears (TTL sweep, project/job deletion, cascade) leaves a tombstone
-- so the private file can be removed later without trusting the client's clock or paths.
CREATE OR REPLACE FUNCTION pipeline_voice_tombstone_narration() RETURNS trigger AS $$
BEGIN
  INSERT INTO pipeline_voice_tombstones(storage_id, account_id, reason)
  VALUES (OLD.storage_id, OLD.account_id, 'narration_deleted')
  ON CONFLICT (storage_id) DO NOTHING;

  -- Retain quota until unlink succeeds; a failed delete still occupies physical disk.
  UPDATE pipeline_voice_reservations SET state='released',updated_at=clock_timestamp()
    WHERE account_id = OLD.account_id AND storage_id = OLD.storage_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pipeline_narrations_tombstone ON pipeline_narrations;
CREATE TRIGGER pipeline_narrations_tombstone
  BEFORE DELETE ON pipeline_narrations
  FOR EACH ROW EXECUTE FUNCTION pipeline_voice_tombstone_narration();
