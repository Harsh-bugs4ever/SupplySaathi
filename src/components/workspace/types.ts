import type {
  BusinessProfile,
  CandidateProduct,
  ConstraintEvaluation,
  EmailAttempt,
  Evidence,
  OutreachApproval,
  QuoteDraft,
  Requirement,
  ResearchEvent,
  ResearchRun,
  SourcingCase,
} from '@/lib/domain/types';

/** Exactly the shape `GET /api/cases/[id]` returns. */
export interface CaseSnapshot {
  case: SourcingCase;
  requirements: Requirement[];
  candidates: Array<CandidateProduct & { evaluations: ConstraintEvaluation[] }>;
  evidence: Evidence[];
  run: ResearchRun | null;
  events: ResearchEvent[];
  drafts: QuoteDraft[];
  approvals: OutreachApproval[];
  attempts: EmailAttempt[];
  profile: BusinessProfile;
}

export type CandidateWithEvals = CaseSnapshot['candidates'][number];

/** What the evidence drawer is currently showing. */
export interface EvidenceTarget {
  candidate: CandidateWithEvals;
  factPath?: string;
  title: string;
}
