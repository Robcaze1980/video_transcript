import { createHash, randomUUID } from 'node:crypto';
import { Firestore, type DocumentReference, type Transaction } from 'firebase-admin/firestore';

// Exploration only: deliberately not wired to HTTP, Firebase Auth, payments or workers.
const projectId = 'demo-vistavo-ledger';
const emulator = '127.0.0.1:8185';
const localOnly = Symbol('local-ledger-factory');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
type State = 'queued' | 'running' | 'unknown' | 'succeeded' | 'failed' | 'cancelled';
type Balance = { credited: number; available: number; reserved: number; consumed: number; active: number };
type Job = { accountId: string; inputId: string; price: number; state: State; inputSha256: string;
  attemptId: string | null; leaseUntil: number | null; unknownAttemptId: string | null; requestKey: string;
  quarantinedAtMs?: number; reconciliationRef?: string | null };
type Input = { accountId: string; expiresAtMs: number; sha256: string; deleted: boolean; unknownCount: number };
export class LedgerFault extends Error {
  constructor(readonly code: 'invalid' | 'conflict' | 'not_found' | 'insufficient' | 'invariant') { super(code); }
}
function integer(value: number, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw new LedgerFault('invalid');
}
function identifier(value: string) { if (!uuid.test(value)) throw new LedgerFault('invalid'); }
function text(value: string) { if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new LedgerFault('invalid'); }
function balance(value: Balance): Balance {
  for (const field of ['credited','available','reserved','consumed','active'] as const) integer(value[field]);
  if (value.credited !== value.available + value.reserved + value.consumed) throw new LedgerFault('invariant');
  return value;
}
interface Context { accountRef: DocumentReference; jobRef: DocumentReference; inputRef: DocumentReference;
  terminalRef: DocumentReference; account: Balance; job: Job; input: Input; terminalExists: boolean }

