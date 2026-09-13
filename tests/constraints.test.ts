import { describe, it, expect } from 'vitest';
import { deriveStatus, evaluateCandidate, parseLeadTimeDays } from '@/lib/domain/constraints';
import { computeCosting } from '@/lib/domain/costing';
import { compareDimensions, parseDimensionString } from '@/lib/domain/units';
import type { CandidateProduct, Requirement } from '@/lib/domain/types';

/**
 * The unknown-versus-failed distinction, which is the product's central claim.
 */

const TODAY = '2026-09-13';

function candidate(patch: Partial<CandidateProduct> = {}): CandidateProduct {
  const base: CandidateProduct = {
    id: 'c1',
    caseId: 'case1',
    runId: 'run1',
    supplierName: 'Test Supplier',
    productTitle: 'Cake box',
    sourceUrl: 'https://example.invalid/p',
    imageUrl: null,
    retrievedAt: TODAY,
    status: 'potential_match',
    unitsPerPack: 50,
    pricePerPack: { amount: 720, currency: 'INR' },
    minOrderPacks: null,
    orderIncrementPacks: null,
    dimensions: { length: 10, width: 10, height: 5, unit: 'in', surface: 'external' },
    material: 'kraft paperboard',
    foodContactClaim: null,
    shippingInfo: null,
    leadTimeInfo: null,
    currency: 'INR',
    costing: null,
    rationale: '',
    rankScore: null,
    dedupeKey: 'example.invalid/p',
    createdAt: TODAY,
    ...patch,
  };
  base.costing = computeCosting({
    requiredUnits: 500,
    unitsPerPack: base.unitsPerPack,
    pricePerPack: base.pricePerPack,
    minOrderPacks: base.minOrderPacks,
    orderIncrementPacks: base.orderIncrementPacks,
    shippingInfo: base.shippingInfo,
  });
  return base;
}

function req(spec: Requirement['spec'], label: string, priority: Requirement['priority'] = 'must_have'): Requirement {
  return { id: `r-${label}`, caseId: 'case1', kind: spec.kind as any, priority, label, spec, createdAt: TODAY };
}

const QUANTITY = req({ kind: 'quantity', units: 500, partialOk: false }, '500 units');
const DIMENSIONS = req(
  { kind: 'dimensions', length: 10, width: 10, height: 5, unit: 'in', surface: 'external', tolerancePct: 5 },
  '10x10x5 in',
);
const FOOD = req({ kind: 'certification', keywords: [], foodContact: true }, 'Food contact');
const DEADLINE = req({ kind: 'delivery_date', isoDate: '2026-09-18', timezone: 'Asia/Kolkata' }, 'By 18 Sept');
const BUDGET = req({ kind: 'budget', maxAmount: 8000, currency: 'INR', scope: 'merchandise' }, 'Budget 8000');

describe('unknown is not failed', () => {
  it('reports missing dimensions as unknown, never as a failure', () => {
    const [r] = evaluateCandidate(candidate({ dimensions: null }), [DIMENSIONS], TODAY);
    expect(r.outcome).toBe('unknown');
  });

  it('reports wrong dimensions as failed', () => {
    const [r] = evaluateCandidate(
      candidate({ dimensions: { length: 12, width: 12, height: 6, unit: 'in', surface: 'external' } }),
      [DIMENSIONS],
      TODAY,
    );
    expect(r.outcome).toBe('failed');
  });

  it('reports a missing lead time as unknown, not as missing the deadline', () => {
    const [r] = evaluateCandidate(candidate({ leadTimeInfo: null }), [DEADLINE], TODAY);
    expect(r.outcome).toBe('unknown');
    expect(r.explanation).toMatch(/cannot be confirmed/i);
  });

  it('reports a lead time that genuinely overruns as failed', () => {
    const [r] = evaluateCandidate(
      candidate({ leadTimeInfo: 'Delivery in 5-7 working days' }),
      [DEADLINE],
      TODAY,
    );
    expect(r.outcome).toBe('failed');
  });

  it('accepts a lead time that fits', () => {
    const [r] = evaluateCandidate(
      candidate({ leadTimeInfo: 'Dispatched within 2-3 business days' }),
      [DEADLINE],
      TODAY,
    );
    expect(r.outcome).toBe('met');
  });
});

describe('supplier claims are not certification', () => {
  it('treats a bare "food safe" claim as unknown', () => {
    const [r] = evaluateCandidate(
      candidate({ foodContactClaim: 'Food safe: yes, food grade' }),
      [FOOD],
      TODAY,
    );
    expect(r.outcome).toBe('unknown');
    expect(r.explanation).toMatch(/supplier claim/i);
  });

  it('accepts a claim that names an actual standard', () => {
    const [r] = evaluateCandidate(
      candidate({ foodContactClaim: 'Manufactured to FSSAI food-contact requirements' }),
      [FOOD],
      TODAY,
    );
    expect(r.outcome).toBe('met');
  });

  it('reports silence about food contact as unknown', () => {
    const [r] = evaluateCandidate(candidate({ foodContactClaim: null }), [FOOD], TODAY);
    expect(r.outcome).toBe('unknown');
  });
});

