import { describe, expect, it, vi } from 'vitest';
import { createPayPalSandbox } from './pilotPayments';

describe('PayPal Sandbox transport', () => {
  it('creates and captures through sandbox using separate stable request identifiers', async () => {
    const reference = 'c624c249-6103-4a94-94e5-15de72dc6f09';
    const responses = [
      { access_token: 'sandbox-fixture', expires_in: 300 },
      { id: 'PAYPAL-ORDER', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER' }] },
      { id: 'PAYPAL-ORDER', status: 'APPROVED' },
      { id: 'PAYPAL-ORDER', status: 'COMPLETED' },
    ];
    const send = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json(responses.shift()));
    const paypal = createPayPalSandbox('sandbox-client', 'sandbox-secret', 'merchant-fixture', send);
    const created = await paypal.createOrder(reference, 'http://127.0.0.1:3001/pilot/?payment=' + reference);
    expect(created.url).toBe('https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER');
    expect(await paypal.getOrder(created.id)).toMatchObject({ status: 'APPROVED' });
    await paypal.capture(created.id, 'c' + reference);
    expect(send.mock.calls.map(call => call[0])).toEqual([
      'https://api-m.sandbox.paypal.com/v1/oauth2/token',
      'https://api-m.sandbox.paypal.com/v2/checkout/orders',
      'https://api-m.sandbox.paypal.com/v2/checkout/orders/PAYPAL-ORDER',
      'https://api-m.sandbox.paypal.com/v2/checkout/orders/PAYPAL-ORDER/capture',
    ]);
    expect(send.mock.calls[1][1]?.headers).toMatchObject({ 'PayPal-Request-Id': 'o' + reference });
    expect(send.mock.calls[3][1]?.headers).toMatchObject({ 'PayPal-Request-Id': 'c' + reference });
    expect(JSON.parse(String(send.mock.calls[1][1]?.body))).toMatchObject({
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: reference, amount: { value: '4.95', currency_code: 'USD' } }],
    });
  });

  it('rejects a redirect outside the PayPal sandbox', async () => {
    const responses = [
      { access_token: 'sandbox-fixture' },
      { id: 'ORDER', links: [{ rel: 'approve', href: 'https://www.paypal.com/checkoutnow?token=ORDER' }] },
    ];
    const paypal = createPayPalSandbox('sandbox-client', 'sandbox-secret', 'merchant-fixture',
      async () => Response.json(responses.shift()));
    await expect(paypal.createOrder('local-order', 'http://127.0.0.1:3001/pilot/'))
      .rejects.toThrow('Unexpected PayPal Sandbox approval URL');
  });
});
