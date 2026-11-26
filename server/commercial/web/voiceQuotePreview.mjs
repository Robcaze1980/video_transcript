const CENTS_PER_MINUTE = 10;
const MAX_SOURCE_MS = 10 * 60 * 1_000;
const usd = cents => `US$${(cents / 100).toFixed(2)}`;

export function estimateVoiceQuote(durationMs, includeVoice) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > MAX_SOURCE_MS || typeof includeVoice !== 'boolean') {
    throw new RangeError('Invalid preview selection');
  }
  const sourceSeconds = Math.ceil(durationMs / 1_000);
  // Use integer half-up rounding for each service before adding the amounts.
  const serviceCents = Math.floor((sourceSeconds * CENTS_PER_MINUTE + 30) / 60);
  const voiceCents = includeVoice ? serviceCents : 0;
  return { textCents: serviceCents, voiceCents, totalCents: serviceCents + voiceCents };
}

if (typeof document !== 'undefined') {
  const duration = document.getElementById('duration');
  const textOnly = document.getElementById('text-only');
  const withVoice = document.getElementById('with-voice');
  const textPrice = document.getElementById('text-price');
  const voicePrice = document.getElementById('voice-price');
  const totalPrice = document.getElementById('total-price');

  document.getElementById('text-rate').textContent = `${usd(CENTS_PER_MINUTE)}/min`;
  document.getElementById('voice-rate').textContent = `+ ${usd(CENTS_PER_MINUTE)}/min`;
  duration.value = '130000';
  textOnly.checked = true;

  function render() {
    const quote = estimateVoiceQuote(Number(duration.value), withVoice.checked);
    textPrice.textContent = usd(quote.textCents);
    voicePrice.textContent = withVoice.checked ? usd(quote.voiceCents) : 'Sin añadir';
    totalPrice.textContent = usd(quote.totalCents);
  }

  duration.addEventListener('change', render);
  textOnly.addEventListener('change', render);
  withVoice.addEventListener('change', render);
  render();
}
