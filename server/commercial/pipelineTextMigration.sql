CREATE TABLE IF NOT EXISTS pipeline_text_results (
  account_id uuid NOT NULL,
  job_id uuid PRIMARY KEY,
  revision integer NOT NULL,
  cues jsonb NOT NULL CHECK(jsonb_typeof(cues)='array' AND jsonb_array_length(cues) BETWEEN 1 AND 1000),
  es_srt text NOT NULL CHECK(octet_length(es_srt) BETWEEN 1 AND 65536),
  en_srt text NOT NULL CHECK(octet_length(en_srt) BETWEEN 1 AND 65536),
  applied_revision integer CHECK(applied_revision>revision),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY(account_id,job_id,revision) REFERENCES pipeline_jobs(account_id,id,revision) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_text_single_active ON pipeline_jobs(account_id,input_id)
  WHERE stage='translation' AND config->>'model'='gemini-3.8-flash' AND state IN ('queued','running','unknown');
ALTER TABLE subtitle_projects ADD COLUMN IF NOT EXISTS segment_ids jsonb;
ALTER TABLE pipeline_text_results ADD COLUMN IF NOT EXISTS es_txt text;
ALTER TABLE pipeline_text_results ADD COLUMN IF NOT EXISTS en_txt text;
UPDATE pipeline_text_results r SET es_txt=(SELECT string_agg(c->>'es',E'\n' ORDER BY n)||E'\n' FROM jsonb_array_elements(r.cues) WITH ORDINALITY AS x(c,n)) WHERE es_txt IS NULL;
UPDATE pipeline_text_results r SET en_txt=(SELECT string_agg(c->>'en',E'\n' ORDER BY n)||E'\n' FROM jsonb_array_elements(r.cues) WITH ORDINALITY AS x(c,n)) WHERE en_txt IS NULL;
ALTER TABLE pipeline_text_results ALTER COLUMN es_txt SET NOT NULL;
ALTER TABLE pipeline_text_results ALTER COLUMN en_txt SET NOT NULL;
