import type { AppConfig } from '../config/load';
import type { Db } from '../db/sqlite';
import { getDb } from '../db/client';
import { dedupeKeyForUrl } from '../db/ids';
import * as repo from '../db/repo';
import { computeCosting } from '../domain/costing';
import { deriveStatus, evaluateCandidate, type EvaluationResult } from '../domain/constraints';
import { collectOpenQuestions, rankCandidates } from '../domain/ranking';
import { todayInZone } from '../domain/dates';
import { formatDimensions } from '../domain/units';
import { makeExcerpt } from '../security/sanitize';
import { log } from '../security/redact';
import { createReasoningProvider } from '../providers/reasoning';
import { createWebProvider } from '../providers/web';
import { seedUrlsForCase } from '../providers/web/catalogue';
import { createMemoryProvider } from '../providers/memory';
import {
  ExtractedProductSchema,
  SearchPlanSchema,
  zodValidator,
  type ExtractedProduct,
} from '../providers/reasoning/schemas';
import { EXTRACT_SYSTEM, PLAN_SYSTEM, extractUserPrompt, planUserPrompt } from './prompts';
import { summarizeBrief } from './brief';
import type {
  CandidateProduct,
  Evidence,
  Requirement,
  ResearchEventKind,
  SourcingCase,
} from '../domain/types';

/**
 * The research run.
 *
 * Executes inside the worker process, not a web request, so a long run survives
 * the browser being closed. Progress is written to the database as it happens;
 * the UI reads it back. Nothing here is simulated — every timeline entry
 * corresponds to a real action that just completed.
 *
 * The run is bounded on three axes at once: pages fetched, rounds, and wall
 * clock. Whichever binds first, the run stops and returns what it has.
 */

export interface RunnerDeps {
  cfg: AppConfig;
  db: Db;
}

export interface RunOutcome {
  status: 'succeeded' | 'partial' | 'failed' | 'cancelled';
  candidatesFound: number;
  pagesFetched: number;
  pagesFailed: number;
  openQuestions: string[];
}

class Budget {
  private readonly startedAt = Date.now();
  private pages = 0;

  constructor(
    private readonly maxPages: number,
    private readonly timeBudgetMs: number,
  ) {}

  get pagesUsed(): number {
    return this.pages;
  }
  consumePage(): void {
    this.pages += 1;
  }
  get pagesRemaining(): number {
    return Math.max(0, this.maxPages - this.pages);
  }
  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }
  /** Why the run should stop, or null to continue. */
  exhausted(): string | null {
    if (this.pages >= this.maxPages) {
      return `Reached the limit of ${this.maxPages} pages for this case.`;
    }
    if (this.elapsedMs >= this.timeBudgetMs) {
      return `Reached the ${Math.round(this.timeBudgetMs / 1000)} second time limit for this case.`;
    }
    return null;
  }
}

