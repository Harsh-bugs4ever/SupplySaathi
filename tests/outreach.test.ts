import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as repo from '@/lib/db/repo';
import { sendApprovedDraft } from '@/lib/agent/outreach';
import { TestEmailProvider } from '@/lib/providers/email/test';
import { draftContentHash, sendIdempotencyKey } from '@/lib/db/ids';
import { makeTestDb, testConfig } from './helpers';
import type { Db } from '@/lib/db/sqlite';

/**
 * Approval integrity and send idempotency.
 *
 * These protect the only part of the system that touches the outside world, so
 * they are tested at the level the API actually uses.
 */

let db: Db;
let cleanup: () => void;
let caseId: string;
let candidateId: string;

beforeEach(() => {
  ({ db, cleanup } = makeTestDb('outreach'));

  const profile = repo.getOrCreateProfile(db);
  const c = repo.createCase(
    {
      profileId: profile.id,
      title: 'Cake boxes',
      briefText: 'need boxes',
      originalProductUrl: null,
      mode: 'demo',
      resolvedDeadline: '2026-09-18',
      deadlineSourcePhrase: 'Friday',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    },
    db,
  );
  caseId = c.id;

  const cand = repo.upsertCandidate(
    {
      caseId,
      runId: 'run1',
      supplierName: 'BoxCraft',
      productTitle: 'Cake box',
      sourceUrl: 'https://boxcraft.example.invalid/p',
      imageUrl: null,
      retrievedAt: new Date().toISOString(),
      status: 'verified_match',
      unitsPerPack: 50,
      pricePerPack: { amount: 720, currency: 'INR' },
      minOrderPacks: null,
      orderIncrementPacks: null,
      dimensions: null,
      material: null,
      foodContactClaim: null,
      shippingInfo: null,
      leadTimeInfo: null,
      currency: 'INR',
      costing: null,
      rationale: '',
      rankScore: 1,
      dedupeKey: 'boxcraft.example.invalid/p',
    },
    db,
  );
  candidateId = cand.id;
});

afterEach(() => cleanup());

function makeDraft(recipient: string | null = 'sales@boxcraft.example.invalid') {
  return repo.createDraft(
    {
      caseId,
      candidateId,
      supplierName: 'BoxCraft',
      recipientEmail: recipient,
      recipientSource: recipient ? 'sourced_from_page' : null,
      recipientSourceUrl: null,
      subject: 'Request for quotation',
      body: 'Original body.',
      status: 'draft',
      questions: [],
    },
    db,
  );
}

describe('approval invalidation after edits', () => {
  it('invalidates an approval when the body changes', () => {
    const d = makeDraft();
    repo.approveDraft(d.id, db);
    expect(repo.getLiveApproval(d.id, db)).not.toBeNull();

    repo.updateDraft(d.id, { body: 'Changed body.' }, db);

    expect(repo.getLiveApproval(d.id, db)).toBeNull();
    expect(repo.getDraft(d.id, db)!.status).toBe('draft');
  });

  it('invalidates an approval when the recipient changes', () => {
    const d = makeDraft();
    repo.approveDraft(d.id, db);

    repo.updateDraft(d.id, { recipientEmail: 'someone-else@example.invalid' }, db);

    const approval = repo.getLiveApproval(d.id, db);
    expect(approval).toBeNull();
  });

  it('records why the approval was invalidated', () => {
    const d = makeDraft();
    repo.approveDraft(d.id, db);
    repo.updateDraft(d.id, { subject: 'A different subject' }, db);

    const all = repo.listApprovals(caseId, db);
    expect(all[0].invalidatedAt).not.toBeNull();
    expect(all[0].invalidationReason).toMatch(/subject/i);
  });

  it('leaves the approval intact when an edit changes nothing', () => {
    const d = makeDraft();
    repo.approveDraft(d.id, db);
    repo.updateDraft(d.id, { body: 'Original body.' }, db);

    expect(repo.getLiveApproval(d.id, db)).not.toBeNull();
  });

  it('bumps the version on every real edit', () => {
    const d = makeDraft();
    expect(d.version).toBe(1);
    const v2 = repo.updateDraft(d.id, { body: 'Second.' }, db);
    expect(v2.version).toBe(2);
    const v3 = repo.updateDraft(d.id, { body: 'Third.' }, db);
    expect(v3.version).toBe(3);
  });

  it('refuses to approve a draft with no recipient', () => {
    const d = makeDraft(null);
    expect(() => repo.approveDraft(d.id, db)).toThrow(/recipient/i);
  });

  it('supersedes an earlier approval when approving again', () => {
    const d = makeDraft();
    repo.approveDraft(d.id, db);
    repo.approveDraft(d.id, db);

    const live = repo.listApprovals(caseId, db).filter((a) => !a.invalidatedAt);
    expect(live).toHaveLength(1);
  });
});

