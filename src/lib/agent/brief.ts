import { resolveDeadline, todayInZone, type ResolvedDeadline } from '../domain/dates';
import type { Requirement, RequirementSpec } from '../domain/types';
import type { ParsedBrief } from '../providers/reasoning/schemas';

/**
 * Brief normalisation.
 *
 * Turns a parsed brief into the list of machine-checkable requirements that the
 * constraint engine evaluates every candidate against. Two things are decided
 * here rather than by the model:
 *
 *   - the deadline, resolved to an explicit date in the user's timezone
 *   - which requirements are hard and which are preferences
 */

export interface StructuredBriefInput {
  productName?: string | null;
  originalProductUrl?: string | null;
  quantity?: number | null;
  partialOk?: boolean;
  dimensions?: {
    length: number;
    width: number;
    height: number;
    unit: 'mm' | 'cm' | 'in';
    surface: 'external' | 'internal' | 'unspecified';
  } | null;
  material?: string[];
  certifications?: string[];
  foodContactRequired?: boolean;
  city?: string | null;
  postalCode?: string | null;
  country?: string;
  deadlineText?: string | null;
  budgetAmount?: number | null;
  currency?: string;
  budgetScope?: 'merchandise' | 'landed';
  substitutionsOk?: boolean;
  preferences?: string[];
  /** Requirement kinds the user explicitly marked as preferences, not musts. */
  softenedKinds?: string[];
}

export interface NormalizedBrief {
  title: string;
  deadline: ResolvedDeadline | null;
  /** Requirements without ids; the caller persists them against a case. */
  requirements: Array<Omit<Requirement, 'id' | 'caseId' | 'createdAt'>>;
  /** Questions worth asking. Empty is a good outcome. */
  clarifications: Array<{ question: string; reason: string }>;
  warnings: string[];
}

const DEFAULT_TOLERANCE_PCT = 5;

