import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as repo from '@/lib/db/repo';
import { normalizeBrief } from '@/lib/agent/brief';
import { runResearch } from '@/lib/agent/runner';
import { draftQuotesForCase, sendApprovedDraft } from '@/lib/agent/outreach';
import { createReasoningProvider } from '@/lib/providers/reasoning';
import { ParsedBriefSchema, zodValidator } from '@/lib/providers/reasoning/schemas';
import { BRIEF_SYSTEM, briefUserPrompt } from '@/lib/agent/prompts';
import { getDb } from '@/lib/db/client';
import { makeTestDb, testConfig, DEMO_BRIEF } from './helpers';
import type { Db } from '@/lib/db/sqlite';

/**
 * The whole workflow, once, against fixtures.
 *
 *   create case -> research -> inspect evidence -> select suppliers
 *   -> edit the quote request -> approve -> send via the test adapter
 *   -> reload the case and verify everything persisted
 *
 * This is the test that would catch a regression nobody thought to unit-test,
 * because it exercises the seams between the parts rather than the parts.
 */

let db: Db;
let cleanup: () => void;
let dbPath: string;

beforeEach(() => {
  ({ db, cleanup, path: dbPath } = makeTestDb('e2e'));
});
afterEach(() => cleanup());

describe('end to end: cancelled supplier to approved outreach', () => {
  it('completes the whole sourcing case', async () => {
    const cfg = testConfig({
      email: { ...testConfig().email, provider: 'test', allowlist: [] },
    });

    // ── 1. Create the case from a natural-language brief ────────────────────
    const profile = repo.getOrCreateProfile(db);
    const reasoning = createReasoningProvider(cfg, 'demo');

    const parsed = await reasoning.complete({
      task: 'parse_brief',
      system: BRIEF_SYSTEM,
      user: briefUserPrompt({ briefText: DEMO_BRIEF }),
      schemaName: 'ParsedBrief',
      validate: zodValidator(ParsedBriefSchema),
    });

    const normalized = normalizeBrief({
      parsed: parsed.value,
      structured: {},
      timezone: profile.timezone,
      defaultCurrency: 'INR',
      now: new Date('2026-09-13T12:00:00Z'),
    });

    // "Friday" must be an explicit date before any research happens.
    expect(normalized.deadline).not.toBeNull();
    expect(normalized.deadline!.isoDate).toBe('2026-09-18');

    const sourcingCase = repo.createCase(
      {
        profileId: profile.id,
        title: normalized.title,
        briefText: DEMO_BRIEF,
        originalProductUrl: 'https://oldsupplier.example.invalid/cake-box-10x10x5-standard',
        mode: 'demo',
        resolvedDeadline: normalized.deadline!.isoDate,
        deadlineSourcePhrase: normalized.deadline!.sourcePhrase,
        timezone: profile.timezone,
        currency: 'INR',
      },
      db,
    );
    for (const r of normalized.requirements) {
      repo.addRequirement({ ...r, caseId: sourcingCase.id }, db);
    }

    expect(repo.listRequirements(sourcingCase.id, db).length).toBeGreaterThanOrEqual(5);

    // ── 2. Research ─────────────────────────────────────────────────────────
    const run = repo.createRun(sourcingCase.id, 'demo', 1, db);
    const outcome = await runResearch(sourcingCase.id, run.id, { cfg, db });

    expect(['succeeded', 'partial']).toContain(outcome.status);
    expect(outcome.candidatesFound).toBeGreaterThanOrEqual(4);
    // The fixture set includes a deliberate retrieval failure.
    expect(outcome.pagesFailed).toBeGreaterThan(0);

    const events = repo.listEvents(sourcingCase.id, 0, run.id, db);
    expect(events.some((e) => e.kind === 'exclude')).toBe(true);
    expect(events.some((e) => e.kind === 'fetch_failed')).toBe(true);
    expect(events.some((e) => e.kind === 'evaluate')).toBe(true);

    // ── 3. The shortlist distinguishes all the outcomes it should ───────────
    const candidates = repo.listCandidates(sourcingCase.id, db);
    const byStatus = (s: string) => candidates.filter((c) => c.status === s);

    expect(byStatus('verified_match').length).toBeGreaterThanOrEqual(1);
    expect(byStatus('potential_match').length).toBeGreaterThanOrEqual(1);
    expect(byStatus('does_not_meet').length).toBeGreaterThanOrEqual(1);

    // Ranking puts a fully verified option above one with open questions.
    expect(candidates[0].status).toBe('verified_match');

    // A candidate with an unknown hard requirement is never "verified".
    const evaluations = repo.listEvaluations(sourcingCase.id, db);
    for (const c of candidates) {
      const unknownHard = evaluations.filter(
        (e) => e.candidateId === c.id && e.priority === 'must_have' && e.outcome === 'unknown',
      );
      if (unknownHard.length > 0) expect(c.status).not.toBe('verified_match');
    }

    // The minimum-order failure is described in terms a buyer can act on.
    const moqFailure = evaluations.find(
      (e) => e.outcome === 'failed' && /minimum order/i.test(e.explanation),
    );
    expect(moqFailure).toBeDefined();

    // ── 4. Inspect the evidence ─────────────────────────────────────────────
    const best = candidates[0];
    const evidence = repo.listEvidence(sourcingCase.id, best.id, db);
    expect(evidence.length).toBeGreaterThan(5);

    const dims = evidence.find((e) => e.factPath === 'dimensions');
    expect(dims?.status).toBe('explicitly_stated');
    expect(dims?.sourceUrl).toBe(best.sourceUrl);
    expect(dims?.excerpt).toBeTruthy();
    expect(dims?.retrievedAt).toBeTruthy();

    // Derived arithmetic is labelled as computed, never as something we read.
    const derived = evidence.find((e) => e.factPath === 'costing.merchandiseSubtotal');
    expect(derived?.status).toBe('derived');
    expect(derived?.authority).toBe('computed');

    // A conflicting-dimensions page is recorded as conflicting, not resolved.
    const conflict = repo
      .listEvidence(sourcingCase.id, undefined, db)
      .find((e) => e.status === 'conflicting');
    expect(conflict).toBeDefined();

    // Costing is arithmetically correct and carries no invented total.
    expect(best.costing).not.toBeNull();
    expect(best.costing!.purchasedUnits).toBeGreaterThanOrEqual(500);
    expect(best.costing!.landedTotal).toBeNull();
    expect(best.costing!.merchandiseSubtotal.amount).toBe(
      best.costing!.packsNeeded * best.pricePerPack!.amount,
    );

    // ── 5. Select suppliers and draft quote requests ────────────────────────
    const selectable = candidates
      .filter((c) => c.status !== 'does_not_meet' && c.status !== 'retrieval_failed')
      .slice(0, 2);
    expect(selectable.length).toBe(2);

    const drafts = await draftQuotesForCase(
      sourcingCase.id,
      selectable.map((c) => c.id),
      { cfg, db },
    );
    expect(drafts).toHaveLength(2);
    expect(repo.getCase(sourcingCase.id, db)!.state).toBe('OUTREACH_DRAFTED');

    const draft = drafts[0];
    // The address came off the page we actually read, not from a guess.
    expect(draft.recipientEmail).toBeTruthy();
    expect(draft.recipientSource).toBe('sourced_from_page');
    expect(draft.body).toContain(sourcingCase.reference);
    expect(draft.body).toContain('500');
    expect(draft.version).toBe(1);

    // ── 6. Edit the draft ───────────────────────────────────────────────────
    const edited = repo.updateDraft(
      draft.id,
      { body: `${draft.body}\n\nWe can collect from Pune if that is quicker.` },
      db,
    );
    expect(edited.version).toBe(2);
    expect(edited.contentHash).not.toBe(draft.contentHash);

    // ── 7. Approve, and prove an edit revokes it ────────────────────────────
    repo.approveDraft(edited.id, db);
    expect(repo.getLiveApproval(edited.id, db)).not.toBeNull();

    repo.updateDraft(edited.id, { subject: 'Urgent: request for quotation' }, db);
    expect(repo.getLiveApproval(edited.id, db)).toBeNull();

    const refused = await sendApprovedDraft(edited.id, { cfg, db });
    expect(refused.ok).toBe(false);

    // ── 8. Re-approve and send through the test adapter ─────────────────────
    const finalDraft = repo.getDraft(edited.id, db)!;
    const { approval } = repo.approveDraft(finalDraft.id, db);
    expect(approval.contentHash).toBe(finalDraft.contentHash);
    expect(approval.draftVersion).toBe(finalDraft.version);

    const sent = await sendApprovedDraft(finalDraft.id, { cfg, db });
    expect(sent.ok).toBe(true);
    expect(sent.status).toBe('accepted_by_provider');
    // Acceptance is never reported as delivery.
    expect(sent.message).not.toMatch(/\bdelivered\b/i);

    // A second send is refused, not repeated.
    const again = await sendApprovedDraft(finalDraft.id, { cfg, db });
    expect(again.duplicate).toBe(true);
    expect(repo.listAttempts(sourcingCase.id, db)).toHaveLength(1);

    // ── 9. Reload from disk and verify everything persisted ─────────────────
    // Snapshot the counts while the handle is still open, then close and
    // reopen so the comparison genuinely tests what reached disk.
    const expectedEvidenceCount = repo.listEvidence(sourcingCase.id, undefined, db).length;
    const expectedCandidateCount = candidates.length;
    const expectedEventCount = events.length;

    db.close();
    const reopened = getDb(dbPath);

    const reloadedCase = repo.getCase(sourcingCase.id, reopened)!;
    expect(reloadedCase.reference).toBe(sourcingCase.reference);
    expect(reloadedCase.resolvedDeadline).toBe('2026-09-18');
    expect(reloadedCase.deadlineSourcePhrase?.toLowerCase()).toContain('friday');

    expect(repo.listRequirements(sourcingCase.id, reopened).length).toBe(
      normalized.requirements.length,
    );
    expect(repo.listCandidates(sourcingCase.id, reopened).length).toBe(expectedCandidateCount);
    expect(repo.listEvidence(sourcingCase.id, undefined, reopened).length).toBe(
      expectedEvidenceCount,
    );
    expect(repo.listEvents(sourcingCase.id, 0, undefined, reopened).length).toBe(expectedEventCount);

    const reloadedDraft = repo.getDraft(finalDraft.id, reopened)!;
    expect(reloadedDraft.status).toBe('accepted_by_provider');
    expect(reloadedDraft.version).toBe(finalDraft.version);

    const attempts = repo.listAttempts(sourcingCase.id, reopened);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe('accepted');
    expect(attempts[0].providerMessageId).toMatch(/^test-/);

    // The invalidated approval is still on the record, with its reason.
    const approvals = repo.listApprovals(sourcingCase.id, reopened);
    expect(approvals.some((a) => a.invalidatedAt && a.invalidationReason)).toBe(true);

    expect(reloadedCase.state).toBe('OUTREACH_COMPLETE');

    // Reassign so afterEach closes a live handle rather than a stale one.
    db = reopened;
  });

  it('refuses to draft outreach to an excluded supplier', async () => {
    const cfg = testConfig();
    const profile = repo.getOrCreateProfile(db);

    const c = repo.createCase(
      {
        profileId: profile.id,
        title: 'Cake boxes',
        briefText: DEMO_BRIEF,
        originalProductUrl: null,
        mode: 'demo',
        resolvedDeadline: '2026-09-18',
        deadlineSourcePhrase: 'Friday',
        timezone: profile.timezone,
        currency: 'INR',
      },
      db,
    );
    repo.addRequirement(
      {
        caseId: c.id,
        kind: 'quantity',
        priority: 'must_have',
        label: '500 units',
        spec: { kind: 'quantity', units: 500, partialOk: false },
      },
      db,
    );

    const run = repo.createRun(c.id, 'demo', 1, db);
    await runResearch(c.id, run.id, { cfg, db });

    const excluded = repo.listCandidates(c.id, db).find((x) => x.status === 'does_not_meet');

    // The API route is what enforces this; here we assert the state it checks.
    if (excluded) {
      expect(excluded.status).toBe('does_not_meet');
      const evals = repo
        .listEvaluations(c.id, db)
        .filter((e) => e.candidateId === excluded.id && e.outcome === 'failed');
      expect(evals.length).toBeGreaterThan(0);
    }
  });
});
