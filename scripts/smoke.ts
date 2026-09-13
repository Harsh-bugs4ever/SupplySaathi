import { loadEnvFiles } from '../src/lib/config/loadEnvFile';

loadEnvFiles();

import { loadConfig } from '../src/lib/config/load';
import { getDb, migrate } from '../src/lib/db/client';
import * as repo from '../src/lib/db/repo';
import { normalizeBrief } from '../src/lib/agent/brief';
import { runResearch } from '../src/lib/agent/runner';
import { draftQuotesForCase, sendApprovedDraft } from '../src/lib/agent/outreach';
import { createReasoningProvider } from '../src/lib/providers/reasoning';
import { ParsedBriefSchema, zodValidator } from '../src/lib/providers/reasoning/schemas';
import { BRIEF_SYSTEM, briefUserPrompt } from '../src/lib/agent/prompts';
import { formatMoney } from '../src/lib/domain/costing';
import { STATUS_LABELS } from '../src/lib/domain/constraints';

/**
 * End-to-end smoke test of the vertical slice, run against the real code paths
 * in demo mode. Not a substitute for the test suite — this is the "does the
 * whole thing actually work" check used during development.
 */

const BRIEF =
  'Our usual supplier cancelled. We need 500 cake boxes, 10 x 10 x 5 inches, ' +
  'suitable for direct food contact, delivered to Pune by Friday. Budget Rs 8000. ' +
  'Find alternatives and prepare quote requests.';

