import type { AppConfig } from '../config/load';
import type { Db } from '../db/sqlite';
import { getDb } from '../db/client';
import { sendIdempotencyKey } from '../db/ids';
import * as repo from '../db/repo';
import { formatMoney } from '../domain/costing';
import { formatDimensions } from '../domain/units';
import { createReasoningProvider } from '../providers/reasoning';
import { createEmailProvider, isValidEmail } from '../providers/email';
import { QuoteDraftSchema, zodValidator } from '../providers/reasoning/schemas';
import { QUOTE_SYSTEM, quoteUserPrompt } from './prompts';
import { log } from '../security/redact';
import type { CandidateProduct, QuoteDraft } from '../domain/types';

/**
 * Outreach: drafting requests for quote, and sending approved ones.
 *
 * The safety properties here are the ones that matter most in the whole system,
 * because this is the only step that acts on the outside world:
 *
 *   - A recipient address is never invented. It is either sourced from the page
 *     we read (and labelled as such) or typed by the user.
 *   - A send requires a live approval pinned to the exact content being sent.
 *   - A send is idempotent. The same approval can never produce two emails.
 *   - An ambiguous result is recorded as unknown and never retried automatically.
 */

// ── Drafting ────────────────────────────────────────────────────────────────

export async function draftQuotesForCase(
  caseId: string,
  candidateIds: string[],
  deps: { cfg: AppConfig; db?: Db },
): Promise<QuoteDraft[]> {
  const db = deps.db ?? getDb();
  const sourcingCase = repo.getCase(caseId, db);
  if (!sourcingCase) throw new Error('Case not found');

  const profile = repo.getOrCreateProfile(db);
  const requirements = repo.listRequirements(caseId, db);
  const evaluations = repo.listEvaluations(caseId, db);
  const reasoning = createReasoningProvider(deps.cfg, sourcingCase.mode);

  const quantity = requirements.find((r) => r.spec.kind === 'quantity')?.spec as
    | { units: number }
    | undefined;
  const dimensions = requirements.find((r) => r.spec.kind === 'dimensions')?.spec as any;
  const location = requirements.find((r) => r.spec.kind === 'delivery_location')?.spec as any;

  const drafts: QuoteDraft[] = [];

  for (const candidateId of candidateIds) {
    const candidate = repo.getCandidate(candidateId, db);
    if (!candidate || candidate.caseId !== caseId) continue;

    // The questions that make this email worth sending: everything the page
    // left unresolved for this specific supplier.
    const unknowns = evaluations
      .filter((e) => e.candidateId === candidateId && e.outcome === 'unknown')
      .map((e) => e.explanation);

    const specs = [
      dimensions
        ? `${dimensions.length} x ${dimensions.width} x ${dimensions.height} ${dimensions.unit} (${dimensions.surface})`
        : null,
      candidate.material ? `material similar to ${candidate.material}` : null,
      requirements.find((r) => r.spec.kind === 'certification')
        ? 'suitable for direct food contact'
        : null,
    ]
      .filter(Boolean)
      .join('; ');

    const destination = location
      ? `${location.city}${location.postalCode ? ` ${location.postalCode}` : ''}, ${location.country}`
      : `${profile.city} ${profile.postalCode}`.trim();

    let subject: string;
    let body: string;
    let questions: string[];

    try {
      const result = await reasoning.complete({
        task: 'draft_quote',
        system: QUOTE_SYSTEM,
        user: quoteUserPrompt({
          supplier: candidate.supplierName,
          product: candidate.productTitle,
          sourceUrl: candidate.sourceUrl,
          quantity: quantity ? `${quantity.units} units` : 'to be confirmed',
          specs,
          destination,
          deadline: sourcingCase.resolvedDeadline
            ? `${sourcingCase.resolvedDeadline} (${sourcingCase.timezone})`
            : 'as soon as possible',
          unknowns,
          business: profile.businessName,
        }),
        schemaName: 'QuoteDraft',
        validate: zodValidator(QuoteDraftSchema),
        maxTokens: 1500,
      });
      ({ subject, body, questions } = result.value);
    } catch (err) {
      log.warn('Quote drafting failed, using the structured template', {
        error: (err as Error).message,
      });
      ({ subject, body, questions } = templateQuote({
        candidate,
        business: profile.businessName,
        quantity: quantity?.units ?? null,
        specs,
        destination,
        deadline: sourcingCase.resolvedDeadline,
        unknowns,
      }));
    }

    // Contact address: sourced from the page, or left blank for the user. It is
    // never guessed from the domain — a wrong address means a real stranger
    // receives a business enquiry.
    const sourced = findContactEmail(candidate, db);

    drafts.push(
      repo.createDraft(
        {
          caseId,
          candidateId,
          supplierName: candidate.supplierName,
          recipientEmail: sourced?.email ?? null,
          recipientSource: sourced ? 'sourced_from_page' : null,
          recipientSourceUrl: sourced?.url ?? null,
          subject,
          body: appendCaseReference(body, sourcingCase.reference),
          status: 'draft',
          questions,
        },
        db,
      ),
    );
  }

  if (drafts.length) repo.setCaseState(caseId, 'OUTREACH_DRAFTED', db);
  return drafts;
}

