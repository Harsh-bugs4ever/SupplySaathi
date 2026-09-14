import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as repo from '@/lib/db/repo';
import { runResearch } from '@/lib/agent/runner';
import { CompositeWebProvider } from '@/lib/providers/web';
import { FallbackReasoningProvider, DeterministicProvider } from '@/lib/providers/reasoning';
import { CogneeProvider } from '@/lib/providers/memory/cognee';
import { ExtractedProductSchema, zodValidator } from '@/lib/providers/reasoning/schemas';
import { makeTestDb, testConfig } from './helpers';
import type { Db } from '@/lib/db/sqlite';
import type { FetchOutcome, ReasoningProvider, WebResearchProvider } from '@/lib/providers/types';

/**
 * What happens when things go wrong.
 *
 * A sourcing tool is judged on its bad days: a model returning nonsense, half
 * the supplier sites down, the memory service unreachable, the worker killed
 * mid-run. None of those may corrupt a case or fabricate a result.
 */

let db: Db;
let cleanup: () => void;

beforeEach(() => ({ db, cleanup } = makeTestDb('resilience')));
afterEach(() => cleanup());

function seedCase(): { caseId: string; runId: string } {
  const profile = repo.getOrCreateProfile(db);
  const c = repo.createCase(
    {
      profileId: profile.id,
      title: 'Cake boxes',
      briefText: '500 cake boxes 10x10x5 in by Friday',
      originalProductUrl: null,
      mode: 'demo',
      resolvedDeadline: '2026-09-18',
      deadlineSourcePhrase: 'Friday',
      timezone: 'Asia/Kolkata',
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
  return { caseId: c.id, runId: run.id };
}

// ── Invalid structured model output ─────────────────────────────────────────

describe('invalid model output is rejected, never trusted', () => {
  const validate = zodValidator(ExtractedProductSchema);

  it('rejects a response missing required fields', () => {
    const r = validate({ supplierName: 'X' });
    expect(r.ok).toBe(false);
  });

  it('rejects a negative pack size', () => {
    const r = validate({
      isProductPage: true,
      supplierName: 'X',
      productTitle: 'Box',
      imageUrl: null,
      contactEmail: null,
      unitsPerPack: { value: -5, excerpt: 'pack of -5' },
      pricePerPack: { value: null, excerpt: null },
      minOrderPacks: { value: null, excerpt: null },
      orderIncrementPacks: { value: null, excerpt: null },
      dimensions: { value: null, excerpt: null },
      material: { value: null, excerpt: null },
      foodContactClaim: { value: null, excerpt: null },
      shippingInfo: { value: null, excerpt: null },
      leadTimeInfo: { value: null, excerpt: null },
      conflicts: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unitsPerPack/);
  });

  it('rejects a bad currency code', () => {
    const base: any = {
      isProductPage: true,
      supplierName: 'X',
      productTitle: 'Box',
      imageUrl: null,
      contactEmail: null,
      unitsPerPack: { value: 50, excerpt: 'pack of 50' },
      pricePerPack: { value: { amount: 720, currency: 'RUPEES' }, excerpt: 'Rs 720' },
      minOrderPacks: { value: null, excerpt: null },
      orderIncrementPacks: { value: null, excerpt: null },
      dimensions: { value: null, excerpt: null },
      material: { value: null, excerpt: null },
      foodContactClaim: { value: null, excerpt: null },
      shippingInfo: { value: null, excerpt: null },
      leadTimeInfo: { value: null, excerpt: null },
      conflicts: [],
    };
    expect(validate(base).ok).toBe(false);
  });

  it('accepts a well-formed response', () => {
    const good: any = {
      isProductPage: true,
      supplierName: 'BoxCraft',
      productTitle: 'Cake box',
      imageUrl: null,
      contactEmail: 'a@b.co',
      unitsPerPack: { value: 50, excerpt: 'Pack size 50' },
      pricePerPack: { value: { amount: 720, currency: 'INR' }, excerpt: 'Rs 720' },
      minOrderPacks: { value: 2, excerpt: 'Minimum order 2 packs' },
      orderIncrementPacks: { value: null, excerpt: null },
      dimensions: {
        value: { length: 10, width: 10, height: 5, unit: 'in', surface: 'external' },
        excerpt: '10 x 10 x 5 inches',
      },
      material: { value: 'kraft', excerpt: 'kraft' },
      foodContactClaim: { value: null, excerpt: null },
      shippingInfo: { value: null, excerpt: null },
      leadTimeInfo: { value: null, excerpt: null },
      conflicts: [],
    };
    expect(validate(good).ok).toBe(true);
  });
});

describe('reasoning falls back to rules when the model fails', () => {
  it('uses the deterministic provider when the primary throws', async () => {
    const broken: ReasoningProvider = {
      kind: 'broken',
      health: async () => ({ provider: 'broken', configured: true, capabilities: [], checkedAt: '' }),
      complete: async () => {
        throw new Error('503 upstream unavailable');
      },
    };

    const provider = new FallbackReasoningProvider(broken, new DeterministicProvider());
    const result = await provider.complete({
      task: 'parse_brief',
      system: 'x',
      user: 'We need 500 cake boxes 10 x 10 x 5 inches by Friday',
      schemaName: 'ParsedBrief',
      validate: (raw: any) => ({ ok: true, value: raw }),
    });

    expect(result.model).toBe('rule-based');
    expect((result.value as any).quantity.units).toBe(500);
  });

  it('stops retrying the model after an auth failure', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('DeepSeek returned HTTP 401'));
    const broken: ReasoningProvider = {
      kind: 'broken',
      health: async () => ({ provider: 'broken', configured: true, capabilities: [], checkedAt: '' }),
      complete,
    };

    const provider = new FallbackReasoningProvider(broken, new DeterministicProvider());
    const req = {
      task: 'parse_brief',
      system: 'x',
      user: 'We need 500 cake boxes',
      schemaName: 'ParsedBrief',
      validate: (raw: any) => ({ ok: true as const, value: raw }),
    };

    await provider.complete(req);
    await provider.complete(req);

    // A 401 will recur on every call; paying that timeout twice is waste.
    expect(complete).toHaveBeenCalledTimes(1);
    expect(provider.degraded).toBe(true);
  });
});

// ── Partial retrieval failures ──────────────────────────────────────────────

describe('partial retrieval', () => {
  /** Succeeds for one host and fails for everything else. */
  function flakyProvider(): WebResearchProvider {
    return {
      kind: 'flaky',
      health: async () => ({ provider: 'flaky', configured: true, capabilities: [], checkedAt: '' }),
      search: async () => [
        { url: 'https://good.example.invalid/p', title: 'Good', snippet: '' },
        { url: 'https://bad.example.invalid/p', title: 'Bad', snippet: '' },
      ],
      fetchPage: async (url): Promise<FetchOutcome> =>
        url.includes('good')
          ? {
              ok: true,
              page: {
                url,
                markdown: '# Box\nPack size: 50\nPrice: Rs. 720 per pack\nExternal dimensions: 10 x 10 x 5 inches',
                title: 'Box',
                retrievedAt: new Date().toISOString(),
                provider: 'flaky',
                truncated: false,
                injectionFlags: [],
              },
            }
          : {
              ok: false,
              failure: {
                url,
                reason: 'Connection reset.',
                attemptedAt: new Date().toISOString(),
                provider: 'flaky',
                retryable: false,
              },
            },
    };
  }

  it('reports a run as partial and keeps what it found', async () => {
    const { caseId, runId } = seedCase();
    const cfg = testConfig();

    const composite = new CompositeWebProvider([flakyProvider()]);
    const goodOutcome = await composite.fetchPage('https://good.example.invalid/p');
    const badOutcome = await composite.fetchPage('https://bad.example.invalid/p');

    expect(goodOutcome.ok).toBe(true);
    expect(badOutcome.ok).toBe(false);
    if (!badOutcome.ok) {
      // Critically: a failed fetch must never be phrased as unavailability.
      expect(badOutcome.failure.reason).not.toMatch(/out of stock|unavailable product/i);
    }

    // The demo fixture set includes a deliberate retrieval failure, so a full
    // run exercises the partial path end to end.
    const outcome = await runResearch(caseId, runId, { cfg, db });
    expect(outcome.pagesFailed).toBeGreaterThan(0);
    expect(outcome.status).toBe('partial');
    expect(outcome.candidatesFound).toBeGreaterThan(0);

    const events = repo.listEvents(caseId, 0, runId, db);
    const failEvent = events.find((e) => e.kind === 'fetch_failed');
    expect(failEvent).toBeDefined();
    expect(failEvent!.detail).toMatch(/not evidence that the product is unavailable/i);
  });

  it('falls through to the next provider when one fails retryably', async () => {
    const first: WebResearchProvider = {
      kind: 'first',
      health: async () => ({ provider: 'first', configured: true, capabilities: [], checkedAt: '' }),
      search: async () => null,
      fetchPage: async (url) => ({
        ok: false,
        failure: { url, reason: 'timeout', attemptedAt: '', provider: 'first', retryable: true },
      }),
    };
    const second: WebResearchProvider = {
      kind: 'second',
      health: async () => ({ provider: 'second', configured: true, capabilities: [], checkedAt: '' }),
      search: async () => null,
      fetchPage: async (url) => ({
        ok: true,
        page: {
          url,
          markdown: 'content',
          title: 't',
          retrievedAt: '',
          provider: 'second',
          truncated: false,
          injectionFlags: [],
        },
      }),
    };

    const composite = new CompositeWebProvider([first, second]);
    const out = await composite.fetchPage('https://x.example.com/p');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.page.provider).toBe('second');
  });

  it('does not fall through when the failure is not retryable', async () => {
    const calls: string[] = [];
    const mk = (kind: string, retryable: boolean): WebResearchProvider => ({
      kind,
      health: async () => ({ provider: kind, configured: true, capabilities: [], checkedAt: '' }),
      search: async () => null,
      fetchPage: async (url) => {
        calls.push(kind);
        return {
          ok: false,
          failure: { url, reason: 'blocked', attemptedAt: '', provider: kind, retryable },
        };
      },
    });

    const composite = new CompositeWebProvider([mk('a', false), mk('b', true)]);
    await composite.fetchPage('https://x.example.com/p');
    // A blocked URL fails identically everywhere; trying again is wasted budget.
    expect(calls).toEqual(['a']);
  });
});

