import { loadEnvFiles } from '../src/lib/config/loadEnvFile';

loadEnvFiles();

import { loadConfig } from '../src/lib/config/load';
import { getDb, migrate } from '../src/lib/db/client';
import * as repo from '../src/lib/db/repo';
import { normalizeBrief } from '../src/lib/agent/brief';
import { createReasoningProvider } from '../src/lib/providers/reasoning';
import { ParsedBriefSchema, zodValidator } from '../src/lib/providers/reasoning/schemas';
import { BRIEF_SYSTEM, briefUserPrompt } from '../src/lib/agent/prompts';
import { createMemoryProvider } from '../src/lib/providers/memory';

/**
 * Seed a demo case ready for the walkthrough.
 *
 * Creates the business profile, two standing preferences (so the memory panel
 * has something to show on the next case), and one queued sourcing case. The
 * worker picks the case up and runs it, so by the time you open the browser
 * there is a real shortlist with a real event timeline.
 *
 *   npm run seed
 */

const BRIEF =
  'Our usual supplier cancelled. We need 500 cake boxes, 10 x 10 x 5 inches, ' +
  'suitable for direct food contact, delivered to Pune by Friday. Budget Rs 8000. ' +
  'Find alternatives and prepare quote requests.';

async function main() {
  const cfg = loadConfig();
  const db = getDb();
  migrate(db);

  const profile = repo.updateProfile(
    {
      id: repo.getOrCreateProfile(db).id,
      businessName: 'Rasoi Bakehouse',
      city: 'Pune',
      postalCode: '411001',
      country: 'IN',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      contactEmail: 'orders@rasoibakehouse.example',
    },
    db,
  );
  console.log(`Business profile: ${profile.businessName}, ${profile.city}`);

  // Standing preferences, so a later case can demonstrate remembered context.
  const existingNotes = repo.listNotes(profile.id, db);
  if (existingNotes.length === 0) {
    for (const note of [
      { kind: 'preference' as const, text: 'We prefer recyclable or recycled packaging.' },
      {
        kind: 'rejection_reason' as const,
        text: 'We rejected Metro Cartons MC-1005 because the quoted size was internal, not external.',
      },
    ]) {
      repo.addNote(
        { profileId: profile.id, kind: note.kind, supplierName: null, text: note.text, caseId: null, syncedToMemory: false },
        db,
      );
      console.log(`Remembered: ${note.text}`);
    }
  }

  // Demo mode regardless of APP_MODE: seeding should never spend credits or
  // touch real supplier sites without the operator asking for it.
  const reasoning = createReasoningProvider(cfg, 'demo');
  const parsed = await reasoning.complete({
    task: 'parse_brief',
    system: BRIEF_SYSTEM,
    user: briefUserPrompt({ briefText: BRIEF }),
    schemaName: 'ParsedBrief',
    validate: zodValidator(ParsedBriefSchema),
  });

  const normalized = normalizeBrief({
    parsed: parsed.value,
    structured: {},
    timezone: profile.timezone,
    defaultCurrency: profile.currency,
  });

  // Recall the standing preferences, the same way the API route does, so the
  // seeded case demonstrates remembered context rather than starting blank.
  const memory = createMemoryProvider(cfg, profile.id, db);
  const recalled = await memory.recall(BRIEF, 5);

  const sourcingCase = repo.createCase(
    {
      profileId: profile.id,
      title: normalized.title,
      briefText: BRIEF,
      originalProductUrl: 'https://oldsupplier.example.invalid/cake-box-10x10x5-standard',
      mode: 'demo',
      resolvedDeadline: normalized.deadline?.isoDate ?? null,
      deadlineSourcePhrase: normalized.deadline?.sourcePhrase ?? null,
      timezone: profile.timezone,
      currency: profile.currency,
      appliedMemory: recalled.map((m) => ({
        id: m.id,
        text: m.text,
        kind: m.kind,
        source: m.source,
        accepted: true,
      })),
    },
    db,
  );

  if (recalled.length) {
    console.log(`\nApplied ${recalled.length} remembered preference(s) to this case.`);
  }

  for (const r of normalized.requirements) {
    repo.addRequirement({ ...r, caseId: sourcingCase.id }, db);
  }

  console.log(`\nCase ${sourcingCase.reference} created (${sourcingCase.id})`);
  console.log(`Deadline "${normalized.deadline?.sourcePhrase}" resolved to ${normalized.deadline?.display}`);
  console.log(`${normalized.requirements.length} requirements:`);
  for (const r of normalized.requirements) {
    console.log(`  [${r.priority === 'must_have' ? 'MUST' : 'pref'}] ${r.label}`);
  }

  const run = repo.createRun(sourcingCase.id, 'demo', 1, db);
  repo.enqueueJob({ kind: 'research', caseId: sourcingCase.id, runId: run.id }, db);
  repo.setCaseState(sourcingCase.id, 'RESEARCHING', db);
  repo.appendEvent(
    {
      caseId: sourcingCase.id,
      runId: run.id,
      kind: 'status',
      message: 'Queued for research.',
      detail: 'Seeded by scripts/seed.ts.',
    },
    db,
  );

  console.log(`\nResearch queued. Start the worker if it is not running:`);
  console.log(`  npm run worker`);
  console.log(`\nThen open: http://localhost:3000/cases/${sourcingCase.id}`);
}

main().catch((err) => {
  console.error('Seed failed:', (err as Error).message);
  process.exit(1);
});