/**
 * Look for a contact address in the evidence we actually retrieved.
 * Returns null rather than constructing something like info@<domain>.
 */
function findContactEmail(
  candidate: CandidateProduct,
  db: Db,
): { email: string; url: string } | null {
  const evidence = repo.listEvidence(candidate.caseId, candidate.id, db);

  // Prefer the dedicated contact-email evidence row, then fall back to an
  // address that appeared in any other excerpt we retrieved.
  const ordered = [
    ...evidence.filter((e) => e.factPath === 'contactEmail'),
    ...evidence.filter((e) => e.factPath !== 'contactEmail'),
  ];

  for (const e of ordered) {
    const haystack = `${e.interpretation ?? ''} ${e.excerpt ?? ''}`;
    const match = haystack.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (match && isValidEmail(match[0])) {
      return { email: match[0], url: e.sourceUrl ?? candidate.sourceUrl };
    }
  }
  return null;
}

function appendCaseReference(body: string, reference: string): string {
  return `${body}\n\nOur reference: ${reference}`;
}

/** Deterministic fallback draft, used when the model is unavailable. */
function templateQuote(args: {
  candidate: CandidateProduct;
  business: string;
  quantity: number | null;
  specs: string;
  destination: string;
  deadline: string | null;
  unknowns: string[];
}): { subject: string; body: string; questions: string[] } {
  const { candidate, business, quantity, specs, destination, deadline, unknowns } = args;

  const questions = [
    ...unknowns.map((u) => `Please confirm: ${u}`),
    'What is the total delivered price including shipping and applicable taxes?',
    'What is your dispatch lead time, and the expected delivery date to our address?',
    'Can you provide documentation supporting food-contact suitability?',
  ];

  const costLine = candidate.costing
    ? `Your listing shows ${formatMoney(candidate.pricePerPack)} per pack of ${candidate.costing.unitsPerPack}, which would be ${candidate.costing.packsNeeded} packs for our requirement.`
    : '';

  const body = [
    `Hello ${candidate.supplierName},`,
    '',
    `I am writing from ${business}. Our regular supplier has fallen through and we need a replacement quickly.`,
    '',
    `We are enquiring about: ${candidate.productTitle}`,
    `Listing reviewed: ${candidate.sourceUrl}`,
    '',
    'Our requirement:',
    quantity ? `- Quantity: ${quantity} units` : '',
    specs ? `- Specification: ${specs}` : '',
    `- Delivery to: ${destination}`,
    deadline ? `- Required arrival: on or before ${deadline}` : '',
    '',
    costLine,
    '',
    'Could you please confirm:',
    ...questions.map((q, i) => `${i + 1}. ${q}`),
    '',
    'If you can meet this date, please send a formal quotation with your payment terms.',
    '',
    'Thank you for your time.',
    business,
  ]
    .filter((l) => l !== '')
    .join('\n');

  return {
    subject: `Request for quotation — ${candidate.productTitle}`.slice(0, 160),
    body,
    questions: questions.slice(0, 8),
  };
}

// ── Sending ─────────────────────────────────────────────────────────────────

export interface SendResult {
  ok: boolean;
  status: QuoteDraft['status'];
  message: string;
  attemptId?: string;
  duplicate?: boolean;
}

/**
 * Send one approved draft.
 *
 * Every guard is re-checked at send time against the database, not against
 * whatever the client believed when it made the request.
 */