export async function runResearch(
  caseId: string,
  runId: string,
  deps: RunnerDeps,
): Promise<RunOutcome> {
  const { cfg, db } = deps;

  const sourcingCase = repo.getCase(caseId, db);
  if (!sourcingCase) throw new Error(`Case ${caseId} not found`);
  const requirements = repo.listRequirements(caseId, db);
  const profile = repo.getOrCreateProfile(db);

  const mode = sourcingCase.mode;
  const web = createWebProvider(cfg, mode);
  const reasoning = createReasoningProvider(cfg, mode);
  const memory = createMemoryProvider(cfg, profile.id, db);

  const budget = new Budget(cfg.agent.maxPages, cfg.agent.timeBudgetMs);
  const today = todayInZone(sourcingCase.timezone);

  const emit = (kind: ResearchEventKind, message: string, detail?: string, candidateId?: string) =>
    repo.appendEvent({ caseId, runId, kind, message, detail: detail ?? null, candidateId }, db);

  /** Cancellation is checked between every unit of work, not just at the top. */
  const cancelled = () => repo.isCancelRequested(runId, db);

  repo.updateRun(runId, { status: 'running', startedAt: new Date().toISOString() }, db);
  repo.setCaseState(caseId, 'RESEARCHING', db);

  let pagesFetched = 0;
  let pagesFailed = 0;

  try {
    emit(
      'status',
      mode === 'demo'
        ? 'Started research in demo mode using sample supplier data.'
        : 'Started research using live supplier pages.',
      `Limits: ${cfg.agent.maxPages} pages, ${Math.round(cfg.agent.timeBudgetMs / 1000)}s.`,
    );

    // ── 1. Remembered context ────────────────────────────────────────────────
    const summary = summarizeBrief(requirements, sourcingCase.title);
    const remembered = await memory.recall(summary, 5);
    if (remembered.length) {
      emit(
        'memory',
        `Applied ${remembered.length} remembered preference${remembered.length === 1 ? '' : 's'} from your business profile.`,
        remembered.map((m) => `• ${m.text}`).join('\n'),
      );
    }

    // ── 2. Discovery ─────────────────────────────────────────────────────────
    const urls = await discoverUrls({
      sourcingCase,
      summary,
      web,
      reasoning,
      emit,
      limit: cfg.agent.maxPages,
      city: profile.city,
    });

    if (!urls.length) {
      emit('warning', 'No candidate pages could be identified for this brief.');
      repo.updateRun(runId, { status: 'partial', finishedAt: new Date().toISOString() }, db);
      repo.setCaseState(caseId, 'PARTIAL_RESULTS', db);
      return { status: 'partial', candidatesFound: 0, pagesFetched: 0, pagesFailed: 0, openQuestions: [] };
    }

    // ── 3. Retrieve and extract ──────────────────────────────────────────────
    repo.setCaseState(caseId, 'EVALUATING', db);
    const candidates: Array<{ candidate: CandidateProduct; evaluations: EvaluationResult[] }> = [];
    const seenKeys = new Set<string>();

    for (const url of urls) {
      if (cancelled()) {
        emit('status', 'Research cancelled at your request.');
        repo.updateRun(runId, { status: 'cancelled', finishedAt: new Date().toISOString() }, db);
        repo.setCaseState(caseId, 'CANCELLED', db);
        return { status: 'cancelled', candidatesFound: candidates.length, pagesFetched, pagesFailed, openQuestions: [] };
      }

      const stop = budget.exhausted();
      if (stop) {
        emit('status', `${stop} Returning what has been found so far.`);
        break;
      }

      // Deduplicate before spending a fetch, not after.
      const key = dedupeKeyForUrl(url, url);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const isOriginal = url === sourcingCase.originalProductUrl;
      emit('fetch', isOriginal ? 'Reading the original product page.' : `Checking supplier page: ${hostOf(url)}`, url);

      budget.consumePage();
      let outcome = await web.fetchPage(url);

      // One retry with a real browser for pages that need JavaScript.
      if (!outcome.ok && outcome.failure.retryable && cfg.anakin.useBrowserOnRetry && mode === 'live') {
        emit('fetch', `Retrying ${hostOf(url)} with a full browser.`, outcome.failure.reason);
        outcome = await web.fetchPage(url, { useBrowser: true });
      }

      if (!outcome.ok) {
        pagesFailed += 1;
        repo.updateRun(runId, { pagesFailed }, db);
        // Phrased so it can never be misread as evidence about the product.
        emit(
          'fetch_failed',
          `Could not read ${hostOf(url)}.`,
          `${outcome.failure.reason}\n\nThis is a retrieval failure. It is not evidence that the product is unavailable.`,
        );
        continue;
      }

      pagesFetched += 1;
      repo.updateRun(runId, { pagesFetched }, db);

      if (outcome.page.injectionFlags.length) {
        emit(
          'warning',
          `${hostOf(url)} contained text addressed to automated agents. It was treated as page content only.`,
          outcome.page.injectionFlags.join(', '),
        );
      }

      // ── Extract ────────────────────────────────────────────────────────────
      let extracted: ExtractedProduct;
      try {
        const result = await reasoning.complete({
          task: 'extract_product',
          system: EXTRACT_SYSTEM,
          user: extractUserPrompt({
            url: outcome.page.url,
            title: outcome.page.title,
            content: outcome.page.markdown,
            retrievedAt: outcome.page.retrievedAt,
          }),
          schemaName: 'ExtractedProduct',
          validate: zodValidator(ExtractedProductSchema),
          maxTokens: 2000,
        });
        extracted = result.value;
      } catch (err) {
        emit('warning', `Could not extract product details from ${hostOf(url)}.`, (err as Error).message);
        continue;
      }

      if (!extracted.isProductPage) {
        emit(
          'extract',
          `${hostOf(url)} is not a product page; skipped.`,
          'No pack size, price or dimensions were found on the page.',
        );
        continue;
      }

      // The original product page is context, not a candidate to buy from.
      if (isOriginal) {
        emit(
          'extract',
          'Read your original product page for the specification baseline.',
          describeExtraction(extracted),
        );
        continue;
      }

      // ── Persist candidate + evidence ───────────────────────────────────────
      const { candidate, evaluations } = await buildCandidate({
        caseId,
        runId,
        page: outcome.page,
        extracted,
        requirements,
        today,
        db,
        emit,
      });

      candidates.push({ candidate, evaluations });
    }

    // ── 4. Rank and finish ───────────────────────────────────────────────────
    const ranked = rankCandidates(candidates);
    for (const r of ranked) {
      repo.upsertCandidate({ ...r.candidate, rankScore: r.score, rationale: r.explanation }, db);
    }

    const openQuestions = collectOpenQuestions(ranked);
    if (openQuestions.length) {
      emit(
        'question',
        `Prepared ${openQuestions.length} question${openQuestions.length === 1 ? '' : 's'} that suppliers need to answer.`,
        openQuestions.map((q) => `• ${q}`).join('\n'),
      );
    }

    const usable = ranked.filter((r) => r.candidate.status !== 'does_not_meet');
    const finishedAt = new Date().toISOString();

    // Partial when retrieval failed or nothing qualified — the user needs to
    // know the shortlist is incomplete, not just short.
    const isPartial = pagesFailed > 0 || usable.length === 0;

    emit(
      'status',
      `Research complete. ${usable.length} option${usable.length === 1 ? '' : 's'} worth considering out of ${ranked.length} examined.` +
        (pagesFailed ? ` ${pagesFailed} page${pagesFailed === 1 ? '' : 's'} could not be read.` : ''),
    );

    repo.updateRun(
      runId,
      { status: isPartial ? 'partial' : 'succeeded', finishedAt, pagesFetched, pagesFailed },
      db,
    );
    repo.setCaseState(caseId, isPartial && usable.length === 0 ? 'PARTIAL_RESULTS' : 'SHORTLIST_READY', db);

    if (usable.length > 0 && usable.length < 2) {
      emit(
        'question',
        'Only one option qualified. You may want to relax a constraint — tell us which, and we will re-run.',
        'We will not change any requirement without you asking.',
      );
    }

    return {
      status: isPartial ? 'partial' : 'succeeded',
      candidatesFound: ranked.length,
      pagesFetched,
      pagesFailed,
      openQuestions,
    };
  } catch (err) {
    const message = (err as Error).message;
    log.error('Research run failed', { caseId, runId, error: message });
    emit('error', 'Research stopped because of an error.', message);
    repo.updateRun(runId, { status: 'failed', error: message, finishedAt: new Date().toISOString() }, db);
    repo.setCaseState(caseId, 'FAILED', db);
    return { status: 'failed', candidatesFound: 0, pagesFetched, pagesFailed, openQuestions: [] };
  }
}

