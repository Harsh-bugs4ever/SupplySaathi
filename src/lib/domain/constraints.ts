import { compareDimensions, formatDimensions } from './units';
import { daysBetween } from './dates';
import type {
  CandidateProduct,
  CandidateStatus,
  ConstraintOutcome,
  Requirement,
} from './types';

/**
 * Hard-constraint evaluation.
 *
 * The central discipline here: `unknown` is never quietly converted into `met`
 * or `failed`. A page that does not mention food-contact safety has not told us
 * the product is unsafe, and it has not told us it is safe either. That third
 * answer is the one that turns into a question for the supplier.
 */

export interface EvaluationResult {
  requirementId: string;
  requirementLabel: string;
  priority: Requirement['priority'];
  outcome: ConstraintOutcome;
  explanation: string;
  /** Fact paths whose evidence backs this call, for the evidence drawer. */
  evidencePaths: string[];
}

export function evaluateCandidate(
  candidate: CandidateProduct,
  requirements: Requirement[],
  today: string,
): EvaluationResult[] {
  return requirements.map((req) => evaluateOne(candidate, req, today));
}

function evaluateOne(
  c: CandidateProduct,
  req: Requirement,
  today: string,
): EvaluationResult {
  const base = {
    requirementId: req.id,
    requirementLabel: req.label,
    priority: req.priority,
  };

  switch (req.spec.kind) {
    // ── Quantity ────────────────────────────────────────────────────────────
    case 'quantity': {
      const spec = req.spec;
      if (!c.unitsPerPack || !c.costing) {
        return {
          ...base,
          outcome: 'unknown',
          explanation: 'Pack size is not stated, so we cannot confirm the order quantity works.',
          evidencePaths: ['unitsPerPack'],
        };
      }
      const { purchasedUnits, packsNeeded, minOrderApplied } = c.costing;

      // A minimum order that overshoots is a real failure only when the buyer
      // said they cannot take more than they asked for.
      if (minOrderApplied && !spec.partialOk) {
        const moq = c.minOrderPacks ?? 0;
        const overshoot = purchasedUnits - spec.units;
        if (overshoot > spec.units * 0.5) {
          return {
            ...base,
            outcome: 'failed',
            explanation:
              `Minimum order is ${moq} packs (${purchasedUnits} units), which is ` +
              `${overshoot} units more than the ${spec.units} you need.`,
            evidencePaths: ['minOrderPacks', 'unitsPerPack'],
          };
        }
      }

      return {
        ...base,
        outcome: 'met',
        explanation:
          `${packsNeeded} packs of ${c.unitsPerPack} gives ${purchasedUnits} units, ` +
          `covering the ${spec.units} required.`,
        evidencePaths: ['unitsPerPack', 'minOrderPacks'],
      };
    }

    // ── Dimensions ──────────────────────────────────────────────────────────
    case 'dimensions': {
      const spec = req.spec;
      if (!c.dimensions) {
        return {
          ...base,
          outcome: 'unknown',
          explanation: 'The page does not state box dimensions.',
          evidencePaths: ['dimensions'],
        };
      }

      const cmp = compareDimensions(spec, c.dimensions);

      // Internal vs external is the classic packaging trap: a box whose
      // *internal* size is 10x10x5 is physically bigger than one whose
      // *external* size is 10x10x5. We refuse to treat them as equivalent.
      if (cmp.surfaceMismatch) {
        return {
          ...base,
          outcome: 'unknown',
          explanation:
            `The page gives ${c.dimensions.surface} dimensions ` +
            `(${formatDimensions(c.dimensions)}) but you specified ${spec.surface} ` +
            `measurements. These are not interchangeable and need confirming.`,
          evidencePaths: ['dimensions'],
        };
      }

      if (cmp.matches) {
        return {
          ...base,
          outcome: 'met',
          explanation: `Listed as ${formatDimensions(c.dimensions)}, within your ${spec.tolerancePct}% tolerance.`,
          evidencePaths: ['dimensions'],
        };
      }

      const worst = cmp.perAxis.reduce((a, b) =>
        Math.abs(b.deltaPct) > Math.abs(a.deltaPct) ? b : a,
      );
      return {
        ...base,
        outcome: 'failed',
        explanation:
          `Listed as ${formatDimensions(c.dimensions)}. One side differs by ` +
          `${worst.deltaPct.toFixed(1)}%, outside your ${spec.tolerancePct}% tolerance.`,
        evidencePaths: ['dimensions'],
      };
    }

    // ── Material ────────────────────────────────────────────────────────────
    case 'material': {
      const spec = req.spec;
      if (!c.material) {
        return {
          ...base,
          outcome: 'unknown',
          explanation: 'Material is not described on the page.',
          evidencePaths: ['material'],
        };
      }
      const hay = c.material.toLowerCase();
      const hit = spec.keywords.find((k) => hay.includes(k.toLowerCase()));
      return hit
        ? {
            ...base,
            outcome: 'met',
            explanation: `Page describes the material as "${c.material}".`,
            evidencePaths: ['material'],
          }
        : {
            ...base,
            outcome: req.priority === 'must_have' ? 'failed' : 'unknown',
            explanation:
              `Page describes the material as "${c.material}", which does not mention ` +
              `${spec.keywords.join(' or ')}.`,
            evidencePaths: ['material'],
          };
    }

    // ── Certification / food contact ────────────────────────────────────────
    case 'certification': {
      const spec = req.spec;
      if (!c.foodContactClaim) {
        return {
          ...base,
          outcome: 'unknown',
          explanation:
            'The page makes no statement about food contact suitability. This needs to be asked.',
          evidencePaths: ['foodContactClaim'],
        };
      }

      const claim = c.foodContactClaim.toLowerCase();
      const namesStandard = /\b(fssai|fda|lfgb|bis|iso\s*22000|en\s*1935|brc)\b/.test(claim);

      // A bare marketing phrase is a supplier claim, not a certification, and
      // the status must reflect that or the shortlist becomes misleading.
      if (!namesStandard) {
        return {
          ...base,
          outcome: 'unknown',
          explanation:
            `The page says "${c.foodContactClaim}" but names no standard or certificate. ` +
            `That is a supplier claim, not documented certification.`,
          evidencePaths: ['foodContactClaim'],
        };
      }

      return {
        ...base,
        outcome: 'met',
        explanation: `Page cites a named standard: "${c.foodContactClaim}". Documentation should still be requested.`,
        evidencePaths: ['foodContactClaim'],
      };
    }

    // ── Delivery date ───────────────────────────────────────────────────────
    case 'delivery_date': {
      const spec = req.spec;
      if (!c.leadTimeInfo) {
        return {
          ...base,
          outcome: 'unknown',
          explanation:
            'No dispatch or delivery timeframe is stated, so arrival by your date cannot be confirmed.',
          evidencePaths: ['leadTimeInfo'],
        };
      }

      const days = parseLeadTimeDays(c.leadTimeInfo);
      if (days === null) {
        return {
          ...base,
          outcome: 'unknown',
          explanation: `Page mentions "${c.leadTimeInfo}" but gives no usable number of days.`,
          evidencePaths: ['leadTimeInfo'],
        };
      }

      const available = daysBetween(today, spec.isoDate);
      if (days <= available) {
        return {
          ...base,
          outcome: 'met',
          explanation:
            `Stated lead time of ${days} days fits the ${available} days before your deadline. ` +
            `This is the supplier's published estimate, not a commitment.`,
          evidencePaths: ['leadTimeInfo'],
        };
      }
      return {
        ...base,
        outcome: 'failed',
        explanation: `Stated lead time of ${days} days exceeds the ${available} days available.`,
        evidencePaths: ['leadTimeInfo'],
      };
    }

    // ── Budget ──────────────────────────────────────────────────────────────
    case 'budget': {
      const spec = req.spec;
      if (!c.costing) {
        return {
          ...base,
          outcome: 'unknown',
          explanation: 'Price or pack size is unknown, so cost cannot be checked against budget.',
          evidencePaths: ['pricePerPack', 'unitsPerPack'],
        };
      }

      const sub = c.costing.merchandiseSubtotal;
      if (sub.currency !== spec.currency) {
        return {
          ...base,
          outcome: 'unknown',
          explanation:
            `Priced in ${sub.currency} against a ${spec.currency} budget. We do not convert ` +
            `currencies, so this needs a quote in ${spec.currency}.`,
          evidencePaths: ['pricePerPack'],
        };
      }

      if (sub.amount > spec.maxAmount) {
        return {
          ...base,
          outcome: 'failed',
          explanation:
            `Merchandise subtotal of ${sub.amount} ${sub.currency} already exceeds your ` +
            `${spec.maxAmount} ${spec.currency} budget, before shipping.`,
          evidencePaths: ['pricePerPack'],
        };
      }

      // Under budget on goods, but if shipping is unknown we cannot promise the
      // landed cost fits. That is an unknown, not a pass.
      if (spec.scope === 'landed' && !c.costing.landedTotal) {
        return {
          ...base,
          outcome: 'unknown',
          explanation:
            `Goods come to ${sub.amount} ${sub.currency}, within budget, but shipping and tax ` +
            `are unknown so the landed cost is not yet confirmed.`,
          evidencePaths: ['pricePerPack', 'shippingInfo'],
        };
      }

      return {
        ...base,
        outcome: 'met',
        explanation: `Merchandise subtotal of ${sub.amount} ${sub.currency} is within your ${spec.maxAmount} budget.`,
        evidencePaths: ['pricePerPack'],
      };
    }

    // ── Delivery location ───────────────────────────────────────────────────
    case 'delivery_location': {
      const spec = req.spec;
      if (!c.shippingInfo) {
        return {
          ...base,
          outcome: 'unknown',
          explanation: `The page does not say whether they ship to ${spec.city}.`,
          evidencePaths: ['shippingInfo'],
        };
      }
      const t = c.shippingInfo.toLowerCase();
      if (t.includes(spec.city.toLowerCase())) {
        return {
          ...base,
          outcome: 'met',
          explanation: `Page mentions delivery to ${spec.city}.`,
          evidencePaths: ['shippingInfo'],
        };
      }
      if (/\b(pan[- ]?india|all over india|nationwide|across india)\b/.test(t)) {
        return {
          ...base,
          outcome: 'met',
          explanation: `Page states nationwide delivery, which covers ${spec.city}.`,
          evidencePaths: ['shippingInfo'],
        };
      }
      return {
        ...base,
        outcome: 'unknown',
        explanation: `Shipping coverage for ${spec.city} is not stated explicitly.`,
        evidencePaths: ['shippingInfo'],
      };
    }

    case 'other':
    default:
      return {
        ...base,
        outcome: 'unknown',
        explanation: 'This requirement needs manual confirmation with the supplier.',
        evidencePaths: [],
      };
  }
}

