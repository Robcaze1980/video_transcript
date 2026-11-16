import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { PilotStyle, SubtitlePreset } from './pilotStyles';
import type { SavedHighlights } from './pilotHighlights';

type Options = Record<string, unknown>;
export interface FileInput { id: string; path: string; size: number; name: string; expiresAt: Date;
  metadata: { duration: number; width: number; height: number; audioTracks: number; sha256?: string } }
export interface JobFiles {
  get(accountId: string, id: string): Promise<FileInput>;
  abort(accountId: string, id: string): Promise<unknown>;
  getWithClient(client: PoolClient, accountId: string, id: string): Promise<FileInput>;
  purgeExpired(): Promise<{ deleted: number; failed: number }>;
}

export interface JobAdapter {
  readonly key: string;
  readonly price: number;
  measurePrice?(input: Buffer): Promise<number>;
  validateFile?(input: FileInput, options: Options): void;
  measureFilePrice?(input: FileInput): Promise<number>;
  executeFile?(input: FileInput, options: Options, jobId: string, signal?: AbortSignal): Promise<Buffer | JobArtifacts>;
  validate(input: Buffer, options: Options): void;
  execute(input: Buffer, options: Options, jobId: string, signal?: AbortSignal): Promise<Buffer | JobArtifacts>;
}

interface JobArtifacts { result: Buffer; original?: Buffer }
interface Job {
  id: string;
  account_id: string;
  input_id: string;
  service: string;
  options: Options;
  price: number;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  attempts: number;
  max_attempts: number;
}

interface Attempt extends Job {
  attempt_id: string;
  content: Buffer;
  private_upload_id?: string;
}

export class JobError extends Error {
  constructor(readonly code: 'not_found' | 'conflict' | 'insufficient_credits' | 'invalid_input', message: string) {
    super(message);
  }
}

export class RetryableJobError extends Error {}

/** A provider may have performed the operation. Never automatically repeat it. */
export class JobOutcomeUnknown extends Error {}

export class CommercialJobs {
  private readonly activeAttempts = new Map<string, AbortController>();
  constructor(private readonly pool: Pool, private readonly adapters: ReadonlyMap<string, JobAdapter>, private readonly files?: JobFiles) {}

  async addFileInput(accountId: string, uploadId: string) {
    if (!this.files) throw new JobError('invalid_input', 'Private storage is unavailable.');
    const asset = await this.files.get(accountId, uploadId);
    await this.transaction(async client => {
      const ready = await client.query(`SELECT 1 FROM private_uploads WHERE id=$1 AND account_id=$2
        AND state='ready' AND expires_at>clock_timestamp() FOR UPDATE`, [uploadId, accountId]);
      if (!ready.rowCount) throw new JobError('not_found', 'Video unavailable.');
      await client.query(`INSERT INTO inputs(id,account_id,private_upload_id,expires_at) VALUES($1,$2,$1,$3)
        ON CONFLICT(id) DO NOTHING`, [uploadId, accountId, asset.expiresAt]);
    });
    return uploadId;
  }

  async fileInput(accountId: string, inputId: string) {
    const { rows: [input] } = await this.pool.query<{ private_upload_id: string }>(
      'SELECT private_upload_id FROM inputs WHERE id=$1 AND account_id=$2 AND expires_at>clock_timestamp()', [inputId, accountId]);
    return input?.private_upload_id && this.files ? this.files.get(accountId, input.private_upload_id) : undefined;
  }

  async createAccount() {
    const id = randomUUID();
    await this.pool.query('INSERT INTO accounts(id) VALUES ($1)', [id]);
    return id;
  }

  async addInput(accountId: string, content: Buffer) {
    return this.transaction(async client => {
      await this.lockAccount(client, accountId);
      return this.insertInput(client, accountId, content);
    });
  }

  private async insertInput(client: PoolClient, accountId: string, content: Buffer) {
    const id = randomUUID();
    const { rows: [quota] } = await client.query<{ remaining: number }>(
      'SELECT (20971520 - COALESCE(sum(octet_length(content)),0))::int AS remaining FROM inputs WHERE account_id=$1',
      [accountId],
    );
    if (content.length > quota.remaining) throw new JobError('invalid_input', 'La cuenta alcanzó el límite de 20 MiB de entradas.');
    await client.query('INSERT INTO inputs(id, account_id, content) VALUES ($1, $2, $3)', [id, accountId, content]);
    return id;
  }

