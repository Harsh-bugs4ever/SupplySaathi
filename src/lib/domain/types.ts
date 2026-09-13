/**
 * Domain vocabulary for SupplySaathi.
 *
 * The single most important distinction in this file is between four kinds of
 * information, which the UI must never blur together:
 *
 *   RETRIEVED    a fact literally present on a page we fetched      (Evidence)
 *   DERIVED      arithmetic we performed in code from retrieved values
 *   INTERPRETED  a model's reading of ambiguous page text
 *   CONFIRMED    something the user told us directly
 */

// -- Case lifecycle ----------------------------------------------------------

export const CASE_STATES = [
  'DRAFT',
  'NEEDS_CLARIFICATION',
  'RESEARCHING',
  'EVALUATING',
  'SHORTLIST_READY',
  'OUTREACH_DRAFTED',
  'AWAITING_APPROVAL',
  'SENDING',
  'OUTREACH_COMPLETE',
  'PARTIAL_RESULTS',
  'FAILED',
  'CANCELLED',
] as const;
export type CaseState = (typeof CASE_STATES)[number];

/** States from which the agent will not advance on its own. */
export const RESTING_STATES: CaseState[] = [
  'DRAFT',
  'NEEDS_CLARIFICATION',
  'SHORTLIST_READY',
  'OUTREACH_DRAFTED',
  'AWAITING_APPROVAL',
  'OUTREACH_COMPLETE',
  'PARTIAL_RESULTS',
  'FAILED',
  'CANCELLED',
];

// -- Requirements ------------------------------------------------------------

export type RequirementKind =
  | 'quantity'
  | 'dimensions'
  | 'material'
  | 'certification'
  | 'delivery_location'
  | 'delivery_date'
  | 'budget'
  | 'other';

/** A hard requirement can fail a candidate outright; a preference only ranks it. */
export type RequirementPriority = 'must_have' | 'preference';

export type LengthUnit = 'mm' | 'cm' | 'in';
export type DimensionSurface = 'external' | 'internal' | 'unspecified';
/** Whether the budget covers goods alone or the landed cost. */
export type BudgetScope = 'merchandise' | 'landed';

export type RequirementSpec =
  | { kind: 'quantity'; units: number; partialOk: boolean }
  | {
      kind: 'dimensions';
      length: number;
      width: number;
      height: number;
      unit: LengthUnit;
      /** Which surface the numbers describe. Never assume these are equivalent. */
      surface: DimensionSurface;
      tolerancePct: number;
    }
  | { kind: 'material'; keywords: string[] }
  | { kind: 'certification'; keywords: string[]; foodContact: boolean }
  | { kind: 'delivery_location'; city: string; postalCode?: string; country: string }
  | { kind: 'delivery_date'; isoDate: string; timezone: string }
  | { kind: 'budget'; maxAmount: number; currency: string; scope: BudgetScope }
  | { kind: 'other'; text: string };

export interface Requirement {
  id: string;
  caseId: string;
  kind: RequirementKind;
  priority: RequirementPriority;
  /** Human-readable statement, e.g. "Outer box 10 x 10 x 5 in". */
  label: string;
  /** Machine-checkable payload; shape depends on `kind`. */
  spec: RequirementSpec;
  createdAt: string;
}

// -- Evidence ----------------------------------------------------------------

export type EvidenceStatus =
  /** The page says this in so many words. */
  | 'explicitly_stated'
  /** We computed it from values the page stated explicitly. */
  | 'derived'
  /** We looked and could not find it. Not the same as "no". */
  | 'unknown'
  /** Two sources, or two parts of one page, disagree. */
  | 'conflicting';

/** Who is vouching for a fact. A vendor saying "food safe" is not verification. */
export type EvidenceAuthority =
  | 'supplier_claim'
  | 'independent'
  | 'user_provided'
  | 'computed';

