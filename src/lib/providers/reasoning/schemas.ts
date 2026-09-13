import { z } from 'zod';

/**
 * Schemas for every structured model output.
 *
 * Nothing a model returns is trusted until it has passed through one of these.
 * The point is not tidiness: a hallucinated field shape that reaches the
 * costing engine produces a confident wrong number on a supplier card, which is
 * exactly the failure this product cannot afford.
 *
 * Note what is NOT here: no field asks the model for a computed total, a pack
 * count or a score. Those are derived in code from the values below.
 */

// ── Brief parsing ───────────────────────────────────────────────────────────

export const ParsedBriefSchema = z.object({
  title: z.string().min(1).max(120),
  productName: z.string().max(200).nullable(),
  quantity: z
    .object({
      units: z.number().int().positive(),
      partialOk: z.boolean(),
    })
    .nullable(),
  dimensions: z
    .object({
      length: z.number().positive(),
      width: z.number().positive(),
      height: z.number().positive(),
      unit: z.enum(['mm', 'cm', 'in']),
      surface: z.enum(['external', 'internal', 'unspecified']),
    })
    .nullable(),
  material: z.array(z.string().max(60)).max(6),
  certifications: z.array(z.string().max(60)).max(6),
  foodContactRequired: z.boolean(),
  delivery: z
    .object({
      city: z.string().max(80),
      postalCode: z.string().max(20).nullable(),
      country: z.string().max(4),
    })
    .nullable(),
  /** The literal phrase used for the deadline, e.g. "Friday". Resolved in code. */
  deadlinePhrase: z.string().max(80).nullable(),
  budget: z
    .object({
      maxAmount: z.number().positive(),
      currency: z.string().length(3),
      scope: z.enum(['merchandise', 'landed']),
    })
    .nullable(),
  substitutionsOk: z.boolean(),
  preferences: z.array(z.string().max(120)).max(8),
  /**
   * Only questions whose answer would change which products qualify. The prompt
   * is explicit that "nice to know" questions must be omitted.
   */
  clarifications: z
    .array(
      z.object({
        question: z.string().max(200),
        reason: z.string().max(200),
      }),
    )
    .max(3),
});
export type ParsedBrief = z.infer<typeof ParsedBriefSchema>;

// ── Search planning ─────────────────────────────────────────────────────────

export const SearchPlanSchema = z.object({
  queries: z.array(z.string().min(3).max(160)).min(1).max(6),
  reasoning: z.string().max(400),
});
export type SearchPlan = z.infer<typeof SearchPlanSchema>;

// ── Product extraction ──────────────────────────────────────────────────────

/**
 * Every extracted fact carries the excerpt it came from. A value without a
 * supporting quote is treated as unknown, which makes fabrication structurally
 * useless to the model rather than merely discouraged.
 */
const FactSchema = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value: value.nullable(),
    excerpt: z.string().max(400).nullable(),
  });

export const ExtractedProductSchema = z.object({
  isProductPage: z.boolean(),
  supplierName: z.string().max(120).nullable(),
  productTitle: z.string().max(200).nullable(),
  imageUrl: z.string().max(500).nullable(),
  contactEmail: z.string().max(160).nullable(),

  unitsPerPack: FactSchema(z.number().int().positive()),
  pricePerPack: FactSchema(
    z.object({ amount: z.number().positive(), currency: z.string().length(3) }),
  ),
  minOrderPacks: FactSchema(z.number().int().positive()),
  orderIncrementPacks: FactSchema(z.number().int().positive()),
  dimensions: FactSchema(
    z.object({
      length: z.number().positive(),
      width: z.number().positive(),
      height: z.number().positive(),
      unit: z.enum(['mm', 'cm', 'in']),
      surface: z.enum(['external', 'internal', 'unspecified']),
    }),
  ),
  material: FactSchema(z.string().max(200)),
  foodContactClaim: FactSchema(z.string().max(300)),
  shippingInfo: FactSchema(z.string().max(300)),
  leadTimeInfo: FactSchema(z.string().max(300)),

  /**
   * Set when the page states two incompatible values for the same attribute,
   * e.g. separate internal and external dimensions. Recorded as conflicting
   * evidence instead of the model silently picking one.
   */
  conflicts: z.array(z.string().max(200)).max(5),
});
export type ExtractedProduct = z.infer<typeof ExtractedProductSchema>;

// ── Quote drafting ──────────────────────────────────────────────────────────

export const QuoteDraftSchema = z.object({
  subject: z.string().min(5).max(160),
  body: z.string().min(40).max(4000),
  questions: z.array(z.string().max(200)).max(8),
});
export type DraftedQuote = z.infer<typeof QuoteDraftSchema>;

// ── Validation helper ───────────────────────────────────────────────────────

/**
 * Adapts a Zod schema to the ReasoningProvider's validate callback, flattening
 * the error into a single line the repair prompt can act on.
 */
export function zodValidator<T>(schema: z.ZodType<T>) {
  return (raw: unknown): { ok: true; value: T } | { ok: false; error: string } => {
    const result = schema.safeParse(raw);
    if (result.success) return { ok: true, value: result.data };
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { ok: false, error: issues };
  };
}