// ── Discovery ───────────────────────────────────────────────────────────────

/**
 * Build the list of pages to read.
 *
 * Search is used when a provider actually has that capability. When it does
 * not, we fall back to the curated catalogue rather than degrading silently —
 * and we say so in the timeline, because the user should know how the
 * candidates were found.
 */
async function discoverUrls(args: {
  sourcingCase: SourcingCase;
  summary: string;
  web: ReturnType<typeof createWebProvider>;
  reasoning: ReturnType<typeof createReasoningProvider>;
  emit: (kind: ResearchEventKind, message: string, detail?: string) => unknown;
  limit: number;
  city: string;
}): Promise<string[]> {
  const { sourcingCase, summary, web, reasoning, emit, limit, city } = args;
  const urls: string[] = [];

  if (sourcingCase.originalProductUrl) urls.push(sourcingCase.originalProductUrl);

  let queries: string[] = [];
  try {
    const plan = await reasoning.complete({
      task: 'plan_search',
      system: PLAN_SYSTEM,
      user: planUserPrompt(summary),
      schemaName: 'SearchPlan',
      validate: zodValidator(SearchPlanSchema),
      maxTokens: 500,
    });
    queries = plan.value.queries;
    emit('plan', `Planned ${queries.length} searches for this brief.`, queries.map((q) => `• ${q}`).join('\n'));
  } catch (err) {
    emit('warning', 'Could not plan searches; using the supplier catalogue instead.', (err as Error).message);
  }

  let searchWorked = false;
  for (const q of queries) {
    if (urls.length >= limit) break;
    const results = await web.search(q, 6);
    if (!results) continue;
    searchWorked = true;
    emit('search', `Searched: "${q}"`, `${results.length} result(s).`);
    for (const r of results) {
      if (urls.length >= limit) break;
      if (!urls.includes(r.url)) urls.push(r.url);
    }
  }

  if (!searchWorked) {
    const seeds = seedUrlsForCase({
      originalProductUrl: sourcingCase.originalProductUrl,
      city,
      limit,
    });
    emit(
      'search',
      'Live search is not available with the configured credentials, so candidates come from the curated supplier catalogue.',
      `${seeds.length} supplier page(s) queued. Add an ANAKIN_API_KEY to enable search-based discovery.`,
    );
    for (const s of seeds) if (!urls.includes(s)) urls.push(s);
  }

  return urls.slice(0, limit);
}