async function main() {
  const cfg = { ...loadConfig(), mode: 'demo' as const };
  const db = getDb();
  migrate(db);

  const profile = repo.getOrCreateProfile(db);
  console.log(`\n=== SupplySaathi smoke test (demo mode) ===`);
  console.log(`Business: ${profile.businessName}, ${profile.city} (${profile.timezone})\n`);

  // 1. Parse the brief
  const reasoning = createReasoningProvider(cfg, 'demo');
  const parsed = await reasoning.complete({
    task: 'parse_brief',
    system: BRIEF_SYSTEM,
    user: briefUserPrompt({ briefText: BRIEF }),
    schemaName: 'ParsedBrief',
    validate: zodValidator(ParsedBriefSchema),
  });
  console.log(`1. Parsed brief with "${parsed.model}"`);

  const normalized = normalizeBrief({
    parsed: parsed.value,
    structured: {},
    timezone: profile.timezone,
    defaultCurrency: 'INR',
  });

  console.log(`   Deadline "${normalized.deadline?.sourcePhrase}" resolved to ${normalized.deadline?.display}`);
  console.log(`   ${normalized.requirements.length} requirements:`);
  for (const r of normalized.requirements) {
    console.log(`     [${r.priority === 'must_have' ? 'MUST' : 'pref'}] ${r.label}`);
  }
  if (normalized.clarifications.length) {
    console.log(`   Clarifications: ${normalized.clarifications.map((c) => c.question).join(' | ')}`);
  }

  // 2. Create the case
  const created = repo.createCase(
    {
      profileId: profile.id,
      title: normalized.title,
      briefText: BRIEF,
      originalProductUrl: 'https://oldsupplier.example.invalid/cake-box-10x10x5-standard',
      mode: 'demo',
      resolvedDeadline: normalized.deadline?.isoDate ?? null,
      deadlineSourcePhrase: normalized.deadline?.sourcePhrase ?? null,
      timezone: profile.timezone,
      currency: 'INR',
    },
    db,
  );
  for (const r of normalized.requirements) repo.addRequirement({ ...r, caseId: created.id }, db);
  console.log(`\n2. Created case ${created.reference} (${created.id})`);

  // 3. Research
  const run = repo.createRun(created.id, 'demo', 1, db);
  console.log(`\n3. Running research...\n`);
  const outcome = await runResearch(created.id, run.id, { cfg, db });

  for (const ev of repo.listEvents(created.id, 0, run.id, db)) {
    const icon =
      ev.kind === 'exclude' ? 'x' : ev.kind === 'fetch_failed' ? '!' : ev.kind === 'evaluate' ? '+' : '.';
    console.log(`   ${icon} ${ev.message}`);
  }

  console.log(`\n   Outcome: ${outcome.status}, ${outcome.pagesFetched} read, ${outcome.pagesFailed} failed`);

  // 4. Shortlist
  const candidates = repo.listCandidates(created.id, db);
  const evaluations = repo.listEvaluations(created.id, db);
  console.log(`\n4. Shortlist (${candidates.length} candidates)\n`);

  for (const c of candidates) {
    const evals = evaluations.filter((e) => e.candidateId === c.id);
    const failed = evals.filter((e) => e.outcome === 'failed' && e.priority === 'must_have');
    const unknown = evals.filter((e) => e.outcome === 'unknown' && e.priority === 'must_have');

    console.log(`   ${c.supplierName} — ${STATUS_LABELS[c.status]}`);
    console.log(`     ${c.productTitle}`);
    if (c.costing) {
      console.log(
        `     ${c.costing.packsNeeded} packs x ${c.costing.unitsPerPack} = ${c.costing.purchasedUnits} units` +
          (c.costing.overageUnits ? ` (${c.costing.overageUnits} over)` : ''),
      );
      console.log(
        `     Merchandise subtotal ${formatMoney(c.costing.merchandiseSubtotal)}` +
          (c.costing.landedTotal ? ` | landed ${formatMoney(c.costing.landedTotal)}` : ' | landed total unavailable'),
      );
    } else {
      console.log(`     Cost unknown (pack size or price not stated)`);
    }
    for (const f of failed) console.log(`     FAILED  ${f.requirementLabel}: ${f.explanation}`);
    for (const u of unknown) console.log(`     UNKNOWN ${u.requirementLabel}: ${u.explanation}`);
    console.log('');
  }

  // 5. Draft quotes for everything not excluded
  const selectable = candidates.filter((c) => c.status !== 'does_not_meet' && c.status !== 'retrieval_failed');
  if (!selectable.length) {
    console.log('No selectable candidates; stopping.');
    return;
  }

  const drafts = await draftQuotesForCase(
    created.id,
    selectable.slice(0, 2).map((c) => c.id),
    { cfg, db },
  );
  console.log(`5. Drafted ${drafts.length} quote request(s)\n`);
  console.log('--- first draft ---');
  console.log(`To: ${drafts[0].recipientEmail ?? '(no address found — user must supply)'}`);
  console.log(`Source: ${drafts[0].recipientSource ?? 'n/a'}`);
  console.log(`Subject: ${drafts[0].subject}`);
  console.log(drafts[0].body.split('\n').slice(0, 14).join('\n'));
  console.log('---\n');

  // 6. Approval invalidation check
  const d = drafts[0];
  if (!d.recipientEmail) {
    repo.updateDraft(d.id, { recipientEmail: 'test@example.invalid', recipientSource: 'user_entered' }, db);
  }
  const approved = repo.approveDraft(d.id, db);
  console.log(`6. Approved draft v${approved.approval.draftVersion} (hash ${approved.approval.contentHash.slice(0, 12)}…)`);

  repo.updateDraft(d.id, { body: `${approved.draft.body}\n\nPS: edited after approval.` }, db);
  const afterEdit = repo.getLiveApproval(d.id, db);
  console.log(`   After editing the body, live approval is: ${afterEdit ? 'STILL VALID (BUG)' : 'invalidated (correct)'}`);

  // 7. Re-approve and send
  repo.approveDraft(d.id, db);
  const sent = await sendApprovedDraft(d.id, { cfg, db });
  console.log(`\n7. Send result: ${sent.status} — ${sent.message}`);

  const again = await sendApprovedDraft(d.id, { cfg, db });
  console.log(`   Second send attempt: ${again.duplicate ? 'blocked as duplicate (correct)' : 'SENT AGAIN (BUG)'}`);

  // 8. Reload from disk
  const reloaded = repo.getCase(created.id, db);
  console.log(`\n8. Reloaded case ${reloaded?.reference}: state ${reloaded?.state}`);
  console.log(`   ${repo.listCandidates(created.id, db).length} candidates, ${repo.listDrafts(created.id, db).length} drafts, ${repo.listAttempts(created.id, db).length} send attempt(s) persisted.`);
  console.log(`\n=== smoke test complete ===\n`);
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  process.exit(1);
});