  async createSubtitleProject(accountId: string, input: Buffer | string, name: string, duration: number, draft: string,
    sourceJobId?: string, originalDraft?: string) {
    return this.transaction(async client => {
      await this.lockAccount(client, accountId);
      if (sourceJobId) {
        const source = await client.query(
          `SELECT 1 FROM jobs j JOIN inputs i ON i.id=j.input_id AND i.account_id=j.account_id
           WHERE j.id=$1 AND j.account_id=$2 AND j.state='succeeded' AND j.result IS NOT NULL
           AND (i.content IS NOT NULL OR i.private_upload_id IS NOT NULL) AND i.expires_at>clock_timestamp() FOR UPDATE OF i`,
          [sourceJobId, accountId],
        );
        if (!source.rowCount) throw new JobError('not_found', 'Source job files are no longer available.');
      }
      const { rowCount } = await client.query(
        `SELECT 1 FROM subtitle_projects p JOIN inputs i USING (id,account_id)
         WHERE p.account_id=$1 AND (i.content IS NOT NULL OR i.private_upload_id IS NOT NULL) AND i.expires_at>clock_timestamp()
         OFFSET 19 LIMIT 1`, [accountId],
      );
      if (rowCount) throw new JobError('invalid_input', 'La cuenta alcanzó el límite de 20 proyectos.');
      const id = typeof input === 'string' ? input : await this.insertInput(client, accountId, input);
      if (typeof input === 'string') {
        const ready = await client.query('SELECT 1 FROM inputs WHERE id=$1 AND account_id=$2 AND private_upload_id IS NOT NULL AND expires_at>clock_timestamp() FOR UPDATE', [id, accountId]);
        if (!ready.rowCount || !this.files) throw new JobError('not_found', 'Video unavailable.');
        await this.files.getWithClient(client, accountId, id);
        const prior = await client.query<{ draft: string; original_draft: string | null }>(
          'SELECT draft,original_draft FROM subtitle_projects WHERE id=$1 AND account_id=$2', [id, accountId]);
        if (prior.rowCount) {
          if (prior.rows[0].draft !== draft || prior.rows[0].original_draft !== (originalDraft ?? null)) {
            throw new JobError('conflict', 'El video ya tiene un proyecto. Abre el proyecto existente para editarlo.');
          }
          return id;
        }
      }
      await client.query(
        'INSERT INTO subtitle_projects(id, account_id, name, duration, draft, original_draft) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, accountId, name, duration, draft, originalDraft ?? null],
      );
      return id;
    });
  }

  async subtitleProjects(accountId: string) {
    const { rows } = await this.pool.query<{ id: string; name: string; expires_at: Date }>(
      `SELECT p.id,p.name,i.expires_at FROM subtitle_projects p JOIN inputs i USING (id,account_id)
       WHERE p.account_id=$1 AND (i.content IS NOT NULL OR i.private_upload_id IS NOT NULL) AND i.expires_at>clock_timestamp()
       ORDER BY p.updated_at DESC,p.id`, [accountId],
    );
    return rows;
  }

  async subtitleProject(accountId: string, id: string) {
    const { rows: [project] } = await this.pool.query<{
      draft: string; originalDraft: string | null; style: PilotStyle | null; duration: number; revision: number;
      highlights: SavedHighlights; segmentIds: Record<string,string[]> | null;
    }>(
      `SELECT p.draft,p.original_draft AS "originalDraft",p.subtitle_style AS style,p.duration,p.revision,p.highlights,p.segment_ids AS "segmentIds"
       FROM subtitle_projects p JOIN inputs i USING (id,account_id)
       WHERE p.id=$1 AND p.account_id=$2 AND (i.content IS NOT NULL OR i.private_upload_id IS NOT NULL) AND i.expires_at>clock_timestamp()`, [id, accountId],
    );
    return project;
  }

  async subtitleProjectSource(accountId: string, id: string) {
    const { rows: [project] } = await this.pool.query<{ content: Buffer }>(
      `SELECT i.content FROM subtitle_projects p JOIN inputs i USING (id,account_id)
       WHERE p.id=$1 AND p.account_id=$2 AND (i.content IS NOT NULL OR i.private_upload_id IS NOT NULL) AND i.expires_at>clock_timestamp()`, [id, accountId],
    );
    return project?.content;
  }