export interface Evidence {
  id: string;
  caseId: string;
  candidateId: string | null;
  /** Dotted path of the fact this supports, e.g. "dimensions.external". */
  factPath: string;
  status: EvidenceStatus;
  authority: EvidenceAuthority;
  sourceUrl: string | null;
  /** Verbatim excerpt, size-bounded and stripped of markup. */
  excerpt: string | null;
  /** How we read that excerpt. Model interpretation lives here, not in `excerpt`. */
  interpretation: string | null;
  retrievedAt: string | null;
  createdAt: string;
}

// -- Candidates --------------------------------------------------------------

export type CandidateStatus =
  /** Every hard requirement supported by evidence. */
  | 'verified_match'
  /** Nothing failed, but something material is unknown. */
  | 'potential_match'
  /** At least one hard requirement confirmed failed. */
  | 'does_not_meet'
  /** We could not read the page. Says nothing about the product itself. */
  | 'retrieval_failed';

export interface MoneyAmount {
  amount: number;
  currency: string;
}

export interface ExtractedDimensions {
  length: number;
  width: number;
  height: number;
  unit: LengthUnit;
  surface: DimensionSurface;
}

/** Everything here is computed by lib/domain/costing.ts, never by a model. */
export interface Costing {
  requiredUnits: number;
  unitsPerPack: number;
  /** ceil(requiredUnits / unitsPerPack), then raised to meet MOQ and increment. */
  packsNeeded: number;
  packsBeforeMinimums: number;
  purchasedUnits: number;
  /** Units bought over and above what was asked for, due to pack/MOQ rounding. */
  overageUnits: number;
  merchandiseSubtotal: MoneyAmount;
  /** Non-null only when shipping AND tax are both known. */
  landedTotal: MoneyAmount | null;
  shippingStatus: 'known' | 'unknown' | 'free_stated' | 'quote_required';
  taxStatus: 'known' | 'unknown' | 'inclusive_stated';
  minOrderApplied: boolean;
  incrementApplied: boolean;
  notes: string[];
}

export interface CandidateProduct {
  id: string;
  caseId: string;
  runId: string;
  supplierName: string;
  productTitle: string;
  sourceUrl: string;
  imageUrl: string | null;
  retrievedAt: string | null;
  status: CandidateStatus;

  // Retrieved facts. null means unknown, which is never treated as zero.
  unitsPerPack: number | null;
  pricePerPack: MoneyAmount | null;
  minOrderPacks: number | null;
  orderIncrementPacks: number | null;
  dimensions: ExtractedDimensions | null;
  material: string | null;
  foodContactClaim: string | null;
  shippingInfo: string | null;
  leadTimeInfo: string | null;
  currency: string | null;

  // Derived in code, never by the model.
  costing: Costing | null;

  /** One sentence saying why this is in or out. Shown verbatim in the UI. */
  rationale: string;
  rankScore: number | null;
  /** Stable key used to collapse the same product found twice. */
  dedupeKey: string;
  createdAt: string;
}

// -- Constraint evaluation ---------------------------------------------------

/**
 * `unknown` is deliberately distinct from `failed`. A product we cannot confirm
 * is a question to ask a supplier; a product we know is wrong is excluded.
 */
export type ConstraintOutcome = 'met' | 'failed' | 'unknown' | 'not_applicable';

export interface ConstraintEvaluation {
  id: string;
  caseId: string;
  candidateId: string;
  requirementId: string;
  requirementLabel: string;
  priority: RequirementPriority;
  outcome: ConstraintOutcome;
  /** Plain-language explanation shown on the candidate card. */
  explanation: string;
  evidenceIds: string[];
  createdAt: string;
}

// -- Research run and events -------------------------------------------------

export type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'cancelled';

export interface ResearchRun {
  id: string;
  caseId: string;
  status: RunStatus;
  mode: 'demo' | 'live';
  round: number;
  pagesFetched: number;
  pagesFailed: number;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequested: boolean;
  error: string | null;
  createdAt: string;
}

