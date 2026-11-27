// Pure pricing and payment-verification helpers (no I/O) so they can be unit tested.
export type Currency = 'KES' | 'USD';
export type Provider = 'pesapal' | 'paypal';

export const CURRENCIES: Currency[] = ['KES', 'USD'];

/** PayPal cannot settle KES; Pesapal can settle both when the merchant account allows it. */
export function currencyAllowed(provider: Provider, currency: Currency, pesapalCurrencies: Currency[] = ['KES']): boolean {
  if (provider === 'paypal') return currency === 'USD';
  return pesapalCurrencies.includes(currency);
}

/** Minor units: KES cents (KES x 100) and USD cents. */
export function planMinor(plan: { price_kes: number; price_usd_cents: number }, currency: Currency): number {
  const minor = currency === 'KES' ? plan.price_kes * 100 : plan.price_usd_cents;
  if (!Number.isSafeInteger(minor) || minor < 0) throw Error('Invalid price');
  return minor;
}

export function minorToMajorString(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw Error('Invalid amount');
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

export function formatMinor(minor: number, currency: Currency): string {
  const major = minor / 100;
  return new Intl.NumberFormat(currency === 'KES' ? 'en-KE' : 'en-US', {
    style: 'currency', currency, minimumFractionDigits: currency === 'KES' && minor % 100 === 0 ? 0 : 2,
  }).format(major);
}

/** True only when a provider-reported major-unit amount equals the expected minor-unit amount exactly. */
export function amountsMatch(expectedMinor: number, reportedMajor: unknown): boolean {
  const n = typeof reportedMajor === 'string' ? Number(reportedMajor) : reportedMajor;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return false;
  return Math.round(n * 100) === expectedMinor && Math.abs(n * 100 - expectedMinor) < 0.001;
}

export type Expected = { reference: string; minor: number; currency: Currency };

/** A PayPal order is only trusted when the capture itself is COMPLETED with the exact amount/currency/reference. */
export function paypalOrderVerified(order: any, expected: Expected): boolean {
  if (!order || order.status !== 'COMPLETED') return false;
  const unit = order.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  if (!unit || !capture || capture.status !== 'COMPLETED') return false;
  const ref = unit.custom_id ?? capture.custom_id;
  return ref === expected.reference
    && capture.amount?.currency_code === expected.currency
    && amountsMatch(expected.minor, capture.amount?.value);
}

/** Pesapal GetTransactionStatus: completed, same currency, same amount, same merchant reference. */
export function pesapalVerified(status: any, expected: Expected): boolean {
  if (!status) return false;
  const completed = status.status_code === 1 || String(status.payment_status_description || '').toLowerCase() === 'completed';
  return completed
    && String(status.currency || '').toUpperCase() === expected.currency
    && amountsMatch(expected.minor, status.amount)
    && String(status.merchant_reference || '') === expected.reference;
}