  async saveSubtitleProject(accountId: string, id: string, revision: number, draft: string | undefined, originalDraft?: string | null,
    style?: PilotStyle | null, highlights?: SavedHighlights, segmentIds?: Record<string,string[]>) {
    const { rows: [project] } = await this.pool.query<{ revision: number }>(
      `UPDATE subtitle_projects p SET draft=COALESCE($4,p.draft), original_draft=CASE WHEN $5 THEN $6 ELSE p.original_draft END,
       subtitle_style=CASE WHEN $7 THEN $8 ELSE p.subtitle_style END,
       highlights=(p.highlights - ARRAY(
         SELECT track FROM (VALUES ('translated', $4 IS NOT NULL AND $4 IS DISTINCT FROM p.draft),
           ('original', $5 AND $6 IS DISTINCT FROM p.original_draft)) AS tracks(track, changed) WHERE changed
       )) || COALESCE($9::jsonb, '{}'::jsonb),
       segment_ids=CASE WHEN $10::jsonb IS NOT NULL THEN $10::jsonb
         WHEN ($4 IS NOT NULL AND $4 IS DISTINCT FROM p.draft) OR ($5 AND $6 IS DISTINCT FROM p.original_draft) THEN NULL ELSE p.segment_ids END,
       revision=p.revision+1, updated_at=clock_timestamp() FROM inputs i
       WHERE p.id=$1 AND p.account_id=$2 AND p.revision=$3 AND i.id=p.id AND i.account_id=p.account_id
       AND (i.content IS NOT NULL OR i.private_upload_id IS NOT NULL) AND i.expires_at>clock_timestamp() RETURNING p.revision`,
      [id, accountId, revision, draft ?? null, originalDraft !== undefined, originalDraft ?? null, style !== undefined, style ?? null,
        highlights ?? null, segmentIds ?? null],
    );
    return project;
  }

  async subtitlePresets(accountId: string) {
    const { rows } = await this.pool.query<SubtitlePreset>(
      'SELECT name,style FROM subtitle_presets WHERE account_id=$1 ORDER BY name', [accountId],
    );
    return rows;
  }

  async saveSubtitlePreset(accountId: string, preset: SubtitlePreset) {
    return this.transaction(async client => {
      await this.lockAccount(client, accountId);
      const limit = await client.query(
        'SELECT 1 FROM subtitle_presets WHERE account_id=$1 AND name<>$2 OFFSET 11 LIMIT 1', [accountId, preset.name],
      );
      if (limit.rowCount) return false;
      await client.query(
        `INSERT INTO subtitle_presets(account_id,name,style) VALUES ($1,$2,$3)
         ON CONFLICT (account_id,name) DO UPDATE SET style=EXCLUDED.style`,
        [accountId, preset.name, preset.style],
      );
      return true;
    });
  }

  async deleteSubtitlePreset(accountId: string, name: string) {
    const { rowCount } = await this.pool.query('DELETE FROM subtitle_presets WHERE account_id=$1 AND name=$2', [accountId, name]);
    return rowCount === 1;
  }

  async deleteSubtitleProject(accountId: string, id: string) {
    return this.transaction(async client => {
      const { rowCount } = await client.query(
        `SELECT 1 FROM subtitle_projects p JOIN inputs i USING (id,account_id)
         WHERE p.id=$1 AND p.account_id=$2 FOR UPDATE OF i`, [id, accountId],
      );
      if (!rowCount) return false;
      await this.removeTerminalArtifacts(client, [id]);
      return true;
    }, true);
  }

  async balance(accountId: string) {
    const { rows } = await this.pool.query(
      'SELECT available, reserved, consumed, credited FROM accounts WHERE id=$1', [accountId]
    );
    return rows[0];
  }

  // Internal boundary. The caller must verify that payment is settled before invoking this method.
  async creditConfirmedPurchase(accountId: string, paymentRef: string, credits: number) {
    return this.transaction(client => this.applyPurchase(client, accountId, paymentRef, credits));
  }

  async applyCompletedCapture(orderId: string, capture: {
    orderId: string;
    reference: string;
    captureId: string;
    amount: number;
    currency: string;
  }) {
    return this.transaction(async client => {
      const { rows: [order] } = await client.query('SELECT * FROM checkout_orders WHERE id=$1 FOR UPDATE', [orderId]);
      if (!order || order.provider_order_id !== capture.orderId || order.id !== capture.reference ||
          order.currency !== capture.currency || order.amount !== capture.amount || !capture.captureId) {
        throw new JobError('conflict', 'Checkout payment does not match the order.');
      }
      if (order.fulfilled_at) return false;
      const credited = await this.applyPurchase(client, order.account_id, 'paypal:' + capture.captureId, order.credits, order.id);
      await client.query('UPDATE checkout_orders SET fulfilled_at=clock_timestamp(),next_attempt_at=NULL WHERE id=$1', [orderId]);
      return credited;
    });
  }