/**
 * Pull a worst-case day count out of phrases like "ships in 2-3 business days",
 * "dispatch within 24 hours", "7 working days". Returns null when the text has
 * no number we can rely on — we would rather ask than assume.
 */
export function parseLeadTimeDays(text: string): number | null {
  const t = text.toLowerCase();

  const range = t.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(business |working |woking )?days?/);
  if (range) return Number(range[2]);

  const hours = t.match(/(\d{1,3})\s*hours?/);
  if (hours) return Math.ceil(Number(hours[1]) / 24);

  const single = t.match(/(\d{1,2})\s*(business |working )?days?/);
  if (single) return Number(single[1]);

  if (/\bsame[- ]day\b/.test(t)) return 0;
  if (/\bnext[- ]day\b/.test(t)) return 1;

  return null;
}

/**
 * Roll per-requirement outcomes up into the single status shown on a card.
 *
 * A candidate with any unknown hard requirement must never read as verified —
 * that is the rule that keeps the shortlist trustworthy.
 */
export function deriveStatus(results: EvaluationResult[]): CandidateStatus {
  const hard = results.filter((r) => r.priority === 'must_have');
  if (hard.some((r) => r.outcome === 'failed')) return 'does_not_meet';
  if (hard.some((r) => r.outcome === 'unknown')) return 'potential_match';
  return 'verified_match';
}

export const STATUS_LABELS: Record<CandidateStatus, string> = {
  verified_match: 'Meets verified requirements',
  potential_match: 'Potential match — confirmation needed',
  does_not_meet: 'Does not meet requirements',
  retrieval_failed: 'Could not be read',
};
