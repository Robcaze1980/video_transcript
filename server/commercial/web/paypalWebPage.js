import { formatVideoPackage, pilotLocale } from './pilotLocales.js';
import { preparePayPalWeb, startPayPalWeb } from './paypalWebCheckout.js';

const params = new URLSearchParams(location.search);
const locale = pilotLocale(params.get('lang'));
const presentationMode = params.get('presentation') === 'modal' ? 'modal' : 'popup';
const t = locale.text;
document.documentElement.lang = locale.tag;
document.documentElement.dir = locale.dir;
const checkout = document.getElementById('checkout');
const status = key => { document.getElementById('message').textContent = key ? t(key) : ''; };
const allowRetry = key => {
  status(key);
  checkout.disabled = false;
};
const returnLink = document.getElementById('return-link');
returnLink.href = '../?lang=' + encodeURIComponent(locale.id);
returnLink.textContent = t('paypalWebBack');
checkout.textContent = t('paypalWebContinue');
document.getElementById('payment-details').textContent = t('paypalWebDetails');

async function checkoutApi(path, method, body) {
  const response = await fetch('../api/checkout' + path, method === 'POST' ? {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
  } : undefined);
  if (!response.ok) { const error = new Error('PayPal Sandbox request failed.'); error.status = response.status; throw error; }
  return response.json();
}

async function prepare() {
  status('paypalWebPreparing');
  try {
    const { clientId, packages } = await checkoutApi('/browser-config', 'GET');
    const pack = packages?.find(item => item.id === params.get('package'));
    if (packages && !pack) throw new Error('Invalid package.');
    if (pack) document.getElementById('payment-details').textContent = formatVideoPackage(locale.tag, pack);
    const sdk = await preparePayPalWeb(clientId);
    checkout.addEventListener('click', async () => {
      checkout.disabled = true;
      status('');
      try {
        await startPayPalWeb(sdk, async () => {
          const storageKey = 'vistavo-pending-checkout:' + (pack?.id ?? 'pilot');
          const prior = sessionStorage.getItem(storageKey);
          const requestKeyName=storageKey+':request';
          let requestKey=sessionStorage.getItem(requestKeyName);
          if(!requestKey){requestKey=crypto.randomUUID();sessionStorage.setItem(requestKeyName,requestKey);}
          const intent = prior ? {id:prior,pending:true} : await checkoutApi('', 'POST', { packageId: pack?.id,requestKey });
          if (!intent.pending) return intent;
          status('paymentPending');
          // Keep the original local intent across recoverable failures and button retries.
          sessionStorage.setItem(storageKey, intent.id);
          for (let attempt = 0; attempt < 24; attempt++) {
            let recovered;
            try { recovered = await checkoutApi('/' + intent.id, 'GET'); }
            catch (error) { if (error.status === 404) sessionStorage.removeItem(storageKey); throw error; }
            if (recovered.providerOrderId) {
              sessionStorage.removeItem(storageKey);
              return { ...intent, providerOrderId: recovered.providerOrderId };
            }
            if (recovered.status === 'unknown') break;
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          throw new Error('Checkout creation remains pending.');
        }, {
          presentationMode,
          onApprove(payment, token) {
            const key='vistavo-pending-checkout:'+(pack?.id??'pilot');sessionStorage.removeItem(key);
            sessionStorage.setItem('vistavo-checkout-id:'+payment,key+':request');
            location.assign('../?' + new URLSearchParams({ lang: locale.id, payment, token }));
          },
          onCancel: () => allowRetry('paypalWebCancelled'),
          onError: () => allowRetry('paypalWebFailed'),
        });
      } catch {
        allowRetry('paypalWebFailed');
      }
    });
    status('');
    checkout.disabled = false;
  } catch {
    status('paypalWebFailed');
  }
}

void prepare();