  private async applyPurchase(client: PoolClient, accountId: string, paymentRef: string, credits: number,
    orderId: string | null = null) {
    await this.lockAccount(client, accountId);
    const inserted = await client.query(
      'INSERT INTO purchases(payment_ref,account_id,credits,checkout_order_id) VALUES ($1,$2,$3,$4) ON CONFLICT (payment_ref) DO NOTHING',
      [paymentRef, accountId, credits, orderId]
    );
    if (!inserted.rowCount) {
      const { rows: [purchase] } = await client.query('SELECT * FROM purchases WHERE payment_ref=$1', [paymentRef]);
      if (purchase.account_id !== accountId || purchase.credits !== credits || purchase.checkout_order_id !== orderId) {
        throw new JobError('conflict', 'The purchase already has different details.');
      }
      return false;
    }
    await client.query('UPDATE accounts SET available=available+$2, credited=credited+$2 WHERE id=$1', [accountId, credits]);
    await this.record(client, 'purchase', paymentRef, accountId, credits);
    return true;
  }

  async enqueue(accountId: string, inputId: string, requestKey: string, service: string, options: Options) {
    const encoded = JSON.stringify(options);
    return this.transaction(async client => {
      const available = await this.lockAccount(client, accountId);
      const { rows: [existing] } = await client.query<{ id: string; matches: boolean }>(
        `SELECT id, (input_id=$3 AND service=$4 AND options=$5::jsonb) AS matches
         FROM jobs WHERE account_id=$1 AND request_key=$2`,
        [accountId, requestKey, inputId, service, encoded]
      );
      if (existing) {
        if (!existing.matches) throw new JobError('conflict', 'This request key belongs to another job.');
        return existing.id;
      }
      const unresolved = await client.query("SELECT 1 FROM jobs WHERE account_id=$1 AND input_id=$2 AND state='unknown'", [accountId, inputId]);
      if (unresolved.rowCount) throw new JobError('conflict', 'The previous operation requires reconciliation before retrying.');
      const adapter = this.adapters.get(service);
      if (!adapter) throw new JobError('not_found', 'Service not found.');
      const { rows: [input] } = await client.query<{ content: Buffer; private_upload_id: string }>(
        `SELECT content,private_upload_id FROM inputs WHERE id=$1 AND account_id=$2
         AND (content IS NOT NULL OR private_upload_id IS NOT NULL) AND expires_at>clock_timestamp()
         AND NOT EXISTS (SELECT 1 FROM subtitle_projects WHERE id=inputs.id) FOR UPDATE`, [inputId, accountId]
      );
      if (!input) throw new JobError('not_found', 'Input not found.');
      let price = adapter.price;
      let fingerprint = input.content ? createHash('sha256').update(input.content).digest('hex') : null;
      try {
        if (input.private_upload_id) {
          if (!this.files || !adapter.validateFile || !adapter.measureFilePrice || !adapter.executeFile) throw new Error('Large video processing is not available for this service.');
          const file = await this.files.getWithClient(client, accountId, input.private_upload_id);
          if (!file.metadata.sha256 || !/^[a-f0-9]{64}$/.test(file.metadata.sha256)) {
            throw new Error('Private upload fingerprint is unavailable.');
          }
          fingerprint = file.metadata.sha256;
          adapter.validateFile(file, JSON.parse(encoded) as Options);
          price = await adapter.measureFilePrice(file);
        } else {
          adapter.validate(input.content, JSON.parse(encoded) as Options);
          if (adapter.measurePrice) price = await adapter.measurePrice(input.content);
        }
      } catch (error) {
        throw new JobError('invalid_input', error instanceof Error ? error.message : 'Invalid input.');
      }
      if (!Number.isSafeInteger(price) || price < 1) throw new Error('Invalid service price.');
      if (available < price) throw new JobError('insufficient_credits', 'Insufficient available credits.');
      const active = await client.query(
        "SELECT 1 FROM jobs WHERE account_id=$1 AND state IN ('queued','running','unknown') OFFSET 2 LIMIT 1", [accountId],
      );
      if (active.rowCount) throw new JobError('conflict', 'La cuenta ya tiene tres trabajos activos.');
      const id = randomUUID();
      await client.query(
        'INSERT INTO jobs(id,account_id,input_id,request_key,service,options,price,max_attempts,input_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,3,$8)',
        [id, accountId, inputId, requestKey, service, encoded, price,
          fingerprint]
      );
      await client.query('UPDATE accounts SET available=available-$2, reserved=reserved+$2 WHERE id=$1', [accountId, price]);
      await this.record(client, 'reserve', id, accountId, price);
      return id;
    });
  }

  async result(accountId: string, jobId: string) {
    const { rows: [job] } = await this.pool.query<{ state: Job['state']; result: Buffer | null; original: Buffer | null }>(
      `SELECT jobs.state,CASE WHEN inputs.expires_at>clock_timestamp() THEN jobs.result END AS result,
       CASE WHEN inputs.expires_at>clock_timestamp() THEN jobs.original_result END AS original
       FROM jobs JOIN inputs ON inputs.id=jobs.input_id WHERE jobs.account_id=$1 AND jobs.id=$2`, [accountId, jobId]
    );
    return job ?? null;
  }

