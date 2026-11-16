import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { JobError, type CommercialJobs } from './jobs';
import type { PayPalOrder, PilotPayments } from './pilotPayments';
import type { PreviewAttribution } from './previewAttribution';

interface CheckoutOrder {
  id: string;
  provider_order_id: string | null;
  create_return_url: string;
  create_started_at: Date;
  create_lease: string;
  capture_requested_at?: Date | null;
  amount: number;
  currency: string;
}

const asCents = (value?: string) => {
  if (!value || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
};

export class TestCheckout {
  constructor(private readonly pool: Pool, private readonly jobs: CommercialJobs, private readonly payments: PilotPayments) {}

  async createOrder(accountId: string, currency: string, amount: number, credits: number, origin: string,
    entry?: PreviewAttribution, requestKey?: string) {
    const id = randomUUID();
    const key = requestKey ?? id;
    if (!/^[a-zA-Z0-9:_-]{1,200}$/.test(key)) throw new JobError('invalid_input','Invalid checkout request key.');
    const lease = randomUUID();
    const returnUrl = origin + '/pilot/?payment=' + id;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[accountId]);
      const {rows:[prior]} = await client.query<{id:string;currency:string;amount:number;credits:number;create_return_url:string;approval_url:string|null;provider_order_id:string|null}>(
        'SELECT id,currency,amount,credits,create_return_url,approval_url,provider_order_id FROM checkout_orders WHERE account_id=$1 AND create_request_key=$2',[accountId,key]);
      if (prior) {
        if (prior.currency!==currency || prior.amount!==amount || prior.credits!==credits || prior.create_return_url!==origin+'/pilot/?payment='+prior.id)
          throw new JobError('conflict','Checkout request key payload mismatch.');
        await client.query('COMMIT');
        return {id:prior.id,url:prior.approval_url,providerOrderId:prior.provider_order_id,pending:!prior.provider_order_id};
      }
    if (entry) {
      await client.query(
        `INSERT INTO checkout_orders(id,account_id,currency,amount,credits,landing_locale,landing_source,create_request_key,create_return_url,create_started_at,create_lease,next_attempt_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp(),$10,clock_timestamp()+interval '90 seconds')`,
        [id, accountId, currency, amount, credits, entry.locale, entry.source, key, returnUrl, lease],
      );
    } else {
      await client.query(`INSERT INTO checkout_orders(id,account_id,currency,amount,credits,create_request_key,create_return_url,create_started_at,create_lease,next_attempt_at) VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),$8,clock_timestamp()+interval '90 seconds')`,
        [id, accountId, currency, amount, credits, key, returnUrl, lease]);
    }

      await client.query('COMMIT');
    } catch(error) {await client.query('ROLLBACK');throw error;}
    finally {client.release();}
    try {
      const payment = await this.recoverCreation({ id, provider_order_id: null, amount, currency,
        create_return_url: returnUrl, create_started_at: new Date(), create_lease: lease });
      return { id, url: payment?.url ?? null, providerOrderId: payment?.id ?? null, pending: !payment };
    } catch {
      // The browser keeps the durable intent id; recovery reuses the original provider request id.
      await this.pool.query("UPDATE checkout_orders SET next_attempt_at=clock_timestamp()+interval '1 second' WHERE id=$1 AND provider_order_id IS NULL AND create_lease=$2",[id,lease]).catch(()=>undefined);
      return { id, url: null, providerOrderId: null, pending: true };
    }
  }

  async status(accountId: string, orderId: string) {
    const { rows: [order] } = await this.pool.query<{ status: string }>(
      `SELECT CASE WHEN fulfilled_at IS NOT NULL THEN 'credited'
         WHEN provider_order_id IS NULL AND (create_started_at IS NULL OR create_return_url IS NULL) THEN 'unknown'
         WHEN provider_order_id IS NULL AND create_started_at IS NOT NULL AND create_started_at<=clock_timestamp()-interval '5 hours' THEN 'unknown'
         WHEN provider_order_id IS NULL THEN 'creating'
         WHEN capture_requested_at IS NOT NULL THEN 'pending' ELSE 'approval' END AS status
       FROM checkout_orders WHERE account_id=$1 AND id=$2`, [accountId, orderId]
    );
    return order?.status ?? null;
  }

  async requestCapture(accountId: string, orderId: string, simulate = false, returnToken?: string) {
    const { rows: [order] } = await this.pool.query<{ provider_order_id: string; fulfilled_at: Date | null }>(
      'SELECT provider_order_id,fulfilled_at FROM checkout_orders WHERE account_id=$1 AND id=$2',
      [accountId, orderId]
    );
    if (!order?.provider_order_id || (returnToken !== undefined && returnToken !== order.provider_order_id)) return false;
    if (order.fulfilled_at) return true;
    if (simulate) this.payments.simulateApproval?.(order.provider_order_id);
    await this.pool.query(
      `UPDATE checkout_orders SET capture_requested_at=COALESCE(capture_requested_at,clock_timestamp()),
       next_attempt_at=COALESCE(next_attempt_at,clock_timestamp())
       WHERE id=$1 AND account_id=$2 AND fulfilled_at IS NULL`, [orderId, accountId]
    );
    return true;
  }

  async approval(accountId: string, orderId: string) {
    const {rows:[row]} = await this.pool.query<{url:string|null;providerOrderId:string|null}>(
      'SELECT approval_url AS url,provider_order_id AS "providerOrderId" FROM checkout_orders WHERE id=$1 AND account_id=$2', [orderId,accountId]);
    return row;
  }

  private async recoverCreation(order: CheckoutOrder) {
    // PayPal retains request ids for 6h; stop replay before that window expires (5h safety margin).
    if (!order.create_return_url || !order.create_started_at || Date.now()-order.create_started_at.getTime() >= 5*60*60*1000) return;
    const payment = await this.payments.createOrder(order.id, order.create_return_url, order.amount);
    if (typeof payment.id!=='string' || !payment.id) throw new Error('Missing provider order identifier.');
    const {rowCount} = await this.pool.query(
      `UPDATE checkout_orders SET provider_order_id=$2,approval_url=$3,create_lease=NULL,next_attempt_at=NULL
       WHERE id=$1 AND provider_order_id IS NULL AND create_lease=$4
         AND create_started_at>clock_timestamp()-interval '5 hours'`, [order.id,payment.id,payment.url,order.create_lease]);
    return rowCount === 1 ? payment : undefined;
  }

  async fulfillNext() {
    const { rows: [order] } = await this.pool.query<CheckoutOrder>(
      `WITH next_order AS (
         SELECT id FROM checkout_orders WHERE fulfilled_at IS NULL AND next_attempt_at<=clock_timestamp()
           AND (provider_order_id IS NOT NULL OR (create_return_url IS NOT NULL AND create_started_at>clock_timestamp()-interval '5 hours'))
         ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       UPDATE checkout_orders AS pending SET next_attempt_at=clock_timestamp()+interval '90 seconds',
         create_lease=CASE WHEN provider_order_id IS NULL THEN $1::uuid ELSE create_lease END
       FROM next_order WHERE pending.id=next_order.id
       RETURNING pending.id,pending.provider_order_id,pending.amount,pending.currency,pending.create_return_url,pending.create_started_at,pending.create_lease,pending.capture_requested_at`, [randomUUID()]
    );
    if (!order) return false;
    if (!order.provider_order_id) { await this.recoverCreation(order); return true; }
    if (!order.capture_requested_at) {
      await this.pool.query('UPDATE checkout_orders SET next_attempt_at=NULL WHERE id=$1 AND capture_requested_at IS NULL',[order.id]);
      return true;
    }
    let payment = await this.payments.getOrder(order.provider_order_id);
    this.checkOrder(order, payment);
    if (payment.status === 'APPROVED' && !payment.purchase_units?.[0]?.payments?.captures?.length) {
      payment = await this.payments.capture(order.provider_order_id, 'c' + order.id);
      this.checkOrder(order, payment);
    }
    const captures = payment.purchase_units?.[0]?.payments?.captures;
    const capture = captures?.[0];
    if (payment.status === 'COMPLETED' && captures?.length === 1 && capture?.status === 'COMPLETED' && capture.id) {
      await this.jobs.applyCompletedCapture(order.id, {
        orderId: order.provider_order_id, reference: order.id, captureId: capture.id,
        amount: asCents(capture.amount?.value) ?? -1, currency: capture.amount?.currency_code?.toLowerCase() ?? '',
      });
    }
    return true;
  }

  private checkOrder(order: CheckoutOrder, payment: PayPalOrder) {
    const unit = payment.purchase_units?.[0];
    if (payment.id !== order.provider_order_id || payment.purchase_units?.length !== 1 ||
        unit?.reference_id !== order.id || unit.payee?.merchant_id !== this.payments.merchantId ||
        asCents(unit.amount?.value) !== order.amount ||
        unit.amount?.currency_code?.toLowerCase() !== order.currency) {
      throw new JobError('conflict', 'PayPal order does not match the checkout order.');
    }
  }
}