class ExperimentalFirestoreLedger {
  constructor(private readonly db: Firestore, private readonly root: DocumentReference, seal: symbol) {
    if (seal !== localOnly || process.env.FIRESTORE_EMULATOR_HOST !== emulator) throw new LedgerFault('invalid');
  }
  private ref(collection: string, id: string) { return this.root.collection(collection).doc(id); }
  async createAccount() {
    const id = randomUUID();
    await this.ref('accounts', id).create({ credited: 0, available: 0, reserved: 0, consumed: 0, active: 0 });
    return id;
  }
  async readBalance(accountId: string) {
    identifier(accountId); const doc = await this.ref('accounts', accountId).get();
    if (!doc.exists) throw new LedgerFault('not_found');
    return balance(doc.data() as Balance);
  }
  /** Caller must have verified the provider capture. No provider IO occurs here. */
  async creditVerifiedPurchase(accountId: string, captureId: string, credits: number, amountCents: number, merchantId = 'synthetic') {
    identifier(accountId); text(captureId); text(merchantId); integer(credits, true); integer(amountCents, true);
    const receiptId = hash(['paypal:sandbox', captureId]);
    const fingerprint = hash([accountId, captureId, credits, amountCents, 'usd', merchantId]);
    return this.db.runTransaction(async tx => {
      const a = this.ref('accounts', accountId), p = this.ref('purchases', receiptId), m = this.ref('movements', 'credit:' + receiptId);
      const [account, prior, movement] = await tx.getAll(a, p, m);
      if (!account.exists) throw new LedgerFault('not_found');
      if (prior.exists) { if (prior.get('fingerprint') !== fingerprint) throw new LedgerFault('conflict'); return false; }
      if (movement.exists) throw new LedgerFault('invariant');
      const current = balance(account.data() as Balance);
      const next = balance({ ...current, available: current.available + credits, credited: current.credited + credits });
      tx.update(a, next); tx.create(p, { accountId, fingerprint, captureId, credits, amountCents, currency: 'usd', merchantId });
      tx.create(m, { accountId, kind: 'credit', credits, reference: receiptId }); return true;
    });
  }
  async addInput(accountId: string, expiresAtMs: number, sha256: string) {
    identifier(accountId); integer(expiresAtMs, true);
    if (expiresAtMs <= Date.now() || !/^[a-f0-9]{64}$/.test(sha256)) throw new LedgerFault('invalid');
    const id = randomUUID();
    await this.db.runTransaction(async tx => {
      if (!(await tx.get(this.ref('accounts', accountId))).exists) throw new LedgerFault('not_found');
      tx.create(this.ref('inputs', id), { accountId, expiresAtMs, sha256, deleted: false, unknownCount: 0 });
    }); return id;
  }
  async reserve(accountId: string, inputId: string, requestKey: string, price: number) {
    identifier(accountId); identifier(inputId); text(requestKey); integer(price, true);
    const jobId = randomUUID(), requestId = hash([accountId, requestKey]);
    const fingerprint = hash([inputId, price, 'synthetic:v1']);
    return this.db.runTransaction(async tx => {
      const a = this.ref('accounts', accountId), i = this.ref('inputs', inputId), r = this.ref('requests', requestId);
      const [account, input, prior] = await tx.getAll(a, i, r);
      if (!account.exists || !input.exists || input.get('accountId') !== accountId) throw new LedgerFault('not_found');
      if (prior.exists) { if (prior.get('fingerprint') !== fingerprint) throw new LedgerFault('conflict'); return prior.get('jobId') as string; }
      const asset = input.data() as Input;
      if (asset.deleted || asset.expiresAtMs <= Date.now()) throw new LedgerFault('not_found');
      if (asset.unknownCount > 0) throw new LedgerFault('conflict');
      const current = balance(account.data() as Balance);
      if (current.available < price) throw new LedgerFault('insufficient');
      if (current.active >= 3) throw new LedgerFault('conflict');
      const next = balance({ ...current, available: current.available - price, reserved: current.reserved + price, active: current.active + 1 });
      const job: Job = { accountId, inputId, price, state: 'queued', inputSha256: asset.sha256,
        attemptId: null, leaseUntil: null, unknownAttemptId: null, requestKey };
      tx.update(a, next); tx.create(r, { accountId, fingerprint, jobId }); tx.create(this.ref('jobs', jobId), job);
      tx.create(this.ref('movements', 'reserve:' + jobId), { accountId, kind: 'reserve', credits: price, reference: jobId });
      return jobId;
    });
  }
  private async context(tx: Transaction, accountId: string, jobId: string): Promise<Context> {
    identifier(accountId); identifier(jobId);
    const jobRef = this.ref('jobs', jobId), jobDoc = await tx.get(jobRef);
    if (!jobDoc.exists || jobDoc.get('accountId') !== accountId) throw new LedgerFault('not_found');
    const job = jobDoc.data() as Job;
    const accountRef = this.ref('accounts', accountId), inputRef = this.ref('inputs', job.inputId), terminalRef = this.ref('movements', 'terminal:' + jobId);
    const [account, input, terminal] = await tx.getAll(accountRef, inputRef, terminalRef);
    if (!account.exists || !input.exists || input.get('accountId') !== accountId) throw new LedgerFault('not_found');
    const asset = input.data() as Input; integer(asset.unknownCount); integer(job.price, true);
    return { accountRef, jobRef, inputRef, terminalRef, account: balance(account.data() as Balance),
      job, input: asset, terminalExists: terminal.exists };
  }
  private settle(tx: Transaction, c: Context, state: 'succeeded' | 'failed' | 'cancelled', evidence: string | null = null) {
    if (c.terminalExists) throw new LedgerFault('invariant');
    const capture = state === 'succeeded', price = c.job.price;
    const next = balance({ ...c.account, reserved: c.account.reserved - price,
      available: c.account.available + (capture ? 0 : price), consumed: c.account.consumed + (capture ? price : 0), active: c.account.active - 1 });
    const unknownCount = c.input.unknownCount - (c.job.state === 'unknown' ? 1 : 0); integer(unknownCount);
    tx.update(c.accountRef, next); tx.update(c.jobRef, { state, attemptId: null, leaseUntil: null, reconciliationRef: evidence });
    tx.update(c.inputRef, { unknownCount });
    tx.create(c.terminalRef, { accountId: c.job.accountId, reference: c.jobRef.id, credits: price, kind: capture ? 'capture' : 'release' });
  }
  private unknown(tx: Transaction, c: Context) {
    tx.update(c.jobRef, { state: 'unknown', unknownAttemptId: c.job.attemptId, quarantinedAtMs: Date.now(), attemptId: null, leaseUntil: null });
    tx.update(c.inputRef, { unknownCount: c.input.unknownCount + 1 });
  }
  async claim(accountId: string, jobId: string) {
    const attemptId = randomUUID();
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId);
      if (c.job.state !== 'queued') return null;
      if (c.input.deleted || c.input.expiresAtMs <= Date.now()) { this.settle(tx, c, 'failed'); return null; }
      if (c.input.unknownCount > 0) return null;
      const leaseUntil = Date.now() + 30_000;
      tx.update(c.jobRef, { state: 'running', attemptId, leaseUntil }); return { attemptId, leaseUntil };
    });
  }
  async quarantine(accountId: string, jobId: string, attemptId: string) {
    identifier(attemptId);
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId);
      if (c.job.state !== 'running' || c.job.attemptId !== attemptId) return false;
      this.unknown(tx, c); return true;
    });
  }
  async finish(accountId: string, jobId: string, attemptId: string, success: boolean) {
    identifier(attemptId); if (typeof success !== 'boolean') throw new LedgerFault('invalid');
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId);
      if (c.job.state !== 'running' || c.job.attemptId !== attemptId) return false;
      if (!c.job.leaseUntil || c.job.leaseUntil <= Date.now()) { this.unknown(tx, c); return false; }
      this.settle(tx, c, success && !c.input.deleted && c.input.expiresAtMs > Date.now() ? 'succeeded' : 'failed'); return true;
    });
  }
  async cancel(accountId: string, jobId: string) {
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId);
      if (c.job.state === 'queued') { this.settle(tx, c, 'cancelled'); return true; }
      if (c.job.state === 'running') { this.unknown(tx, c); return true; }
      return false;
    });
  }
  /** Internal experiment: evidence is synthetic; not a customer or provider-verification API. */
  async reconcile(accountId: string, jobId: string, outcome: 'failed' | 'succeeded', evidence: string) {
    if (!['failed','succeeded'].includes(outcome) || typeof evidence !== 'string' || !evidence.trim() || evidence.length > 500) throw new LedgerFault('invalid');
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId);
      if (c.job.state !== 'unknown') return false;
      this.settle(tx, c, outcome === 'succeeded' && !c.input.deleted && c.input.expiresAtMs > Date.now() ? 'succeeded' : 'failed', evidence); return true;
    });
  }
  async job(accountId: string, jobId: string) {
    identifier(accountId); identifier(jobId); const doc = await this.ref('jobs', jobId).get();
    if (!doc.exists || doc.get('accountId') !== accountId) throw new LedgerFault('not_found'); return doc.data() as Job;
  }
}
export function createLocalFirestoreLedger(namespace = randomUUID()) {
  if (process.env.FIRESTORE_EMULATOR_HOST !== emulator || !uuid.test(namespace)) throw new LedgerFault('invalid');
  const db = new Firestore({ projectId, host: emulator, ssl: false });
  const root = db.collection('vistavo_ledger_prototype').doc(namespace);
  return { ledger: new ExperimentalFirestoreLedger(db, root, localOnly), db, root, projectId,
    close: async () => { await db.recursiveDelete(root); await db.terminate(); } };
}