describe('send guards', () => {
  it('refuses to send without an approval', async () => {
    const d = makeDraft();
    const res = await sendApprovedDraft(d.id, { cfg: testConfig(), db });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/no current approval/i);
  });

  it('refuses to send when the content changed after approval', async () => {
    const d = makeDraft();
    repo.approveDraft(d.id, db);
    repo.updateDraft(d.id, { body: 'Sneaky change.' }, db);

    const res = await sendApprovedDraft(d.id, { cfg: testConfig(), db });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/no current approval/i);
  });

  it('sends when a valid approval matches the content', async () => {
    const cfg = testConfig({ email: { ...testConfig().email, provider: 'test' } });
    const d = makeDraft();
    repo.approveDraft(d.id, db);

    const res = await sendApprovedDraft(d.id, { cfg, db });
    expect(res.ok).toBe(true);
    expect(res.status).toBe('accepted_by_provider');
    // Acceptance must never be described as delivery.
    expect(res.message).toMatch(/not confirmation of delivery/i);
  });
});

describe('duplicate send prevention', () => {
  it('does not send twice for the same approval', async () => {
    const cfg = testConfig({ email: { ...testConfig().email, provider: 'test' } });
    const d = makeDraft();
    repo.approveDraft(d.id, db);

    const first = await sendApprovedDraft(d.id, { cfg, db });
    const second = await sendApprovedDraft(d.id, { cfg, db });

    expect(first.duplicate).toBeFalsy();
    expect(second.duplicate).toBe(true);
    expect(second.message).toMatch(/already sent/i);
    expect(repo.listAttempts(caseId, db)).toHaveLength(1);
  });

  it('survives concurrent send requests', async () => {
    const cfg = testConfig({ email: { ...testConfig().email, provider: 'test' } });
    const d = makeDraft();
    repo.approveDraft(d.id, db);

    const results = await Promise.all([
      sendApprovedDraft(d.id, { cfg, db }),
      sendApprovedDraft(d.id, { cfg, db }),
      sendApprovedDraft(d.id, { cfg, db }),
    ]);

    // Exactly one attempt row, whichever request won the race.
    expect(repo.listAttempts(caseId, db)).toHaveLength(1);
    expect(results.filter((r) => r.duplicate).length).toBe(2);
  });

  it('derives a stable idempotency key from the approval and content', () => {
    const hash = draftContentHash({ recipientEmail: 'a@b.co', subject: 's', body: 'b' });
    expect(sendIdempotencyKey('appr_1', hash)).toBe(sendIdempotencyKey('appr_1', hash));
    expect(sendIdempotencyKey('appr_1', hash)).not.toBe(sendIdempotencyKey('appr_2', hash));
  });
});

describe('uncertain outcomes are not retried automatically', () => {
  it('records an unknown result rather than claiming success or failure', async () => {
    const provider = new TestEmailProvider([], 'unknown');
    const d = makeDraft();
    const { approval } = repo.approveDraft(d.id, db);

    const key = sendIdempotencyKey(approval.id, d.contentHash);
    const { attempt } = repo.claimSendAttempt(
      {
        caseId,
        draftId: d.id,
        approvalId: approval.id,
        idempotencyKey: key,
        providerKind: provider.kind,
      },
      db,
    );
    const result = await provider.send(
      { to: d.recipientEmail!, subject: d.subject, body: d.body },
      key,
    );
    expect(result.status).toBe('unknown');

    repo.completeSendAttempt(attempt.id, { status: 'unknown', error: 'uncertain' }, db);
    repo.setDraftStatus(d.id, 'delivery_unknown', db);

    // A second attempt must report the uncertainty, not silently resend.
    const second = await sendApprovedDraft(d.id, { cfg: testConfig(), db });
    expect(second.duplicate).toBe(true);
    expect(second.message).toMatch(/uncertain outcome/i);
    expect(provider.sent).toHaveLength(0);
  });
});

describe('recipient allowlist', () => {
  it('blocks a recipient that is not allowlisted', async () => {
    const provider = new TestEmailProvider(['allowed@test.invalid']);
    const res = await provider.send(
      { to: 'stranger@example.invalid', subject: 's', body: 'b' },
      'key1',
    );
    expect(res.status).toBe('failed');
    expect(provider.sent).toHaveLength(0);
  });

  it('allows an allowlisted recipient', async () => {
    const provider = new TestEmailProvider(['allowed@test.invalid']);
    const res = await provider.send({ to: 'allowed@test.invalid', subject: 's', body: 'b' }, 'key1');
    expect(res.status).toBe('accepted');
    expect(provider.sent).toHaveLength(1);
  });
});
