import { randomUUID } from 'node:crypto';

export const testPackage = { amount: 495, currency: 'usd', credits: 5 } as const;

interface PayPalAmount { value?: string; currency_code?: string }

export interface PayPalOrder {
  id?: string;
  status?: string;
  links?: { rel: string; href: string }[];
  purchase_units?: {
    reference_id?: string;
    amount?: PayPalAmount;
    payee?: { merchant_id?: string };
    payments?: { captures?: { id?: string; status?: string; amount?: PayPalAmount }[] };
  }[];
}

export interface PilotPayments {
  merchantId: string;
  createOrder(reference: string, returnUrl: string, amount?: number): Promise<{ id: string; url: string | null }>;
  getOrder(orderId: string): Promise<PayPalOrder>;
  capture(orderId: string, requestId: string): Promise<PayPalOrder>;
  simulateApproval?(orderId: string): void;
}

const api = 'https://api-m.sandbox.paypal.com';
const amountValue = (amount: number) => (amount / 100).toFixed(2);

export function createPayPalSandbox(clientId: string, secret: string, merchantId: string, send: typeof fetch = fetch): PilotPayments {
  let token: { value: string; expiresAt: number } | undefined;
  async function accessToken() {
    if (token && token.expiresAt > Date.now()) return token.value;
    const response = await send(api + '/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('PayPal Sandbox authentication failed.');
    const result = await response.json() as { access_token?: string; expires_in?: number };
    if (!result.access_token) throw new Error('PayPal Sandbox returned no access token.');
    token = { value: result.access_token, expiresAt: Date.now() + Math.max(0, (result.expires_in ?? 60) - 30) * 1000 };
    return token.value;
  }

  async function request(endpoint: string, body?: object, requestId?: string): Promise<PayPalOrder> {
    const response = await send(api + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: 'Bearer ' + await accessToken(),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401) token = undefined;
    if (!response.ok) throw new Error('PayPal Sandbox returned HTTP ' + response.status + '.');
    return await response.json() as PayPalOrder;
  }

  return {
    merchantId,
    async createOrder(reference, returnUrl, amount = testPackage.amount) {
      const order = await request('/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [{ reference_id: reference, amount: {
          currency_code: 'USD', value: amountValue(amount),
        } }],
        payment_source: { paypal: { experience_context: {
          return_url: returnUrl,
          cancel_url: new URL('/pilot/', returnUrl).href,
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
        } } },
      }, 'o' + reference);
      const link = order.links?.find(item => item.rel === 'payer-action' || item.rel === 'approve');
      if (!order.id || !link) throw new Error('PayPal did not return an approval URL.');
      const approval = new URL(link.href);
      if (approval.origin !== 'https://www.sandbox.paypal.com' || approval.username || approval.password) {
        throw new Error('Unexpected PayPal Sandbox approval URL.');
      }
      return { id: order.id, url: approval.href };
    },
    getOrder: id => request('/v2/checkout/orders/' + encodeURIComponent(id)),
    capture: (id, requestId) => request('/v2/checkout/orders/' + encodeURIComponent(id) + '/capture', {}, requestId),
  };
}

export function createSimulatedPayments(): PilotPayments {
  const merchantId = 'local-test-merchant';
  const orders = new Map<string, PayPalOrder>();
  const get = (id: string) => {
    const order = orders.get(id);
    if (!order) throw new Error('Simulated PayPal order not found.');
    return order;
  };
  return {
    merchantId,
    async createOrder(reference, _returnUrl, amount = testPackage.amount) {
      const id = 'sandbox-order-' + randomUUID();
      orders.set(id, {
        id, status: 'CREATED', purchase_units: [{ reference_id: reference, payee: { merchant_id: merchantId },
          amount: { value: amountValue(amount), currency_code: 'USD' } }],
      });
      return { id, url: null };
    },
    async getOrder(id) { return structuredClone(get(id)); },
    simulateApproval(id) {
      const order = get(id);
      if (order.status === 'CREATED') order.status = 'APPROVED';
    },
    async capture(id) {
      const order = get(id);
      if (order.status !== 'APPROVED' && order.status !== 'COMPLETED') throw new Error('Order not approved.');
      if (order.status === 'APPROVED') {
        order.status = 'COMPLETED';
        const unit = order.purchase_units![0];
        unit.payments = { captures: [{ id: 'capture-' + randomUUID(), status: 'COMPLETED', amount: unit.amount }] };
      }
      return structuredClone(order);
    },
  };
}

