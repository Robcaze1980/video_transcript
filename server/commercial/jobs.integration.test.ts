import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestCheckout } from './checkout';
import { createSimulatedPayments } from './pilotPayments';
import { CommercialJobs, type JobAdapter, RetryableJobError } from './jobs';
import { pdfToCsv } from './pdfToCsv';
import { textPdf } from './testFixtures';

const connectionString = process.env.LINGUISTVISION_TEST_DATABASE_URL;
const schema = 'lv_test_' + randomUUID().replaceAll('-', '');
const adapter: JobAdapter = {
  key: 'test-subtitles:v1',
  price: 1,
  validate(input) {
    if (input.toString() === 'unsupported') throw new Error('Unsupported input');
  },
  async execute(input) {
    if (input.toString() === 'temporary') throw new RetryableJobError('Temporary provider failure');
    if (input.toString() === 'permanent') throw new Error('Invalid input for provider');
    return Buffer.from('1\n00:00:00,000 --> 00:00:01,000\n' + input.toString() + '\n');
  }
};

describe.skipIf(!connectionString)('commercial jobs with PostgreSQL', () => {
  let admin: Pool;
  let pool: Pool;
  let jobs: CommercialJobs;
  let account: string;
  let input: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString });
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new Pool({ connectionString, options: '-c search_path=' + schema });
    const ddl = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    await pool.query(ddl);
    jobs = new CommercialJobs(pool, new Map([[adapter.key, adapter], [pdfToCsv.key, pdfToCsv]]));
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE credit_movements, checkout_orders, purchases, jobs, subtitle_projects, subtitle_presets, pilot_language_requests, inputs, accounts');
    account = await jobs.createAccount();
    input = await jobs.addInput(account, Buffer.from('Prueba'));
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
      await admin.end();
    }
  });

  it('credits one confirmed purchase once, even concurrently', async () => {
    const results = await Promise.all([
      jobs.creditConfirmedPurchase(account, 'purchase-1', 1),
      jobs.creditConfirmedPurchase(account, 'purchase-1', 1)
    ]);
    expect(results.sort()).toEqual([false, true]);
    const other = await jobs.createAccount();
    await expect(jobs.creditConfirmedPurchase(other, 'purchase-1', 1)).rejects.toMatchObject({ code: 'conflict' });
    expect(await jobs.balance(account)).toEqual({ available: 1, reserved: 0, consumed: 0, credited: 1 });
    expect(await jobs.balance(other)).toMatchObject({ available: 0, credited: 0 });
  });

  it('expires a download immediately and removes its bytes while preserving the ledger', async () => {
    await jobs.creditConfirmedPurchase(account, 'retention-purchase', 2);
    const id = await jobs.enqueue(account, input, 'retention-job', adapter.key, {});
    await jobs.runOnce();
    expect((await jobs.result(account, id))?.result).not.toBeNull();
    await pool.query("UPDATE inputs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [input]);
    expect((await jobs.result(account, id))?.result).toBeNull();
    await jobs.purgeExpiredInputs();
    expect((await pool.query('SELECT content FROM inputs WHERE id=$1', [input])).rows).toEqual([{ content: null }]);
    expect((await pool.query('SELECT result FROM jobs WHERE id=$1', [id])).rows).toEqual([{ result: null }]);
    expect(await jobs.balance(account)).toEqual({ available: 1, reserved: 0, consumed: 1, credited: 2 });
  });

  it('limits uploads and active jobs per account without changing prior reservations', async () => {
    const other = await jobs.createAccount();
    await jobs.creditConfirmedPurchase(account, 'quota-purchase', 5);
    await pool.query(
      "INSERT INTO inputs(id,account_id,content) SELECT gen_random_uuid(),$1,decode(repeat('00',1048576),'hex') FROM generate_series(1,19)",
      [account],
    );
    await expect(jobs.addInput(account, Buffer.alloc(1048576))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(jobs.addInput(other, Buffer.alloc(1))).resolves.toEqual(expect.any(String));
    for (let index = 0; index < 3; index++) await jobs.enqueue(account, input, 'quota-' + index, adapter.key, {});
    await expect(jobs.enqueue(account, input, 'quota-over', adapter.key, {})).rejects.toMatchObject({ code: 'conflict' });
    expect(await jobs.balance(account)).toEqual({ available: 2, reserved: 3, consumed: 0, credited: 5 });
  });

  it('reconciles a completed PayPal capture once after a lost response', async () => {
    const payments = createSimulatedPayments();
    const checkout = new TestCheckout(pool, jobs, payments);
    const order = await checkout.createOrder(account, 'usd', 495, 5, 'http://127.0.0.1:3001');
    const { rows: [row] } = await pool.query('SELECT provider_order_id FROM checkout_orders WHERE id=$1', [order.id]);
    expect(await checkout.requestCapture(account, order.id, false, 'other-paypal-order')).toBe(false);
    expect(await checkout.requestCapture(account, order.id)).toBe(true);
    expect(await checkout.fulfillNext()).toBe(true);
    expect(await jobs.balance(account)).toMatchObject({ credited: 0 });
    const reset = () => pool.query('UPDATE checkout_orders SET next_attempt_at=clock_timestamp() WHERE id=$1', [order.id]);
    await reset();

    const capture = payments.capture;
    const captureCall = vi.spyOn(payments, 'capture').mockImplementationOnce(async (id, requestId) => {
      await capture(id, requestId);
      throw new Error('Connection lost after capture');
    });
    await checkout.requestCapture(account, order.id, true);
    await expect(checkout.fulfillNext()).rejects.toThrow('Connection lost after capture');
    expect(await jobs.balance(account)).toMatchObject({ credited: 0 });
    expect(captureCall).toHaveBeenCalledWith(row.provider_order_id, 'c' + order.id);
    expect(await checkout.status(account, order.id)).toBe('pending');
    await reset();

    const getOrder = payments.getOrder;
    const lookup = vi.spyOn(payments, 'getOrder');
    lookup.mockImplementationOnce(async id => {
      const changed = await getOrder(id);
      changed.purchase_units![0].payee = { merchant_id: 'other-merchant' };
      return changed;
    });
    await expect(checkout.fulfillNext()).rejects.toMatchObject({ code: 'conflict' });
    expect(await jobs.balance(account)).toMatchObject({ credited: 0 });
    await reset();
    lookup.mockImplementationOnce(async id => {
      const changed = await getOrder(id);
      changed.purchase_units![0].payments!.captures![0].amount = { value: '0.01', currency_code: 'USD' };
      return changed;
    });
    await expect(checkout.fulfillNext()).rejects.toMatchObject({ code: 'conflict' });
    expect(await jobs.balance(account)).toMatchObject({ credited: 0 });
    await reset();
    await Promise.all([checkout.fulfillNext(), checkout.fulfillNext()]);
    expect(await checkout.status(account, order.id)).toBe('credited');
    expect(await checkout.requestCapture(account, order.id, true)).toBe(true);
    expect(await checkout.fulfillNext()).toBe(false);
    expect(await jobs.balance(account)).toEqual({ available: 5, reserved: 0, consumed: 0, credited: 5 });
    expect(captureCall).toHaveBeenCalledTimes(1);
  });



  it('reserves only one credit concurrently and resolves duplicate requests before checking balance', async () => {
    await jobs.creditConfirmedPurchase(account, 'purchase-1', 1);
    const outcomes = await Promise.allSettled(['first', 'second'].map(key =>
      jobs.enqueue(account, input, key, adapter.key, { a: 1, b: 2 })
    ));
    expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    const index = outcomes.findIndex(x => x.status === 'fulfilled');
    expect(outcomes[1-index]).toMatchObject({ status: 'rejected', reason: { code: 'insufficient_credits' } });
    const request = ['first', 'second'][index];
    const expected = (outcomes[index] as PromiseFulfilledResult<string>).value;
    expect(await jobs.enqueue(account, input, request, adapter.key, { b: 2, a: 1 })).toBe(expected);
    await expect(jobs.enqueue(account, input, request, adapter.key, { a: 3 })).rejects.toMatchObject({ code: 'conflict' });
    expect(await jobs.balance(account)).toEqual({ available: 0, reserved: 1, consumed: 0, credited: 1 });
  });

  it('isolates inputs and results by account and completes the simulated adapter', async () => {
    const other = await jobs.createAccount();
    await jobs.creditConfirmedPurchase(account, 'purchase-1', 1);
    await expect(jobs.enqueue(other, input, 'private', adapter.key, {})).rejects.toMatchObject({ code: 'not_found' });
    const id = await jobs.enqueue(account, input, 'test', adapter.key, {});
    expect(await jobs.result(account, id)).toEqual({ state: 'queued', result: null, original: null });
    expect(await jobs.result(other, id)).toBeNull();
    expect(await jobs.cancel(other, id)).toBe(false);
    expect(await jobs.runOnce()).toBe(true);
    expect(await jobs.runOnce()).toBe(false);
    const output = await jobs.result(account, id);
    expect(output?.state).toBe('succeeded');
    expect(output?.result?.toString()).toBe('1\n00:00:00,000 --> 00:00:01,000\nPrueba\n');
    expect(await jobs.result(other, id)).toBeNull();
    expect(await jobs.balance(account)).toEqual({ available: 0, reserved: 0, consumed: 1, credited: 1 });
  });

  it('uses the same account, credits and queue for subtitles and a real text PDF', async () => {
    const other = await jobs.createAccount();
    const pdf = await jobs.addInput(account, textPdf());
    await jobs.creditConfirmedPurchase(account, 'purchase-1', 2);
    await expect(jobs.enqueue(account, input, 'wrong-format', pdfToCsv.key, {})).rejects.toThrow('Expected a PDF');
    expect(await jobs.balance(account)).toMatchObject({ available: 2, reserved: 0 });
    const srt = await jobs.enqueue(account, input, 'video', adapter.key, {});
    const csv = await jobs.enqueue(account, pdf, 'pdf', pdfToCsv.key, {});
    await Promise.all([jobs.runOnce(), jobs.runOnce()]);
    expect((await jobs.result(account, srt))?.result?.toString()).toContain('Prueba');
    expect((await jobs.result(account, csv))?.result?.toString()).toBe('page,text\r\n1,"\'=5, ""units"""\r\n');
    expect(await jobs.result(other, csv)).toBeNull();
    expect(await jobs.balance(account)).toEqual({ available: 0, reserved: 0, consumed: 2, credited: 2 });
  });

  it('prevents expired attempts from renewing or publishing before and after recovery', async () => {
    await jobs.creditConfirmedPurchase(account, 'purchase-1', 1);
    const id = await jobs.enqueue(account, input, 'test', adapter.key, {});
    const claims = await Promise.all([jobs.claim(), jobs.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const attempt = claims.find(x => x !== null)!;
    await pool.query("UPDATE jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [id]);
    expect(await jobs.renew(attempt)).toBe(false);
    expect(await jobs.publish(attempt, Buffer.from('stale'))).toBe(false);
    const next = (await jobs.claim())!;
    expect(next.attempt_id).not.toBe(attempt.attempt_id);
    expect(await jobs.publish(attempt, Buffer.from('stale'))).toBe(false);
    expect(await jobs.publish(next, Buffer.from('valid'))).toBe(true);
    expect(await jobs.publish(next, Buffer.from('repeated'))).toBe(false);
    expect((await jobs.result(account, id))?.result?.toString()).toBe('valid');
    expect(await jobs.balance(account)).toMatchObject({ reserved: 0, consumed: 1 });
  });

  it('retains the reservation on recoverable errors and releases it once when attempts are exhausted', async () => {
    const retryInput = await jobs.addInput(account, Buffer.from('temporary'));
    await jobs.creditConfirmedPurchase(account, 'purchase-1', 1);
    const id = await jobs.enqueue(account, retryInput, 'retry', adapter.key, {});
    expect(await jobs.runOnce()).toBe(true);
    expect(await jobs.runOnce()).toBe(false);
    expect(await jobs.balance(account)).toMatchObject({ reserved: 1 });
    await pool.query("UPDATE jobs SET ready_at=clock_timestamp()-interval '1 second' WHERE id=$1", [id]);
    expect(await jobs.runOnce()).toBe(true);
    await pool.query("UPDATE jobs SET ready_at=clock_timestamp()-interval '1 second' WHERE id=$1", [id]);
    const last = (await jobs.claim())!;
    expect(last.attempts).toBe(last.max_attempts);
    await pool.query("UPDATE jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [id]);
    expect((await Promise.all([jobs.reapExpired(), jobs.reapExpired()])).sort()).toEqual([0, 1]);
    expect(await jobs.result(account, id)).toEqual({ state: 'failed', result: null, original: null });
    expect(await jobs.balance(account)).toEqual({ available: 1, reserved: 0, consumed: 0, credited: 1 });
  });

  it('makes cancellation and publication mutually exclusive', async () => {
    await jobs.creditConfirmedPurchase(account, 'purchase-1', 1);
    const id = await jobs.enqueue(account, input, 'race', adapter.key, {});
    const attempt = (await jobs.claim())!;
    const [published, cancelled] = await Promise.all([
      jobs.publish(attempt, Buffer.from('result')), jobs.cancel(account, id)
    ]);
    expect(published).not.toBe(cancelled);
    const balance = await jobs.balance(account);
    expect(balance.reserved).toBe(0);
    expect(balance.available + balance.consumed).toBe(1);
    const { rows } = await pool.query("SELECT kind FROM credit_movements WHERE reference=$1 AND kind IN ('capture','release')", [id]);
    expect(rows).toEqual([{ kind: published ? 'capture' : 'release' }]);
  });
});