// ── Candidate construction ──────────────────────────────────────────────────

async function buildCandidate(args: {
  caseId: string;
  runId: string;
  page: { url: string; title: string | null; markdown: string; retrievedAt: string; provider: string };
  extracted: ExtractedProduct;
  requirements: Requirement[];
  today: string;
  db: Db;
  emit: (kind: ResearchEventKind, message: string, detail?: string, candidateId?: string) => unknown;
}): Promise<{ candidate: CandidateProduct; evaluations: EvaluationResult[] }> {
  const { caseId, runId, page, extracted, requirements, today, db, emit } = args;

  const requiredUnits =
    requirements.find((r) => r.spec.kind === 'quantity')?.spec as { units: number } | undefined;

  // Arithmetic happens here, in code, from the values the page stated.
  const costing = computeCosting({
    requiredUnits: requiredUnits?.units ?? 0,
    unitsPerPack: extracted.unitsPerPack.value,
    pricePerPack: extracted.pricePerPack.value,
    minOrderPacks: extracted.minOrderPacks.value,
    orderIncrementPacks: extracted.orderIncrementPacks.value,
    shippingInfo: extracted.shippingInfo.value,
  });

  const draft: Omit<CandidateProduct, 'id' | 'createdAt'> = {
    caseId,
    runId,
    supplierName: extracted.supplierName ?? hostOf(page.url),
    productTitle: extracted.productTitle ?? page.title ?? 'Untitled product',
    sourceUrl: page.url,
    imageUrl: extracted.imageUrl,
    retrievedAt: page.retrievedAt,
    status: 'potential_match',
    unitsPerPack: extracted.unitsPerPack.value,
    pricePerPack: extracted.pricePerPack.value,
    minOrderPacks: extracted.minOrderPacks.value,
    orderIncrementPacks: extracted.orderIncrementPacks.value,
    dimensions: extracted.dimensions.value,
    material: extracted.material.value,
    foodContactClaim: extracted.foodContactClaim.value,
    shippingInfo: extracted.shippingInfo.value,
    leadTimeInfo: extracted.leadTimeInfo.value,
    currency: extracted.pricePerPack.value?.currency ?? null,
    costing,
    rationale: '',
    rankScore: null,
    dedupeKey: dedupeKeyForUrl(page.url, extracted.productTitle ?? ''),
  };

  const saved = repo.upsertCandidate(draft, db);

  // ── Evidence ──────────────────────────────────────────────────────────────
  const facts: Array<[string, { value: unknown; excerpt: string | null }, 'supplier_claim' | 'computed']> = [
    ['unitsPerPack', extracted.unitsPerPack, 'supplier_claim'],
    ['pricePerPack', extracted.pricePerPack, 'supplier_claim'],
    ['minOrderPacks', extracted.minOrderPacks, 'supplier_claim'],
    ['orderIncrementPacks', extracted.orderIncrementPacks, 'supplier_claim'],
    ['dimensions', extracted.dimensions, 'supplier_claim'],
    ['material', extracted.material, 'supplier_claim'],
    ['foodContactClaim', extracted.foodContactClaim, 'supplier_claim'],
    ['shippingInfo', extracted.shippingInfo, 'supplier_claim'],
    ['leadTimeInfo', extracted.leadTimeInfo, 'supplier_claim'],
  ];

  for (const [path, fact, authority] of facts) {
    const known = fact.value !== null && fact.value !== undefined;
    repo.addEvidence(
      {
        caseId,
        candidateId: saved.id,
        factPath: path,
        status: known ? 'explicitly_stated' : 'unknown',
        authority,
        sourceUrl: page.url,
        excerpt: known && fact.excerpt ? makeExcerpt(page.markdown, fact.excerpt) : null,
        interpretation: known ? interpretationFor(path, fact.value) : 'Not stated on this page.',
        retrievedAt: page.retrievedAt,
      } satisfies Omit<Evidence, 'id' | 'createdAt'>,
      db,
    );
  }

  // A contact address is only ever used if it was actually printed on the page.
  // Recording it as evidence — with the URL it came from — is what lets the
  // outreach step show the user where the address originated instead of
  // presenting an address of unknown provenance.
  if (extracted.contactEmail) {
    repo.addEvidence(
      {
        caseId,
        candidateId: saved.id,
        factPath: 'contactEmail',
        status: 'explicitly_stated',
        authority: 'supplier_claim',
        sourceUrl: page.url,
        excerpt: makeExcerpt(page.markdown, extracted.contactEmail),
        interpretation: `Contact address published on the supplier's own page: ${extracted.contactEmail}`,
        retrievedAt: page.retrievedAt,
      },
      db,
    );
  }

  // Conflicts are recorded as their own evidence so the drawer can show both
  // readings rather than hiding the disagreement behind one chosen value.
  for (const conflict of extracted.conflicts) {
    repo.addEvidence(
      {
        caseId,
        candidateId: saved.id,
        factPath: 'dimensions',
        status: 'conflicting',
        authority: 'supplier_claim',
        sourceUrl: page.url,
        excerpt: conflict,
        interpretation:
          'The page gives more than one measurement for this attribute. Confirm which applies before ordering.',
        retrievedAt: page.retrievedAt,
      },
      db,
    );
  }

  // Derived figures are evidence too, but marked as computed, never retrieved.
  if (costing) {
    repo.addEvidence(
      {
        caseId,
        candidateId: saved.id,
        factPath: 'costing.merchandiseSubtotal',
        status: 'derived',
        authority: 'computed',
        sourceUrl: page.url,
        excerpt: null,
        interpretation:
          `${costing.packsNeeded} packs x ${costing.unitsPerPack} units = ${costing.purchasedUnits} units. ` +
          `${costing.packsNeeded} x ${costing.merchandiseSubtotal.currency} ` +
          `${(costing.merchandiseSubtotal.amount / costing.packsNeeded).toFixed(2)} = ` +
          `${costing.merchandiseSubtotal.currency} ${costing.merchandiseSubtotal.amount}. ` +
          `Shipping and tax are not included.`,
        retrievedAt: page.retrievedAt,
      },
      db,
    );
  }

  // ── Constraint evaluation ─────────────────────────────────────────────────
  const evaluations = evaluateCandidate({ ...saved, costing }, requirements, today);
  const status = deriveStatus(evaluations);

  for (const e of evaluations) {
    repo.addEvaluation(
      {
        caseId,
        candidateId: saved.id,
        requirementId: e.requirementId,
        requirementLabel: e.requirementLabel,
        priority: e.priority,
        outcome: e.outcome,
        explanation: e.explanation,
        evidenceIds: [],
      },
      db,
    );
  }

  const finalCandidate = repo.upsertCandidate({ ...draft, id: saved.id, status, costing }, db);

  const failed = evaluations.filter((e) => e.outcome === 'failed' && e.priority === 'must_have');
  if (failed.length) {
    emit(
      'exclude',
      `Excluded ${finalCandidate.supplierName}: ${failed[0].explanation}`,
      failed.map((f) => `${f.requirementLabel}: ${f.explanation}`).join('\n'),
      finalCandidate.id,
    );
  } else {
    const unknowns = evaluations.filter((e) => e.outcome === 'unknown' && e.priority === 'must_have');
    emit(
      'evaluate',
      unknowns.length
        ? `${finalCandidate.supplierName} is a possible match with ${unknowns.length} point${unknowns.length === 1 ? '' : 's'} to confirm.`
        : `${finalCandidate.supplierName} meets every stated requirement.`,
      describeExtraction(extracted),
      finalCandidate.id,
    );
  }

  return { candidate: finalCandidate, evaluations };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function interpretationFor(path: string, value: unknown): string {
  switch (path) {
    case 'unitsPerPack':
      return `The page states each pack contains ${value} units.`;
    case 'pricePerPack': {
      const v = value as { amount: number; currency: string };
      return `The page lists ${v.currency} ${v.amount} per pack. This is a listed price, not a quotation.`;
    }
    case 'minOrderPacks':
      return `The supplier states a minimum order of ${value} pack(s).`;
    case 'dimensions':
      return `The page states dimensions of ${formatDimensions(value as any)}.`;
    case 'foodContactClaim':
      return `This is the supplier's own claim as printed. It is not independent certification.`;
    case 'leadTimeInfo':
      return `The supplier's published timeframe. It is an estimate, not a delivery commitment.`;
    default:
      return `Stated on the supplier page.`;
  }
}

function describeExtraction(e: ExtractedProduct): string {
  const bits: string[] = [];
  if (e.dimensions.value) bits.push(`Dimensions: ${formatDimensions(e.dimensions.value)}`);
  if (e.unitsPerPack.value) bits.push(`Pack of ${e.unitsPerPack.value}`);
  if (e.pricePerPack.value) {
    bits.push(`${e.pricePerPack.value.currency} ${e.pricePerPack.value.amount} per pack`);
  }
  if (e.minOrderPacks.value) bits.push(`Minimum ${e.minOrderPacks.value} pack(s)`);
  if (!e.leadTimeInfo.value) bits.push('Lead time: not stated');
  return bits.join(' · ') || 'No commercial details found.';
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 60);
  }
}

export { getDb };