  async completedInput(accountId: string, jobId: string, service: string) {
    const { rows: [input] } = await this.pool.query<{ content: Buffer }>(
      `SELECT inputs.content FROM jobs JOIN inputs ON inputs.id=jobs.input_id AND inputs.account_id=jobs.account_id
       WHERE jobs.account_id=$1 AND jobs.id=$2 AND jobs.service=$3 AND jobs.state='succeeded'
       AND inputs.expires_at>clock_timestamp()`, [accountId, jobId, service]
    );
    return input?.content;
  }

  async completedFile(accountId: string, jobId: string, service: string) {
    const { rows: [input] } = await this.pool.query<{ id: string }>(
      `SELECT i.id FROM jobs j JOIN inputs i ON i.id=j.input_id AND i.account_id=j.account_id
       WHERE j.account_id=$1 AND j.id=$2 AND j.service=$3 AND j.state='succeeded'
       AND i.private_upload_id IS NOT NULL AND i.expires_at>clock_timestamp()`, [accountId, jobId, service]);
    return input ? this.fileInput(accountId, input.id) : undefined;
  }

  async status(accountId: string, jobId: string) {
    const { rows: [job] } = await this.pool.query<Pick<Job, 'id' | 'state' | 'service' | 'price'>>(
      'SELECT id,state,service,price FROM jobs WHERE account_id=$1 AND id=$2', [accountId, jobId]
    );
    return job ?? null;
  }

  async retry(accountId: string, jobId: string) {
    const { rows: [job] } = await this.pool.query<Pick<Job, 'input_id' | 'service' | 'options'>>(
      "SELECT input_id,service,options FROM jobs WHERE id=$1 AND account_id=$2 AND state IN ('failed','cancelled')",
      [jobId, accountId],
    );
    if (!job) throw new JobError('not_found', 'Job not available for retry.');
    return this.enqueue(accountId, job.input_id, 'retry:' + jobId, job.service, job.options);
  }

  async recent(accountId: string) {
    const { rows } = await this.pool.query<Pick<Job, 'id' | 'state' | 'service' | 'price'> & { downloadable: boolean }>(
      `SELECT jobs.id,jobs.state,jobs.service,jobs.price,
       (jobs.result IS NOT NULL AND inputs.expires_at>clock_timestamp()) AS downloadable
       FROM jobs JOIN inputs ON inputs.id=jobs.input_id
       WHERE jobs.account_id=$1 ORDER BY jobs.ready_at DESC,jobs.id DESC LIMIT 20`,
      [accountId]
    );
    return rows;
  }