export function normalizeBrief(input: {
  parsed: ParsedBrief;
  structured: StructuredBriefInput;
  timezone: string;
  defaultCurrency: string;
  now?: Date;
}): NormalizedBrief {
  const { parsed, structured, timezone } = input;
  const now = input.now ?? new Date();
  const warnings: string[] = [];
  const clarifications = [...parsed.clarifications];

  // Structured form fields are authoritative: the user typed them into a
  // labelled box, which beats anything inferred from free text.
  const units = structured.quantity ?? parsed.quantity?.units ?? null;
  const partialOk = structured.partialOk ?? parsed.quantity?.partialOk ?? false;
  const dimensions = structured.dimensions ?? parsed.dimensions ?? null;
  const materials = structured.material?.length ? structured.material : parsed.material;
  const certs = structured.certifications?.length ? structured.certifications : parsed.certifications;
  const foodContact = structured.foodContactRequired ?? parsed.foodContactRequired;
  const city = structured.city ?? parsed.delivery?.city ?? null;
  const postalCode = structured.postalCode ?? parsed.delivery?.postalCode ?? undefined;
  const country = structured.country ?? parsed.delivery?.country ?? 'IN';
  const currency = structured.currency ?? parsed.budget?.currency ?? input.defaultCurrency;
  const budgetAmount = structured.budgetAmount ?? parsed.budget?.maxAmount ?? null;
  const budgetScope = structured.budgetScope ?? parsed.budget?.scope ?? 'merchandise';

  // ── Deadline ──────────────────────────────────────────────────────────────
  const deadlineText = structured.deadlineText ?? parsed.deadlinePhrase ?? null;
  let deadline: ResolvedDeadline | null = null;

  if (deadlineText) {
    deadline = resolveDeadline(deadlineText, timezone, now);
    if (!deadline) {
      clarifications.push({
        question: `We could not read "${deadlineText}" as a date. What is the required arrival date?`,
        reason: 'Delivery lead times are checked against this date, so it decides which suppliers qualify.',
      });
    } else if (deadline.ambiguous) {
      warnings.push(deadline.explanation);
    }
  }

  if (deadline) {
    const today = todayInZone(timezone, now);
    if (deadline.isoDate < today) {
      warnings.push(
        `The resolved date ${deadline.display} is in the past. Check the deadline before starting research.`,
      );
    }
  }

  const softened = new Set(structured.softenedKinds ?? []);
  const priorityFor = (kind: string) =>
    softened.has(kind) ? ('preference' as const) : ('must_have' as const);

  const requirements: NormalizedBrief['requirements'] = [];
  const push = (kind: Requirement['kind'], label: string, spec: RequirementSpec, priority = priorityFor(kind)) =>
    requirements.push({ kind, priority, label, spec });

  // ── Hard requirements ─────────────────────────────────────────────────────

  if (units) {
    push('quantity', `${units} units required`, { kind: 'quantity', units, partialOk });
  } else {
    clarifications.push({
      question: 'How many units do you need?',
      reason: 'Pack sizes, minimum orders and comparable costs all depend on the quantity.',
    });
  }

  if (dimensions) {
    const surface = dimensions.surface === 'unspecified' ? 'external' : dimensions.surface;
    if (dimensions.surface === 'unspecified') {
      warnings.push(
        'Dimensions were read as external measurements. If you meant the internal (usable) size, change it before research — the two are not interchangeable.',
      );
    }
    push(
      'dimensions',
      `${dimensions.length} x ${dimensions.width} x ${dimensions.height} ${dimensions.unit} (${surface})`,
      {
        kind: 'dimensions',
        length: dimensions.length,
        width: dimensions.width,
        height: dimensions.height,
        unit: dimensions.unit,
        surface,
        tolerancePct: DEFAULT_TOLERANCE_PCT,
      },
    );
  }

  if (foodContact || certs.length) {
    push(
      'certification',
      certs.length
        ? `Food-contact suitability (${certs.join(', ')})`
        : 'Suitable for direct food contact',
      { kind: 'certification', keywords: certs, foodContact: Boolean(foodContact) },
    );
  }

  if (city) {
    push('delivery_location', `Deliver to ${city}${postalCode ? ` ${postalCode}` : ''}`, {
      kind: 'delivery_location',
      city,
      postalCode,
      country,
    });
  }

  if (deadline) {
    push('delivery_date', `Arrive by ${deadline.display}`, {
      kind: 'delivery_date',
      isoDate: deadline.isoDate,
      timezone,
    });
  }

  if (budgetAmount) {
    push('budget', `Budget ${currency} ${budgetAmount.toLocaleString('en-IN')}`, {
      kind: 'budget',
      maxAmount: budgetAmount,
      currency,
      scope: budgetScope,
    });
  }

  // ── Preferences ───────────────────────────────────────────────────────────
  // Materials are a preference unless the user explicitly marked them a must:
  // rejecting a compliant box for saying "paperboard" instead of "kraft" would
  // discard good options over vocabulary.

  if (materials.length) {
    requirements.push({
      kind: 'material',
      priority: softened.has('material') ? 'preference' : 'must_have',
      label: `Material: ${materials.join(' or ')}`,
      spec: { kind: 'material', keywords: materials },
    });
  }

  const prefs = structured.preferences?.length ? structured.preferences : parsed.preferences;
  for (const p of prefs) {
    requirements.push({
      kind: 'other',
      priority: 'preference',
      label: p,
      spec: { kind: 'other', text: p },
    });
  }

  return {
    title: parsed.title || structured.productName || 'Sourcing case',
    deadline,
    requirements,
    // Never ask about something the user already supplied.
    clarifications: dedupeClarifications(clarifications, { units, dimensions, city, deadline }),
    warnings,
  };
}

function dedupeClarifications(
  list: Array<{ question: string; reason: string }>,
  known: { units: number | null; dimensions: unknown; city: string | null; deadline: unknown },
): Array<{ question: string; reason: string }> {
  const seen = new Set<string>();
  return list.filter((c) => {
    const q = c.question.toLowerCase();
    if (known.units && /how many|quantity/.test(q)) return false;
    if (known.dimensions && /dimension|size|measure/.test(q)) return false;
    if (known.city && /where|deliver|city|address/.test(q)) return false;
    if (known.deadline && /when|date|deadline|by what/.test(q)) return false;

    const key = q.replace(/\W+/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One-line summary of the brief, used for search planning and memory recall. */
export function summarizeBrief(reqs: Array<{ label: string; priority: string }>, title: string): string {
  const musts = reqs.filter((r) => r.priority === 'must_have').map((r) => r.label);
  const prefs = reqs.filter((r) => r.priority === 'preference').map((r) => r.label);
  return [
    title,
    musts.length ? `Must have: ${musts.join('; ')}` : '',
    prefs.length ? `Prefer: ${prefs.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
