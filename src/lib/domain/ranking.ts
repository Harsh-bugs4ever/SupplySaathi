import type { CandidateProduct, ConstraintOutcome } from './types';
import type { EvaluationResult } from './constraints';

/**
 * Transparent ranking.
 *
 * There is no confidence percentage here on purpose. A number like "87% match"
 * looks authoritative and means nothing; a buyer cannot act on it. Instead the
 * ordering follows a fixed, explainable lexicographic rule, and every card
 * carries the sentence that justifies its position.
 *
 * Order of precedence:
 *   1. No confirmed hard-constraint failures
 *   2. More hard constraints actually supported by evidence
 *   3. Fewer unresolved critical questions
 *   4. Lower comparable known cost
 *   5. Better fit with stated preferences
 */

export interface RankingInput {
  candidate: CandidateProduct;
  evaluations: EvaluationResult[];
}

export interface RankedCandidate extends RankingInput {
  score: number;
  /** The sentence shown under the candidate explaining where it placed. */
  explanation: string;
}

function count(evals: EvaluationResult[], outcome: ConstraintOutcome, hardOnly = true): number {
  return evals.filter(
    (e) => e.outcome === outcome && (!hardOnly || e.priority === 'must_have'),
  ).length;
}

export function rankCandidates(inputs: RankingInput[]): RankedCandidate[] {
  const ranked = inputs.map((input) => {
    const { evaluations } = input;
    const hardFailures = count(evaluations, 'failed');
    const hardMet = count(evaluations, 'met');
    const hardUnknown = count(evaluations, 'unknown');
    const prefsMet = evaluations.filter(
      (e) => e.priority === 'preference' && e.outcome === 'met',
    ).length;

    return {
      ...input,
      hardFailures,
      hardMet,
      hardUnknown,
      prefsMet,
      cost: input.candidate.costing?.merchandiseSubtotal.amount ?? Number.POSITIVE_INFINITY,
      currency: input.candidate.costing?.merchandiseSubtotal.currency ?? null,
      score: 0,
      explanation: '',
    };
  });

  ranked.sort((a, b) => {
    if (a.hardFailures !== b.hardFailures) return a.hardFailures - b.hardFailures;
    if (a.hardMet !== b.hardMet) return b.hardMet - a.hardMet;
    if (a.hardUnknown !== b.hardUnknown) return a.hardUnknown - b.hardUnknown;
    if (a.cost !== b.cost) return a.cost - b.cost;
    if (a.prefsMet !== b.prefsMet) return b.prefsMet - a.prefsMet;
    return a.candidate.supplierName.localeCompare(b.candidate.supplierName);
  });

  return ranked.map((r, i) => ({
    candidate: r.candidate,
    evaluations: r.evaluations,
    // Descending score purely so the UI can sort without re-deriving the rule.
    score: ranked.length - i,
    explanation: explain(r),
  }));
}

function explain(r: {
  hardFailures: number;
  hardMet: number;
  hardUnknown: number;
  prefsMet: number;
}): string {
  if (r.hardFailures > 0) {
    return `Excluded: ${r.hardFailures} requirement${r.hardFailures === 1 ? '' : 's'} confirmed unmet.`;
  }
  const parts: string[] = [`${r.hardMet} requirement${r.hardMet === 1 ? '' : 's'} confirmed by evidence`];
  if (r.hardUnknown > 0) {
    parts.push(`${r.hardUnknown} still unconfirmed`);
  } else {
    parts.push('nothing outstanding');
  }
  if (r.prefsMet > 0) parts.push(`${r.prefsMet} preference${r.prefsMet === 1 ? '' : 's'} matched`);
  return `${parts.join(', ')}.`;
}

/**
 * The qualified headline for the cheapest option.
 *
 * We never print "Best supplier". The claim has to name the comparison set and
 * the cost basis, or it is not a claim a buyer can check.
 */
export function lowestCostHeadline(ranked: RankedCandidate[]): string | null {
  const eligible = ranked.filter(
    (r) =>
      r.candidate.status !== 'does_not_meet' &&
      r.candidate.status !== 'retrieval_failed' &&
      r.candidate.costing !== null,
  );
  if (eligible.length < 1) return null;

  const currencies = new Set(eligible.map((e) => e.candidate.costing!.merchandiseSubtotal.currency));
  if (currencies.size > 1) {
    return 'Costs span more than one currency and are not directly comparable.';
  }

  const cheapest = eligible.reduce((a, b) =>
    b.candidate.costing!.merchandiseSubtotal.amount < a.candidate.costing!.merchandiseSubtotal.amount
      ? b
      : a,
  );

  const dimensionallyConfirmed = eligible.every((e) =>
    e.evaluations.some((ev) => ev.requirementLabel.toLowerCase().includes('dimension') && ev.outcome === 'met'),
  );

  const basis = dimensionallyConfirmed
    ? 'among candidates matching the documented dimensions'
    : `among the ${eligible.length} candidate${eligible.length === 1 ? '' : 's'} not excluded`;

  return `${cheapest.candidate.supplierName} has the lowest known merchandise cost ${basis}. Shipping and tax are not included.`;
}

/**
 * Critical open questions across the shortlist, deduplicated, for the
 * "important unknowns" panel and for seeding the quote requests.
 */
export function collectOpenQuestions(ranked: RankedCandidate[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of ranked) {
    if (r.candidate.status === 'does_not_meet') continue;
    for (const e of r.evaluations) {
      if (e.outcome !== 'unknown' || e.priority !== 'must_have') continue;
      const key = e.requirementLabel.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e.requirementLabel);
    }
  }
  return out;
}