// ── Memory failure ──────────────────────────────────────────────────────────

describe('memory service failure never blocks a case', () => {
  it('recall returns empty instead of throwing when Cognee is unreachable', async () => {
    const cognee = new CogneeProvider({
      apiKey: 'test-key',
      baseUrl: 'https://unreachable.invalid',
      dataset: 'x',
      timeoutMs: 500,
    });

    await expect(cognee.recall('cake boxes', 5)).resolves.toEqual([]);
  });

  it('remember swallows the error rather than failing the caller', async () => {
    const cognee = new CogneeProvider({
      apiKey: 'test-key',
      baseUrl: 'https://unreachable.invalid',
      dataset: 'x',
      timeoutMs: 500,
    });

    await expect(cognee.remember({ text: 'we prefer recycled', kind: 'preference' })).resolves.toBeUndefined();
  });

  it('reports unavailability through health rather than silently', async () => {
    const cognee = new CogneeProvider({
      apiKey: 'test-key',
      baseUrl: 'https://unreachable.invalid',
      dataset: 'x',
      timeoutMs: 500,
    });

    const h = await cognee.health();
    expect(h.capabilities[0].available).toBe(false);
    expect(h.capabilities[0].detail).toMatch(/not reachable|local preferences/i);
  });

  it('a research run still completes with memory down', async () => {
    const { caseId, runId } = seedCase();
    const cfg = testConfig({
      cognee: { apiKey: 'k', baseUrl: 'https://unreachable.invalid', dataset: 'x', timeoutMs: 500 },
    });

    const outcome = await runResearch(caseId, runId, { cfg, db });
    expect(['succeeded', 'partial']).toContain(outcome.status);
    expect(outcome.candidatesFound).toBeGreaterThan(0);
  });
});

