const sandboxSdk = 'https://www.sandbox.paypal.com/web-sdk/v6/core';
let loadingSdk;

function loadSdk() {
  if (window.paypal?.createInstance) return Promise.resolve(window.paypal);
  loadingSdk ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => {
      clearTimeout(timeout);
      script.remove();
      reject(new Error('PayPal Sandbox SDK did not load.'));
    };
    const timeout = setTimeout(fail, 15_000);
    script.src = sandboxSdk;
    script.async = true;
    script.addEventListener('load', () => {
      if (!window.paypal?.createInstance) return fail();
      clearTimeout(timeout);
      resolve(window.paypal);
    }, { once: true });
    script.addEventListener('error', fail, { once: true });
    document.head.append(script);
  }).catch(error => {
    loadingSdk = undefined;
    throw error;
  });
  return loadingSdk;
}

export async function preparePayPalWeb(clientId) {
  const paypal = await loadSdk();
  const sdk = await paypal.createInstance({ clientId, components: ['paypal-payments'], pageType: 'checkout' });
  const methods = await sdk.findEligibleMethods({ currencyCode: 'USD' });
  if (!methods.isEligible('paypal')) throw new Error('PayPal Sandbox is not eligible.');
  return sdk;
}

export async function startPayPalWeb(sdk, createOrder, { onApprove, onCancel, onError, presentationMode = 'popup' }) {
  let localOrder;
  let opening = true;
  let openFailed = false;
  const session = sdk.createPayPalOneTimePaymentSession({
    async onApprove({ orderId }) {
      try {
        const created = await localOrder;
        if (orderId !== created.providerOrderId) throw new Error('PayPal Sandbox approved a different order.');
        await onApprove(created.id, orderId);
      } catch {
        onError();
      }
    },
    onCancel,
    onError() {
      if (opening) openFailed = true;
      else onError();
    },
  });
  localOrder = createOrder();
  const order = localOrder.then(({ providerOrderId }) => {
    if (!providerOrderId) throw new Error('PayPal Sandbox order ID is missing.');
    return { orderId: providerOrderId };
  });
  try {
    await session.start({ presentationMode }, order);
  } catch (error) {
    if (presentationMode !== 'popup' || !error?.isRecoverable) throw error;
    openFailed = false;
    await session.start({ presentationMode: 'modal' }, order);
  }
  opening = false;
  if (openFailed) onError();
}
