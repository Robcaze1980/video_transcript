import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { JobError, type CommercialJobs } from './jobs';
import type { PayPalOrder, PilotPayments } from './pilotPayments';
import type { PreviewAttribution } from './previewAttribution';

interface CheckoutOrder {
  id: string;
  provider_order_id: string;
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
    entry?: PreviewAttribution) {
    const id = randomUUID();
    if (entry) {
      await this.pool.query(
        'INSERT INTO checkout_orders(id,account_id,currency,amount,credits,landing_locale,landing_source) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, accountId, currency, amount, credits, entry.locale, entry.source],
      );
    } else {
      await this.pool.query('INSERT INTO checkout_orders(id,account_id,currency,amount,credits) VALUES ($1,$2,$3,$4,$5)',
        [id, accountId, currency, amount, credits]);
    }
    const payment = await this.payments.createOrder(id, origin + '/pilot/?payment=' + id, amount);
    await this.pool.query('UPDATE checkout_orders SET provider_order_id=$2 WHERE id=$1', [id, payment.id]);
    return { id, url: payment.url, providerOrderId: payment.id };
  }

  async status(accountId: string, orderId: string) {
    const { rows: [order] } = await this.pool.query<{ status: string }>(
      `SELECT CASE WHEN fulfilled_at IS NOT NULL THEN 'credited'
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

  async fulfillNext() {
    const { rows: [order] } = await this.pool.query<CheckoutOrder>(
      `WITH next_order AS (
         SELECT id FROM checkout_orders WHERE fulfilled_at IS NULL AND next_attempt_at<=clock_timestamp()
         ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       UPDATE checkout_orders AS pending SET next_attempt_at=clock_timestamp()+interval '90 seconds'
       FROM next_order WHERE pending.id=next_order.id
       RETURNING pending.id,pending.provider_order_id,pending.amount,pending.currency`
    );
    if (!order) return false;
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