export type ResearchEventKind =
  | 'plan'
  | 'search'
  | 'fetch'
  | 'fetch_failed'
  | 'extract'
  | 'evaluate'
  | 'exclude'
  | 'question'
  | 'memory'
  | 'status'
  | 'warning'
  | 'error';

export interface ResearchEvent {
  id: string;
  caseId: string;
  runId: string;
  seq: number;
  kind: ResearchEventKind;
  /** User-facing sentence. Real actions and findings only, never filler. */
  message: string;
  detail: string | null;
  candidateId: string | null;
  createdAt: string;
}

// -- Outreach ----------------------------------------------------------------

export type DraftStatus =
  | 'draft'
  | 'approved'
  | 'sending'
  | 'accepted_by_provider'
  | 'failed'
  | 'delivery_unknown'
  | 'exported';

export interface QuoteDraft {
  id: string;
  caseId: string;
  candidateId: string;
  supplierName: string;
  recipientEmail: string | null;
  /** Where the address came from. We never invent one. */
  recipientSource: 'user_entered' | 'sourced_from_page' | null;
  recipientSourceUrl: string | null;
  subject: string;
  body: string;
  /** Bumped on every edit. Approvals pin an exact version. */
  version: number;
  /** SHA-256 over recipient, subject and body. This is what approval signs. */
  contentHash: string;
  status: DraftStatus;
  questions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OutreachApproval {
  id: string;
  caseId: string;
  draftId: string;
  draftVersion: number;
  contentHash: string;
  recipientEmail: string;
  approvedAt: string;
  /** Set when a later edit made this approval stale. */
  invalidatedAt: string | null;
  invalidationReason: string | null;
}

export type EmailAttemptStatus = 'sending' | 'accepted' | 'failed' | 'unknown';

export interface EmailAttempt {
  id: string;
  caseId: string;
  draftId: string;
  approvalId: string;
  /** Idempotency key. A repeat with the same key never sends twice. */
  idempotencyKey: string;
  status: EmailAttemptStatus;
  providerKind: string;
  providerMessageId: string | null;
  providerResponse: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

// -- Business profile and memory ---------------------------------------------

export interface BusinessProfile {
  id: string;
  businessName: string;
  city: string;
  postalCode: string;
  country: string;
  currency: string;
  timezone: string;
  contactEmail: string;
  createdAt: string;
  updatedAt: string;
}

export type MemoryKind = 'preference' | 'supplier_note' | 'rejection_reason';

export interface SupplierNote {
  id: string;
  profileId: string;
  kind: MemoryKind;
  supplierName: string | null;
  text: string;
  caseId: string | null;
  /** Mirrored into Cognee when available; the DB row stays authoritative. */
  syncedToMemory: boolean;
  createdAt: string;
}

// -- Sourcing case -----------------------------------------------------------

export interface ClarificationQuestion {
  id: string;
  question: string;
  /** Why this changes the search. We only ask questions that do. */
  reason: string;
  answer: string | null;
  answeredAt: string | null;
}

export interface AppliedMemory {
  id: string;
  text: string;
  kind: MemoryKind;
  source: 'cognee' | 'local';
  /** The user can switch this off for one case without deleting the memory. */
  accepted: boolean;
}

export interface SourcingCase {
  id: string;
  /** Short human-quotable identifier, e.g. "SR-7K2M". */
  reference: string;
  profileId: string;
  title: string;
  briefText: string;
  originalProductUrl: string | null;
  state: CaseState;
  mode: 'demo' | 'live';
  /** "Friday" resolved to a date, shown to the user before research starts. */
  resolvedDeadline: string | null;
  deadlineSourcePhrase: string | null;
  timezone: string;
  currency: string;
  clarifications: ClarificationQuestion[];
  /** Memory that shaped this brief, so the user can see and override it. */
  appliedMemory: AppliedMemory[];
  createdAt: string;
  updatedAt: string;
}
