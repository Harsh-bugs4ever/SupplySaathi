import type { CandidateProduct, Costing, MoneyAmount } from './types';

/**
 * Quantity and cost arithmetic.
 *
 * Every number a user sees on a comparison card is produced here, in code.
 * The language model never does arithmetic: it is good at reading "sold in
 * packs of 25" off a page and bad at multiplying that by a price reliably.
 *
 * The rules this file exists to enforce:
 *
 *   - Missing shipping is NOT zero. A subtotal without shipping is a subtotal,
 *     never a total.
 *   - Pack sizes round UP. You cannot buy 0.4 of a pack.
 *   - Minimum order quantities and order increments raise the pack count, and
 *     the extra units are surfaced as overage rather than hidden.
 *   - Two prices in different currencies are not comparable, and we refuse to
 *     pretend otherwise.
 */

export interface CostingInput {
  requiredUnits: number;
  unitsPerPack: number | null;
  pricePerPack: MoneyAmount | null;
  minOrderPacks: number | null;
  orderIncrementPacks: number | null;
  shippingInfo: string | null;
  taxInfo?: string | null;
}

/**
 * Returns null when the inputs cannot support any honest calculation — i.e.
 * when pack size or price is unknown. A card in that state shows "unknown",
 * not a zero.
 */
export function computeCosting(input: CostingInput): Costing | null {
  const { requiredUnits, unitsPerPack, pricePerPack } = input;

  if (!unitsPerPack || unitsPerPack <= 0) return null;
  if (!pricePerPack || !Number.isFinite(pricePerPack.amount)) return null;
  if (!requiredUnits || requiredUnits <= 0) return null;

  const notes: string[] = [];

  // 1. How many packs cover the requirement?
  const packsBeforeMinimums = Math.ceil(requiredUnits / unitsPerPack);
  let packsNeeded = packsBeforeMinimums;

  // 2. Raise to the supplier's minimum order.
  let minOrderApplied = false;
  if (input.minOrderPacks && input.minOrderPacks > packsNeeded) {
    notes.push(
      `Supplier minimum order is ${input.minOrderPacks} packs; you only need ${packsBeforeMinimums}.`,
    );
    packsNeeded = input.minOrderPacks;
    minOrderApplied = true;
  }

  // 3. Round up to the next valid order increment.
  let incrementApplied = false;
  const increment = input.orderIncrementPacks;
  if (increment && increment > 1 && packsNeeded % increment !== 0) {
    const rounded = Math.ceil(packsNeeded / increment) * increment;
    notes.push(`Orders are placed in multiples of ${increment} packs, so this rounds to ${rounded}.`);
    packsNeeded = rounded;
    incrementApplied = true;
  }

  const purchasedUnits = packsNeeded * unitsPerPack;
  const overageUnits = purchasedUnits - requiredUnits;
  if (overageUnits > 0 && !minOrderApplied && !incrementApplied) {
    notes.push(
      `Pack size of ${unitsPerPack} means you buy ${purchasedUnits} units to cover ${requiredUnits}.`,
    );
  }

  const merchandiseSubtotal: MoneyAmount = {
    amount: round2(packsNeeded * pricePerPack.amount),
    currency: pricePerPack.currency,
  };

  const shippingStatus = classifyShipping(input.shippingInfo);
  // Supplier pages rarely separate the two: "Free shipping, inclusive of GST"
  // is one sentence in the delivery block. So when no dedicated tax text was
  // extracted, the shipping text is searched as well. This only ever makes tax
  // status *more* known, and a phrase that says nothing about tax still yields
  // "unknown" — it cannot manufacture a landed total.
  const taxStatus = classifyTax(input.taxInfo ?? input.shippingInfo);

  // 4. A landed total exists only when BOTH shipping and tax are pinned down.
  //    "Free shipping" counts as known (it is a stated zero, not an absence).
  let landedTotal: MoneyAmount | null = null;
  if (shippingStatus === 'free_stated' && taxStatus === 'inclusive_stated') {
    landedTotal = { ...merchandiseSubtotal };
  } else {
    if (shippingStatus !== 'free_stated') {
      notes.push('No landed total: shipping cost is not stated on the page.');
    }
    if (taxStatus !== 'inclusive_stated') {
      notes.push('No landed total: tax treatment is not stated on the page.');
    }
  }

  return {
    requiredUnits,
    unitsPerPack,
    packsNeeded,
    packsBeforeMinimums,
    purchasedUnits,
    overageUnits,
    merchandiseSubtotal,
    landedTotal,
    shippingStatus,
    taxStatus,
    minOrderApplied,
    incrementApplied,
    notes,
  };
}

function classifyShipping(info: string | null): Costing['shippingStatus'] {
  if (!info) return 'unknown';
  const t = info.toLowerCase();
  if (/\bfree (shipping|delivery)\b/.test(t)) return 'free_stated';
  if (/\b(quote|enquir|enquiry|inquiry|contact us|calculated at checkout)\b/.test(t)) {
    return 'quote_required';
  }
  // A number with a currency marker means a real figure was published.
  if (/[₹$€£]\s*\d|\b\d+(\.\d+)?\s*(inr|usd|eur|gbp|rs\.?)\b/i.test(t)) return 'known';
  return 'unknown';
}

function classifyTax(info: string | null): Costing['taxStatus'] {
  if (!info) return 'unknown';
  const t = info.toLowerCase();
  if (/\b(incl\.?|inclusive of|including)\s+(all\s+)?(gst|vat|tax)/.test(t)) {
    return 'inclusive_stated';
  }
  if (/\b(gst|vat|tax)\b.*\b\d+(\.\d+)?\s*%/.test(t)) return 'known';
  return 'unknown';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Comparability guard.
 *
 * Two candidates can only be ranked on cost when they are priced in the same
 * currency and both have a known merchandise subtotal. We do not convert
 * currencies: an unreferenced FX rate would be a fabricated number, and at
 * procurement volumes the error is not academic.
 */
export function areComparable(a: CandidateProduct, b: CandidateProduct): boolean {
  if (!a.costing || !b.costing) return false;
  return a.costing.merchandiseSubtotal.currency === b.costing.merchandiseSubtotal.currency;
}

export function formatMoney(m: MoneyAmount | null): string {
  if (!m) return 'Unknown';
  const symbol = CURRENCY_SYMBOLS[m.currency] ?? `${m.currency} `;
  return `${symbol}${m.amount.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

/**
 * The honest label for a cost figure. Used everywhere a number is displayed so
 * that a subtotal is never mistaken for a quote.
 */
export function costLabel(c: Costing | null): string {
  if (!c) return 'Cost unknown';
  if (c.landedTotal) return 'Landed total (goods, shipping and tax stated)';
  return 'Merchandise subtotal only — shipping and tax not included';
}