describe('internal and external dimensions are never equated', () => {
  it('flags a surface mismatch as unknown rather than matching on the numbers', () => {
    const [r] = evaluateCandidate(
      candidate({ dimensions: { length: 10, width: 10, height: 5, unit: 'in', surface: 'internal' } }),
      [DIMENSIONS],
      TODAY,
    );
    expect(r.outcome).toBe('unknown');
    expect(r.explanation).toMatch(/not interchangeable/i);
  });

  it('detects the mismatch at the comparison level too', () => {
    const cmp = compareDimensions(
      { length: 10, width: 10, height: 5, unit: 'in', surface: 'external', tolerancePct: 5 },
      { length: 10, width: 10, height: 5, unit: 'in', surface: 'internal' },
    );
    expect(cmp.surfaceMismatch).toBe(true);
  });

  it('compares across units correctly', () => {
    const cmp = compareDimensions(
      { length: 10, width: 10, height: 5, unit: 'in', surface: 'external', tolerancePct: 5 },
      { length: 254, width: 254, height: 127, unit: 'mm', surface: 'external' },
    );
    expect(cmp.matches).toBe(true);
  });

  it('ignores the order the supplier lists the axes in', () => {
    const cmp = compareDimensions(
      { length: 10, width: 10, height: 5, unit: 'in', surface: 'external', tolerancePct: 5 },
      { length: 5, width: 10, height: 10, unit: 'in', surface: 'external' },
    );
    expect(cmp.matches).toBe(true);
  });
});

describe('minimum order overshoot', () => {
  it('fails a candidate whose minimum vastly exceeds the requirement', () => {
    const c = candidate({ unitsPerPack: 100, minOrderPacks: 50 });
    const [r] = evaluateCandidate(c, [QUANTITY], TODAY);
    expect(r.outcome).toBe('failed');
    expect(r.explanation).toMatch(/5000 units/);
  });

  it('allows the overshoot when partial fulfilment is acceptable', () => {
    const c = candidate({ unitsPerPack: 100, minOrderPacks: 50 });
    const partial = req({ kind: 'quantity', units: 500, partialOk: true }, '500 units');
    const [r] = evaluateCandidate(c, [partial], TODAY);
    expect(r.outcome).toBe('met');
  });
});

describe('budget', () => {
  it('fails when goods alone exceed the budget', () => {
    const [r] = evaluateCandidate(candidate({ pricePerPack: { amount: 900, currency: 'INR' } }), [BUDGET], TODAY);
    expect(r.outcome).toBe('failed');
  });

  it('refuses to compare across currencies', () => {
    const [r] = evaluateCandidate(candidate({ pricePerPack: { amount: 90, currency: 'USD' } }), [BUDGET], TODAY);
    expect(r.outcome).toBe('unknown');
    expect(r.explanation).toMatch(/do not convert/i);
  });

  it('marks a landed-scope budget unknown while shipping is unknown', () => {
    const landed = req(
      { kind: 'budget', maxAmount: 8000, currency: 'INR', scope: 'landed' },
      'Landed budget',
    );
    const [r] = evaluateCandidate(candidate(), [landed], TODAY);
    expect(r.outcome).toBe('unknown');
  });
});

describe('overall status', () => {
  it('never marks a candidate verified while a hard requirement is unknown', () => {
    const results = evaluateCandidate(candidate({ foodContactClaim: null }), [DIMENSIONS, FOOD], TODAY);
    expect(deriveStatus(results)).toBe('potential_match');
  });

  it('marks verified only when every hard requirement is met', () => {
    const c = candidate({
      foodContactClaim: 'FSSAI compliant',
      leadTimeInfo: 'Dispatch in 2 days',
    });
    const results = evaluateCandidate(c, [DIMENSIONS, FOOD, DEADLINE], TODAY);
    expect(deriveStatus(results)).toBe('verified_match');
  });

  it('a single confirmed failure outweighs any number of matches', () => {
    const c = candidate({
      dimensions: { length: 20, width: 20, height: 9, unit: 'in', surface: 'external' },
      foodContactClaim: 'FSSAI compliant',
    });
    const results = evaluateCandidate(c, [DIMENSIONS, FOOD], TODAY);
    expect(deriveStatus(results)).toBe('does_not_meet');
  });

  it('an unknown preference does not stop a candidate being verified', () => {
    const pref = req({ kind: 'material', keywords: ['bamboo'] }, 'Bamboo', 'preference');
    const c = candidate({ foodContactClaim: 'FSSAI compliant' });
    const results = evaluateCandidate(c, [DIMENSIONS, FOOD, pref], TODAY);
    expect(deriveStatus(results)).toBe('verified_match');
  });
});

describe('lead time parsing', () => {
  it.each([
    ['ships in 2-3 business days', 3],
    ['dispatch within 24 hours', 1],
    ['7 working days', 7],
    ['same-day dispatch', 0],
    ['next-day delivery', 1],
  ])('parses %s as %i days', (text, expected) => {
    expect(parseLeadTimeDays(text)).toBe(expected);
  });

  it('returns null rather than guessing when there is no usable number', () => {
    expect(parseLeadTimeDays('ships quickly')).toBeNull();
    expect(parseLeadTimeDays('contact us for delivery options')).toBeNull();
  });
});

describe('dimension string parsing', () => {
  it.each([
    ['10 x 10 x 5 inches', { length: 10, unit: 'in' }],
    ['254 x 254 x 127 mm', { length: 254, unit: 'mm' }],
    ['30x30x15 cm', { length: 30, unit: 'cm' }],
  ])('parses %s', (text, expected) => {
    const d = parseDimensionString(text)!;
    expect(d.length).toBe(expected.length);
    expect(d.unit).toBe(expected.unit);
  });

  it('picks up the internal/external qualifier', () => {
    expect(parseDimensionString('Internal usable dimensions: 10 x 10 x 5 inches')!.surface).toBe('internal');
    expect(parseDimensionString('External dimensions 10 x 10 x 5 in')!.surface).toBe('external');
  });

  it('returns null for text with no dimension triple', () => {
    expect(parseDimensionString('a sturdy white box')).toBeNull();
  });
});
