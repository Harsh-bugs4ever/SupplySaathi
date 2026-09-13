import { describe, it, expect } from 'vitest';
import { computeCosting } from '@/lib/domain/costing';

/**
 * Pack conversion, minimum orders, and the refusal to invent a total.
 *
 * These are the numbers a business owner will act on, so each rule gets an
 * explicit test rather than being covered incidentally.
 */

const base = {
  requiredUnits: 500,
  unitsPerPack: 50,
  pricePerPack: { amount: 720, currency: 'INR' },
  minOrderPacks: null,
  orderIncrementPacks: null,
  shippingInfo: null,
};

describe('pack conversion', () => {
  it('divides exactly when the requirement is a multiple of the pack size', () => {
    const c = computeCosting(base)!;
    expect(c.packsNeeded).toBe(10);
    expect(c.purchasedUnits).toBe(500);
    expect(c.overageUnits).toBe(0);
    expect(c.merchandiseSubtotal.amount).toBe(7200);
  });

  it('rounds UP — you cannot buy a fraction of a pack', () => {
    const c = computeCosting({ ...base, unitsPerPack: 40 })!;
    // 500 / 40 = 12.5 -> 13 packs -> 520 units
    expect(c.packsNeeded).toBe(13);
    expect(c.purchasedUnits).toBe(520);
    expect(c.overageUnits).toBe(20);
  });

  it('surfaces the overage rather than hiding it', () => {
    const c = computeCosting({ ...base, unitsPerPack: 30 })!;
    expect(c.packsNeeded).toBe(17);
    expect(c.purchasedUnits).toBe(510);
    expect(c.overageUnits).toBe(10);
    expect(c.notes.join(' ')).toContain('510');
  });

  it('handles a pack larger than the whole requirement', () => {
    const c = computeCosting({ ...base, unitsPerPack: 1000 })!;
    expect(c.packsNeeded).toBe(1);
    expect(c.overageUnits).toBe(500);
  });
});

describe('minimum order quantity', () => {
  it('raises the pack count to the supplier minimum', () => {
    const c = computeCosting({ ...base, unitsPerPack: 100, minOrderPacks: 50 })!;
    expect(c.packsBeforeMinimums).toBe(5);
    expect(c.packsNeeded).toBe(50);
    expect(c.purchasedUnits).toBe(5000);
    expect(c.minOrderApplied).toBe(true);
    expect(c.notes.join(' ')).toContain('minimum order');
  });

  it('ignores a minimum that is already satisfied', () => {
    const c = computeCosting({ ...base, minOrderPacks: 2 })!;
    expect(c.packsNeeded).toBe(10);
    expect(c.minOrderApplied).toBe(false);
  });

  it('rounds up to the order increment', () => {
    // 500 / 25 = 20 packs, but orders go in multiples of 3 -> 21
    const c = computeCosting({
      ...base,
      unitsPerPack: 25,
      orderIncrementPacks: 3,
    })!;
    expect(c.packsNeeded).toBe(21);
    expect(c.incrementApplied).toBe(true);
  });

  it('applies the minimum first, then the increment', () => {
    const c = computeCosting({
      ...base,
      unitsPerPack: 25,
      minOrderPacks: 22,
      orderIncrementPacks: 4,
    })!;
    // need 20, minimum lifts to 22, increment of 4 lifts to 24
    expect(c.packsNeeded).toBe(24);
    expect(c.minOrderApplied).toBe(true);
    expect(c.incrementApplied).toBe(true);
  });
});

describe('missing shipping and tax are never treated as zero', () => {
  it('produces no landed total when shipping is unstated', () => {
    const c = computeCosting(base)!;
    expect(c.landedTotal).toBeNull();
    expect(c.shippingStatus).toBe('unknown');
    expect(c.notes.join(' ')).toContain('shipping cost is not stated');
  });

  it('still produces no landed total when shipping is free but tax is unknown', () => {
    const c = computeCosting({ ...base, shippingInfo: 'Free delivery within Pune' })!;
    expect(c.shippingStatus).toBe('free_stated');
    expect(c.landedTotal).toBeNull();
  });

  it('produces a landed total only when both are stated', () => {
    const c = computeCosting({
      ...base,
      shippingInfo: 'Free shipping, inclusive of all GST',
    })!;
    expect(c.shippingStatus).toBe('free_stated');
    expect(c.taxStatus).toBe('inclusive_stated');
    expect(c.landedTotal).toEqual({ amount: 7200, currency: 'INR' });
  });

  it('treats "calculated at checkout" as requiring a quote, not as zero', () => {
    const c = computeCosting({
      ...base,
      shippingInfo: 'Shipping charges are calculated at checkout',
    })!;
    expect(c.shippingStatus).toBe('quote_required');
    expect(c.landedTotal).toBeNull();
  });
});

describe('refusing to calculate', () => {
  it('returns null when the pack size is unknown', () => {
    expect(computeCosting({ ...base, unitsPerPack: null })).toBeNull();
  });

  it('returns null when the price is unknown', () => {
    expect(computeCosting({ ...base, pricePerPack: null })).toBeNull();
  });

  it('returns null when the requirement has no quantity', () => {
    expect(computeCosting({ ...base, requiredUnits: 0 })).toBeNull();
  });
});