// ── Cancellation and job recovery ───────────────────────────────────────────

describe('cancellation', () => {
  it('stops the run and records the cancelled state', async () => {
    const { caseId, runId } = seedCase();
    // Cancel before the loop starts so the very first check trips.
    repo.requestCancel(runId, db);

    const outcome = await runResearch(caseId, runId, { cfg: testConfig(), db });

    expect(outcome.status).toBe('cancelled');
    expect(repo.getRun(runId, db)!.status).toBe('cancelled');
    expect(repo.getCase(caseId, db)!.state).toBe('CANCELLED');
  });

  it('the cancel flag is visible across processes via the database', () => {
    const { runId } = seedCase();
    expect(repo.isCancelRequested(runId, db)).toBe(false);
    repo.requestCancel(runId, db);
    expect(repo.isCancelRequested(runId, db)).toBe(true);
  });
});

describe('job queue recovery', () => {
  it('claims a job exactly once', () => {
    const { caseId, runId } = seedCase();
    repo.enqueueJob({ kind: 'research', caseId, runId }, db);

    const first = repo.claimNextJob('worker-a', db);
    const second = repo.claimNextJob('worker-b', db);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('requeues a job abandoned by a dead worker', () => {
    const { caseId, runId } = seedCase();
    repo.enqueueJob({ kind: 'research', caseId, runId }, db);

    repo.claimNextJob('worker-a', db);
    expect(repo.claimNextJob('worker-b', db)).toBeNull();

    // Simulate worker-a dying mid-run.
    const reclaimed = repo.reclaimStaleJobs(db);
    expect(reclaimed).toBe(1);

    const recovered = repo.claimNextJob('worker-b', db);
    expect(recovered).not.toBeNull();
    expect(recovered!.attempts).toBe(2);
  });

  it('a finished job is not reclaimed', () => {
    const { caseId, runId } = seedCase();
    repo.enqueueJob({ kind: 'research', caseId, runId }, db);
    const job = repo.claimNextJob('worker-a', db)!;
    repo.finishJob(job.id, 'done', undefined, db);

    expect(repo.reclaimStaleJobs(db)).toBe(0);
    expect(repo.claimNextJob('worker-b', db)).toBeNull();
  });

  it('persists progress so a refresh loses nothing', async () => {
    const { caseId, runId } = seedCase();
    await runResearch(caseId, runId, { cfg: testConfig(), db });

    // Everything the workspace renders comes back from disk.
    expect(repo.listEvents(caseId, 0, runId, db).length).toBeGreaterThan(3);
    expect(repo.listCandidates(caseId, db).length).toBeGreaterThan(0);
    expect(repo.listEvidence(caseId, undefined, db).length).toBeGreaterThan(0);
    expect(repo.getRun(runId, db)!.finishedAt).not.toBeNull();
  });
});