export async function sendApprovedDraft(
  draftId: string,
  deps: { cfg: AppConfig; db?: Db },
): Promise<SendResult> {
  const db = deps.db ?? getDb();
  const draft = repo.getDraft(draftId, db);
  if (!draft) return { ok: false, status: 'failed', message: 'Draft not found.' };

  const approval = repo.getLiveApproval(draftId, db);
  if (!approval) {
    return {
      ok: false,
      status: 'draft',
      message: 'This draft has no current approval. Review it and approve before sending.',
    };
  }

  // The approval signs an exact content hash. If the draft changed since, the
  // approval does not authorise what would now be sent.
  if (approval.contentHash !== draft.contentHash || approval.draftVersion !== draft.version) {
    return {
      ok: false,
      status: 'draft',
      message: 'The draft changed after it was approved. Review and approve the new version.',
    };
  }

  if (!draft.recipientEmail || !isValidEmail(draft.recipientEmail)) {
    return { ok: false, status: 'failed', message: 'The recipient address is missing or invalid.' };
  }
  if (draft.recipientEmail.toLowerCase() !== approval.recipientEmail.toLowerCase()) {
    return {
      ok: false,
      status: 'draft',
      message: 'The recipient changed after approval. Approve again to confirm the new address.',
    };
  }

  const email = createEmailProvider(deps.cfg);

  // Idempotency: derived from the approval and its content, so a double-click,
  // a browser retry and a worker restart all collapse to one send.
  const key = sendIdempotencyKey(approval.id, draft.contentHash);
  const { attempt, alreadyExisted } = repo.claimSendAttempt(
    {
      caseId: draft.caseId,
      draftId: draft.id,
      approvalId: approval.id,
      idempotencyKey: key,
      providerKind: email.kind,
    },
    db,
  );

  if (alreadyExisted) {
    return {
      ok: attempt.status === 'accepted',
      status: statusForAttempt(attempt.status),
      duplicate: true,
      attemptId: attempt.id,
      message:
        attempt.status === 'accepted'
          ? 'This request was already sent. It has not been sent again.'
          : attempt.status === 'unknown'
            ? 'A previous attempt had an uncertain outcome. Check the recipient inbox before retrying; we will not resend automatically.'
            : `A previous attempt finished with status "${attempt.status}". It has not been repeated.`,
    };
  }

  repo.setDraftStatus(draftId, 'sending', db);
  repo.setCaseState(draft.caseId, 'SENDING', db);

  const result = await email.send(
    {
      to: draft.recipientEmail,
      subject: draft.subject,
      body: draft.body,
      replyTo: deps.cfg.email.replyTo || undefined,
    },
    key,
  );

  if (result.status === 'accepted') {
    repo.completeSendAttempt(
      attempt.id,
      {
        status: 'accepted',
        providerMessageId: result.providerMessageId,
        providerResponse: result.response,
      },
      db,
    );
    repo.setDraftStatus(draftId, 'accepted_by_provider', db);
    maybeCompleteCase(draft.caseId, db);
    return {
      ok: true,
      status: 'accepted_by_provider',
      attemptId: attempt.id,
      // Deliberately not "delivered" — we have no evidence of that.
      message: `Accepted by ${email.kind} for delivery. Acceptance is not confirmation of delivery.`,
    };
  }

  if (result.status === 'unknown') {
    repo.completeSendAttempt(attempt.id, { status: 'unknown', error: result.detail }, db);
    repo.setDraftStatus(draftId, 'delivery_unknown', db);
    maybeCompleteCase(draft.caseId, db);
    return {
      ok: false,
      status: 'delivery_unknown',
      attemptId: attempt.id,
      message: `Outcome unknown: ${result.detail}`,
    };
  }

  repo.completeSendAttempt(attempt.id, { status: 'failed', error: result.error }, db);
  repo.setDraftStatus(draftId, 'failed', db);
  maybeCompleteCase(draft.caseId, db);
  return { ok: false, status: 'failed', attemptId: attempt.id, message: result.error };
}

function statusForAttempt(s: string): QuoteDraft['status'] {
  if (s === 'accepted') return 'accepted_by_provider';
  if (s === 'unknown') return 'delivery_unknown';
  if (s === 'sending') return 'sending';
  return 'failed';
}

/**
 * Move the case on once nothing is still in flight.
 *
 * "Outreach complete" means the outreach stage finished — not that supply has
 * been secured. That distinction is preserved in the UI copy as well.
 */
function maybeCompleteCase(caseId: string, db: Db): void {
  const drafts = repo.listDrafts(caseId, db);
  const pending = drafts.filter((d) => d.status === 'sending' || d.status === 'approved');
  if (pending.length) return;

  const anyResolved = drafts.some((d) =>
    ['accepted_by_provider', 'failed', 'delivery_unknown'].includes(d.status),
  );
  if (anyResolved) repo.setCaseState(caseId, 'OUTREACH_COMPLETE', db);
}