  async purgeExpiredInputs() {
    return this.transaction(async client => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM inputs WHERE expires_at<=clock_timestamp() AND (content IS NOT NULL OR private_upload_id IS NOT NULL)
         ORDER BY expires_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`,
      );
      const ids = rows.map(row => row.id);
      if (!ids.length) return;
      await this.removeTerminalArtifacts(client, ids);
    }, true);
  }

  async deleteInput(accountId: string, jobId: string) {
    return this.transaction(async client => {
      await this.lockAccount(client, accountId);
      const { rows: [input] } = await client.query<{ id: string }>(
        `SELECT inputs.id FROM jobs JOIN inputs ON inputs.id=jobs.input_id
         WHERE jobs.id=$1 AND jobs.account_id=$2 FOR UPDATE OF inputs`, [jobId, accountId],
      );
      if (!input) return false;
      const { rowCount } = await client.query(
        "SELECT 1 FROM jobs WHERE input_id=$1 AND state IN ('queued','running')", [input.id],
      );
      if (rowCount) throw new JobError('conflict', 'Espera a que terminen los trabajos que usan este archivo.');
      await this.removeTerminalArtifacts(client, [input.id]);
      return true;
    }, true);
  }

  private async removeTerminalArtifacts(client: PoolClient, ids: string[]) {
    const external = await client.query<{ id: string; account_id: string; private_upload_id: string }>(
      `SELECT id,account_id,private_upload_id FROM inputs WHERE id=ANY($1::uuid[]) AND private_upload_id IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM jobs WHERE input_id=inputs.id AND state IN ('queued','running')) FOR UPDATE`, [ids]);
    for (const input of external.rows) {
      if (!this.files) throw new Error('Private storage unavailable for deletion.');
      await client.query("UPDATE private_uploads SET state='deleting' WHERE id=$1 AND account_id=$2 AND state<>'deleted'",
        [input.private_upload_id, input.account_id]);
    }
    const { rows } = await client.query<{ id: string }>(
      `UPDATE inputs SET content=NULL,private_upload_id=NULL,expires_at=LEAST(expires_at,clock_timestamp())
       WHERE id=ANY($1::uuid[]) AND (content IS NOT NULL OR private_upload_id IS NOT NULL) AND NOT EXISTS (
         SELECT 1 FROM jobs WHERE input_id=inputs.id AND state IN ('queued','running')
       ) RETURNING id`, [ids],
    );
    if (!rows.length) return;
    const removedIds = rows.map(row => row.id);
    await client.query('DELETE FROM subtitle_projects WHERE id=ANY($1::uuid[])', [removedIds]);
    await client.query(
      `UPDATE jobs SET result=NULL,original_result=NULL,artifacts_removed_at=clock_timestamp()
       WHERE input_id=ANY($1::uuid[])`, [removedIds],
    );
  }

  async claim(): Promise<Attempt | null> {
    await this.reapExpired();
    const { rows } = await this.pool.query<Attempt>(
      `WITH next_job AS (
         SELECT j.id FROM jobs j JOIN inputs i ON i.id=j.input_id AND i.account_id=j.account_id
         WHERE j.attempts<j.max_attempts AND j.state='queued' AND j.ready_at<=clock_timestamp()
           AND i.expires_at>clock_timestamp() AND (i.content IS NOT NULL OR i.private_upload_id IS NOT NULL)
         ORDER BY j.ready_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED
       )
       UPDATE jobs SET state='running', attempts=attempts+1, attempt_id=$1,
         lease_until=clock_timestamp()+interval '30 seconds'
       FROM next_job, inputs
       WHERE jobs.id=next_job.id AND inputs.id=jobs.input_id
       RETURNING jobs.*, inputs.content,inputs.private_upload_id`, [randomUUID()]
    );
    return rows[0] ?? null;
  }

  async renew(attempt: Attempt) {
    const { rowCount } = await this.pool.query(
      `UPDATE jobs SET lease_until=clock_timestamp()+interval '30 seconds'
       WHERE id=$1 AND state='running' AND attempt_id=$2 AND lease_until>clock_timestamp()`,
      [attempt.id, attempt.attempt_id]
    );
    return rowCount === 1;
  }

  async publish(attempt: Attempt, output: Buffer | JobArtifacts) {
    const artifacts = Buffer.isBuffer(output) ? { result: output } : output;
    return this.finish(attempt.account_id, attempt.id, 'succeeded', attempt.attempt_id, artifacts);
  }

  async fail(attempt: Attempt, retryable: boolean) {
    if (retryable && attempt.attempts < attempt.max_attempts) {
      const { rowCount } = await this.pool.query(
        `UPDATE jobs SET state='queued', attempt_id=NULL, lease_until=NULL,
           ready_at=clock_timestamp()+(power(2, attempts)*interval '1 second')
         WHERE id=$1 AND state='running' AND attempt_id=$2 AND lease_until>clock_timestamp()`,
        [attempt.id, attempt.attempt_id]
      );
      return rowCount === 1;
    }
    return this.finish(attempt.account_id, attempt.id, 'failed', attempt.attempt_id);
  }

  async cancel(accountId: string, jobId: string) {
    const cancelled = await this.finish(accountId, jobId, 'cancelled');
    if (cancelled) return true;
    const {rowCount} = await this.pool.query(
      `UPDATE jobs SET state='unknown',unknown_attempt_id=attempt_id,quarantined_at=clock_timestamp(),attempt_id=NULL,lease_until=NULL
       WHERE id=$1 AND account_id=$2 AND state='running'`,[jobId,accountId]);
    if (rowCount) this.activeAttempts.get(jobId)?.abort();
    return rowCount === 1;
  }

  /** Preserve the reservation until a trusted operator verifies the remote outcome. No HTTP route exposes this. */
  async quarantine(attempt: Attempt) {
    const { rowCount } = await this.pool.query(
      `UPDATE jobs SET state='unknown',unknown_attempt_id=attempt_id,quarantined_at=clock_timestamp(),attempt_id=NULL,lease_until=NULL
       WHERE id=$1 AND account_id=$2 AND state='running' AND attempt_id=$3`,
      [attempt.id, attempt.account_id, attempt.attempt_id]);
    return rowCount === 1;
  }

  /** Trusted reconciliation only, after verifying provider evidence. Not exposed through customer HTTP routes. */
  async reconcileUnknown(accountId: string, jobId: string, outcome: 'failed' | 'succeeded',
    evidence: string, artifacts?: JobArtifacts) {
    if (typeof evidence !== 'string' || !evidence.trim() || evidence.length > 500 ||
        !['failed','succeeded'].includes(outcome)) throw new JobError('invalid_input', 'Provider evidence is required.');
    if (outcome === 'succeeded' && (!artifacts || !Buffer.isBuffer(artifacts.result) ||
        artifacts.result.length < 1 || artifacts.result.length > 1048576 ||
        (artifacts.original !== undefined && (!Buffer.isBuffer(artifacts.original) || artifacts.original.length < 1 || artifacts.original.length > 65536)))) {
      throw new JobError('invalid_input', 'A valid reconciled result is required.');
    }
    return this.transaction(async client => {
      await this.lockAccount(client, accountId);
      await client.query('SELECT i.id FROM inputs i JOIN jobs j ON j.input_id=i.id WHERE j.id=$1 AND j.account_id=$2 FOR UPDATE OF i', [jobId,accountId]);
      await client.query('SELECT id FROM jobs WHERE id=$1 AND account_id=$2 FOR UPDATE', [jobId,accountId]);
      const {rows:[job]} = await client.query<{price:number;state:string}>(
        `WITH verified AS MATERIALIZED (
           SELECT ($3='succeeded' AND i.expires_at>clock_timestamp()) AS deliverable
           FROM inputs i JOIN jobs j ON j.input_id=i.id WHERE j.id=$1 AND j.account_id=$2
         ) UPDATE jobs SET state=CASE WHEN verified.deliverable THEN 'succeeded' ELSE 'failed' END,
           reconciliation_ref=$4,result=CASE WHEN verified.deliverable THEN $5::bytea ELSE NULL END,
           original_result=CASE WHEN verified.deliverable THEN $6::bytea ELSE NULL END FROM verified
         WHERE id=$1 AND account_id=$2 AND state='unknown'
         RETURNING price,jobs.state`, [jobId,accountId,outcome,evidence,outcome==='succeeded'?artifacts!.result:null,
          outcome==='succeeded'?artifacts!.original??null:null]);
      if (!job) return false;
      await client.query(job.state==='succeeded'
        ? 'UPDATE accounts SET reserved=reserved-$2,consumed=consumed+$2 WHERE id=$1'
        : 'UPDATE accounts SET reserved=reserved-$2,available=available+$2 WHERE id=$1', [accountId,job.price]);
      await this.record(client,job.state==='succeeded'?'capture':'release',jobId,accountId,job.price);
      return true;
    });
  }

  async reapExpired() {
    const { rows } = await this.pool.query<{ id: string; account_id: string }>(
      `SELECT j.id,j.account_id FROM jobs j JOIN inputs i ON i.id=j.input_id AND i.account_id=j.account_id
       WHERE j.state='queued' AND i.expires_at<=clock_timestamp() ORDER BY j.ready_at,j.id LIMIT 100`);
    let recovered = 0;
    for (const job of rows) if (await this.finish(job.account_id, job.id, 'failed')) recovered++;
    const { rowCount } = await this.pool.query(
      `UPDATE jobs SET state='unknown',unknown_attempt_id=attempt_id,quarantined_at=clock_timestamp(),attempt_id=NULL,lease_until=NULL
       WHERE state='running' AND lease_until<=clock_timestamp()`);
    return recovered + (rowCount ?? 0);
  }

  async runOnce() {
    const attempt = await this.claim();
    if (!attempt) return false;
    const controller = new AbortController();
    this.activeAttempts.set(attempt.id, controller);
    const heartbeat = setInterval(() => {
      void this.renew(attempt).then(renewed => {
        if (!renewed) controller.abort();
      }).catch(() => { controller.abort(); void this.quarantine(attempt).catch(() => undefined); });
    }, 10_000);
    try {
      let output: Buffer | JobArtifacts;
      try {
        const adapter = this.adapters.get(attempt.service);
        if (!adapter) throw new Error('The job adapter is unavailable.');
        const live = await this.pool.query('SELECT 1 FROM inputs WHERE id=$1 AND account_id=$2 AND expires_at>clock_timestamp() AND (content IS NOT NULL OR private_upload_id IS NOT NULL)',
          [attempt.input_id,attempt.account_id]);
        if (!live.rowCount) { await this.fail(attempt,false); return true; }
        if (attempt.private_upload_id) {
          if (!this.files || !adapter.executeFile) throw new Error('Private storage is unavailable.');
          output = await adapter.executeFile(await this.files.get(attempt.account_id, attempt.private_upload_id), attempt.options, attempt.id, controller.signal);
        } else output = await adapter.execute(attempt.content, attempt.options, attempt.id, controller.signal);
        const { result, original } = Buffer.isBuffer(output) ? { result: output, original: undefined } : output;
        if (result.length < 1 || result.length > 1048576) throw new Error('Invalid result size.');
        if (original && (original.length < 1 || original.length > 65536)) throw new Error('Invalid original subtitle size.');
      } catch (error) {
        if (controller.signal.aborted || error instanceof JobOutcomeUnknown) await this.quarantine(attempt);
        else await this.fail(attempt, error instanceof RetryableJobError);
        return true;
      }
      if (controller.signal.aborted) await this.quarantine(attempt);
      else await this.publish(attempt, output);
    } catch {
      // If persistence failed after the provider ran, preserve uncertainty instead of repeating the operation.
      await this.quarantine(attempt);
    } finally {
      clearInterval(heartbeat);
      this.activeAttempts.delete(attempt.id);
    }
    return true;
  }

  private async finish(accountId: string, jobId: string, state: 'succeeded' | 'failed' | 'cancelled',
    attemptId?: string, artifacts?: JobArtifacts) {
    return this.transaction(async client => {
      await this.lockAccount(client, accountId);
      // Finish all lock waits before evaluating expiration at the actual terminal update.
      await client.query(`SELECT 1 FROM inputs i JOIN jobs j ON j.input_id=i.id
        WHERE j.id=$1 AND j.account_id=$2 FOR UPDATE OF i`, [jobId, accountId]);
      await client.query('SELECT 1 FROM jobs WHERE id=$1 AND account_id=$2 FOR UPDATE', [jobId, accountId]);
      const { rows: [job] } = await client.query<{ price: number; state: string }>(
        `WITH terminal AS MATERIALIZED (
           SELECT CASE WHEN $3='succeeded' AND i.expires_at<=clock_timestamp() THEN 'failed' ELSE $3 END AS state
           FROM inputs i JOIN jobs j ON j.input_id=i.id WHERE j.id=$1 AND j.account_id=$2
         ) UPDATE jobs SET state=terminal.state,
           result=CASE WHEN terminal.state='succeeded' THEN $4::bytea ELSE NULL END,
           original_result=CASE WHEN terminal.state='succeeded' THEN $6::bytea ELSE NULL END,
           attempt_id=NULL,lease_until=NULL FROM terminal
         WHERE jobs.id=$1 AND account_id=$2 AND (
           ($3='cancelled' AND jobs.state='queued')
           OR (jobs.state='queued' AND $3='failed' AND $5::uuid IS NULL AND terminal.state='failed'
             AND EXISTS(SELECT 1 FROM inputs i WHERE i.id=jobs.input_id AND i.expires_at<=clock_timestamp()))
           OR (jobs.state='running' AND (
             ($5::uuid IS NOT NULL AND attempt_id=$5 AND lease_until>clock_timestamp())
             OR ($5::uuid IS NULL AND $3='failed' AND attempts=max_attempts AND lease_until<=clock_timestamp())
           ))
         )
         RETURNING price,jobs.state`, [jobId, accountId, state, artifacts?.result ?? null, attemptId ?? null, artifacts?.original ?? null]
      );
      if (!job) return false;
      const capture = job.state === 'succeeded';
      await client.query(
        capture
          ? 'UPDATE accounts SET reserved=reserved-$2, consumed=consumed+$2 WHERE id=$1'
          : 'UPDATE accounts SET reserved=reserved-$2, available=available+$2 WHERE id=$1',
        [accountId, job.price]
      );
      await this.record(client, capture ? 'capture' : 'release', jobId, accountId, job.price);
      return true;
    });
  }

  private async lockAccount(client: PoolClient, accountId: string) {
    const { rows: [row] } = await client.query<{ available: number }>(
      'SELECT available FROM accounts WHERE id=$1 FOR UPDATE', [accountId]
    );
    if (!row) throw new JobError('not_found', 'Account not found.');
    return row.available;
  }

  private async record(client: PoolClient, kind: string, reference: string, accountId: string, credits: number) {
    await client.query('INSERT INTO credit_movements(kind,reference,account_id,credits) VALUES ($1,$2,$3,$4)',
      [kind, reference, accountId, credits]);
  }

  private async transaction<T>(run: (client: PoolClient) => Promise<T>, drainDeletes = false): Promise<T> {
    const client = await this.pool.connect();
    let value: T;
    try {
      await client.query('BEGIN');
      value = await run(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (drainDeletes && this.files) {
      const cleanup = await this.files.purgeExpired();
      if (cleanup.failed) throw new Error('Private file cleanup is pending and will retry.');
    }
    return value;
  }
}
